import { decodeJwt, decodeProtectedHeader } from "jose";
import {
  assertClientResource,
  assertClientScopes,
  assertRedirectUri,
  assertS256CodeChallenge,
  createAccessTokenClaims,
  generateOpaqueSecret,
  hashOAuthSecret,
  intersectScopes,
  isScopeSubset,
  OAuthProtocolError,
  openOAuthState,
  parseProtocolScopes,
  parseScopes,
  sealOAuthState,
  verifyCodeVerifier,
} from "../../authorization-server/index.ts";
import { normalizeResourceUri } from "../../authorization-server/resource.ts";
import type { IssuedOAuthTokenSet } from "../../authorization-server/tokens.ts";
import type {
  OAuthAuthorizationGrant,
  OAuthAuthorizationRequest,
  OAuthClient,
  OidcIdentityScope,
  OidcPrompt,
} from "../../authorization-server/types.ts";
import type { NormalizedAthenaAuthorizationServerConfig } from "../../config.ts";
import type { AthenaAuthMutationScope } from "../../hooks/scope.ts";
import type { AthenaTokenAuthority } from "../athena-token-authority.ts";
import type { AuthClock } from "../clock.ts";
import type { AuthUserRow } from "../models.ts";
import { systemAuthClock } from "../clock.ts";
import type { AthenaAuthStores } from "../store-contract.ts";
import type { TokenKeyStore } from "../token-key-store.ts";
import type { OAuthAuthorizationServerStores } from "./store.ts";
import { projectOidcClaims } from "../../authorization-server/oidc-claims.ts";

export interface OAuthUserEligibilityInput {
  organizationId: string | null;
  userId: string;
}

export interface OAuthAuthorizationServerServiceOptions {
  clock?: AuthClock;
  config: NormalizedAthenaAuthorizationServerConfig;
  getUser?: (userId: string) => Promise<AuthUserRow | null>;
  issuer: string;
  userInfoEndpoint?: string;
  keyStore: TokenKeyStore;
  signing: AthenaTokenAuthority;
  stateSecret: string;
  stores: OAuthAuthorizationServerStores;
  userIsEligible: (
    input: OAuthUserEligibilityInput,
    stores?: AthenaAuthStores
  ) => Promise<boolean> | boolean;
}

export type OAuthTokenResponse = IssuedOAuthTokenSet;

export type OAuthRefreshMutationResult =
  | {
      kind: "rotated";
      response: IssuedOAuthTokenSet;
    }
  | {
      clientId: string;
      familyId: string;
      grantId: string;
      kind: "reuse_detected";
    };

export type OAuthRefreshMutationIntent = {
  clientId: string;
  familyId: string;
  grantId: string;
  kind: "reuse_detected" | "rotated";
};

function scopesIssuedForGrant(
  requested: readonly string[],
  grant: OAuthAuthorizationGrant
): string[] {
  const issued = intersectScopes(requested, grant.scopes);
  if (issued.length === 0 && requested.length > 0) {
    throw new OAuthProtocolError(
      "invalid_scope",
      "The authorization grant no longer includes the requested scope."
    );
  }
  return issued;
}

function activeGrant(grant: OAuthAuthorizationGrant, now: Date): boolean {
  return (
    grant.status === "active" &&
    (grant.expiresAt === null || grant.expiresAt.getTime() > now.getTime()) &&
    grant.revokedAt === null
  );
}

export class OAuthAuthorizationServerService {
  constructor(
    private readonly options: OAuthAuthorizationServerServiceOptions
  ) {}

  private now(): Date {
    return (this.options.clock ?? systemAuthClock).now();
  }

  withStores(
    stores: OAuthAuthorizationServerStores
  ): OAuthAuthorizationServerService {
    return new OAuthAuthorizationServerService({
      ...this.options,
      stores,
    });
  }

  withMutationScope(
    scope: AthenaAuthMutationScope
  ): OAuthAuthorizationServerService {
    if (!(scope.oauth && scope.tokenKeys)) {
      throw new Error("OAuth mutation scope is not transaction-bound");
    }
    return new OAuthAuthorizationServerService({
      ...this.options,
      keyStore: scope.tokenKeys,
      signing: this.options.signing.withKeyStore(scope.tokenKeys),
      stores: scope.oauth,
      userIsEligible: (input) =>
        this.options.userIsEligible(input, scope.stores),
    });
  }

  async getClient(clientId: string): Promise<OAuthClient> {
    const client = await this.options.stores.clients.get(clientId);
    if (!client?.isActive) {
      throw new OAuthProtocolError("invalid_client", "The client is invalid.");
    }
    return client;
  }

  async disableClient(clientId: string): Promise<void> {
    const client = await this.options.stores.clients.get(clientId);
    if (!client) {
      throw new OAuthProtocolError("invalid_client", "The client is invalid.");
    }
    await this.options.stores.clients.disable(clientId);
  }

  validateResourceAndScopes(
    client: OAuthClient,
    resource: string | undefined,
    scope: string | null | undefined
  ): {
    identityScopes: ReturnType<typeof parseProtocolScopes>["identity"];
    resource: string;
    scopes: string[];
  } {
    const parsed = parseProtocolScopes(scope);
    if (
      parsed.identity.some(
        (identityScope) => !client.scopes.includes(identityScope)
      )
    ) {
      throw new OAuthProtocolError(
        "invalid_scope",
        "The requested identity scope is not allowed for this client."
      );
    }
    if (parsed.identity.length > 0 && parsed.resource.length === 0 && !resource) {
      if (!this.options.userInfoEndpoint) {
        throw new OAuthProtocolError("invalid_request", "The OIDC identity resource is unavailable.");
      }
      return {
        identityScopes: parsed.identity,
        resource: normalizeResourceUri(this.options.userInfoEndpoint),
        scopes: parsed.resource,
      };
    }
    if (!resource) {
      throw new OAuthProtocolError(
        "invalid_request",
        "The resource parameter is required."
      );
    }
    const normalizedResource = assertClientResource(client, resource);
    const resourceConfig = this.options.config.resources[normalizedResource];
    if (!resourceConfig) {
      throw new OAuthProtocolError(
        "invalid_request",
        "The requested resource is not configured."
      );
    }
    assertClientScopes(client, resourceConfig.scopes, parsed.resource);
    return {
      identityScopes: parsed.identity,
      resource: normalizedResource,
      scopes: parsed.resource,
    };
  }

  validateAuthorizationRequest(input: {
    clientId: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    redirectUri: string;
    resource?: string;
    responseType: string;
    scope: string | null | undefined;
    maxAge?: number | null;
    nonce?: string | null;
    prompt?: readonly OidcPrompt[];
  }): Promise<{
    client: OAuthClient;
    identityScopes: ReturnType<typeof parseProtocolScopes>["identity"];
    resource: string;
    scopes: string[];
  }> {
    return (async () => {
      const client = await this.getClient(input.clientId);
      if (input.responseType !== "code" || client.responseType !== "code") {
        throw new OAuthProtocolError(
          "unsupported_response_type",
          "Only the authorization code response type is supported."
        );
      }
      assertRedirectUri({
        clientType: client.clientType,
        registeredUris: client.redirectUris,
        requestedUri: input.redirectUri,
      });
      const { identityScopes, resource, scopes } =
        this.validateResourceAndScopes(
          client,
          input.resource,
          input.scope
        );
      const prompt = input.prompt ?? [];
      if (
        identityScopes.length === 0 &&
        (input.maxAge != null || input.nonce != null || prompt.length > 0)
      ) {
        throw new OAuthProtocolError(
          "invalid_request",
          "OIDC request parameters require the openid scope."
        );
      }
      if (
        input.maxAge != null &&
        (!Number.isSafeInteger(input.maxAge) || input.maxAge < 0 || input.maxAge > 2_147_483_647)
      ) {
        throw new OAuthProtocolError(
          "invalid_request",
          "The max_age value must be an integer from 0 through 2147483647."
        );
      }
      if (
        prompt.some((value) =>
          value !== "none" && value !== "login" && value !== "consent"
        ) ||
        (prompt.includes("none") && prompt.length !== 1)
      ) {
        throw new OAuthProtocolError(
          "invalid_request",
          "The requested prompt value is not supported."
        );
      }
      assertS256CodeChallenge(input.codeChallenge, input.codeChallengeMethod);
      return { client, identityScopes, resource, scopes };
    })();
  }

  async createAuthorizationRequest(input: {
    clientId: string;
    codeChallenge: string;
    codeChallengeMethod: "S256";
    redirectUri: string;
    resource?: string;
    scope: string | null | undefined;
    state: string;
    maxAge?: number | null;
    nonce?: string | null;
    prompt?: readonly OidcPrompt[];
  }): Promise<OAuthAuthorizationRequest> {
    const validated = await this.validateAuthorizationRequest({
      ...input,
      responseType: "code",
    });
    const id = crypto.randomUUID();
    const requestHash = await hashOAuthSecret(
      `oauth:request:${id}:${input.clientId}:${input.redirectUri}`
    );
    return this.options.stores.authorizationRequests.create({
      clientId: validated.client.id,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      expiresAt: new Date(
        this.now().getTime() +
          this.options.config.authorizationRequestTtlSeconds * 1000
      ),
      id,
      identityScopes: validated.identityScopes,
      maxAge: input.maxAge ?? null,
      nonce: input.nonce ?? null,
      prompt: input.prompt ?? [],
      redirectUri: input.redirectUri,
      requestedScopes: validated.scopes,
      requestHash,
      resource: validated.resource,
      stateCiphertext: await sealOAuthState(
        input.state,
        this.options.stateSecret
      ),
    });
  }

  async readAuthorizationState(
    request: OAuthAuthorizationRequest
  ): Promise<string> {
    return openOAuthState(request.stateCiphertext, this.options.stateSecret);
  }

  async approveAuthorizationRequest(input: {
    authenticatedAt: Date;
    authenticationMethods: readonly string[];
    id: string;
    organizationId: string | null;
    preserveExistingGrant?: boolean;
    scopes?: readonly string[];
    userId: string;
  }): Promise<{
    code: string;
    grant: OAuthAuthorizationGrant;
    request: OAuthAuthorizationRequest;
  }> {
    const request = await this.options.stores.authorizationRequests.get(
      input.id
    );
    if (request?.status !== "pending") {
      throw new OAuthProtocolError(
        "invalid_request",
        "The authorization interaction is invalid or expired."
      );
    }
    if (
      request.expiresAt.getTime() <= this.now().getTime() ||
      request.userId !== null
    ) {
      throw new OAuthProtocolError(
        "invalid_request",
        "The authorization interaction is invalid or expired."
      );
    }
    const client = await this.getClient(request.clientId);
    const eligible = await this.options.userIsEligible({
      organizationId: input.organizationId,
      userId: input.userId,
    });
    if (!eligible) {
      throw new OAuthProtocolError(
        "access_denied",
        "The user is not eligible for this organization."
      );
    }
    const code = generateOpaqueSecret();
    const completed = await this.options.stores.completeAuthorization({
      clientId: client.id,
      codeChallenge: request.codeChallenge,
      codeChallengeMethod: request.codeChallengeMethod,
      codeHash: await hashOAuthSecret(code),
      expiresAt: new Date(
        this.now().getTime() +
          this.options.config.authorizationCodeTtlSeconds * 1000
      ),
      grantId: crypto.randomUUID(),
      id: crypto.randomUUID(),
      authenticatedAt: input.authenticatedAt,
      authenticationMethods: input.authenticationMethods,
      identityScopes: request.identityScopes,
      nonce: request.nonce,
      preserveExistingGrant: input.preserveExistingGrant,
      organizationId: input.organizationId,
      redirectUri: request.redirectUri,
      requestId: input.id,
      resource: request.resource,
      scopes: input.scopes ?? request.requestedScopes,
      userId: input.userId,
    });
    return {
      code,
      grant: completed.grant,
      request: completed.request,
    };
  }

  async denyAuthorizationRequest(
    id: string
  ): Promise<OAuthAuthorizationRequest> {
    const request = await this.options.stores.authorizationRequests.get(id);
    if (!request) {
      throw new OAuthProtocolError(
        "invalid_request",
        "The authorization interaction is invalid or expired."
      );
    }
    await this.options.stores.authorizationRequests.deny(id);
    return request;
  }

  async exchangeAuthorizationCode(input: {
    clientId: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
    resource?: string;
  }): Promise<OAuthTokenResponse> {
    const client = await this.getClient(input.clientId);
    const codeHash = await hashOAuthSecret(input.code);
    const candidate =
      await this.options.stores.authorizationCodes.getByHash(codeHash);
    if (
      !candidate ||
      candidate.clientId !== client.id ||
      candidate.redirectUri !== input.redirectUri ||
      (input.resource != null && candidate.resource !== normalizeResourceUri(input.resource)) ||
      candidate.consumedAt ||
      candidate.expiresAt.getTime() <= this.now().getTime()
    ) {
      throw new OAuthProtocolError(
        "invalid_grant",
        "The authorization code is invalid or expired."
      );
    }
    await verifyCodeVerifier(
      input.codeVerifier,
      candidate.codeChallenge,
      candidate.codeChallengeMethod
    );
    const grant = await this.options.stores.grants.get(candidate.grantId);
    if (!(grant && activeGrant(grant, this.now()))) {
      throw new OAuthProtocolError(
        "invalid_grant",
        "The authorization grant is no longer active."
      );
    }
    if (
      !(await this.options.userIsEligible({
        organizationId: grant.organizationId,
        userId: grant.userId,
      }))
    ) {
      throw new OAuthProtocolError(
        "invalid_grant",
        "The authorization grant is no longer eligible."
      );
    }
    const consumed = await this.options.stores.authorizationCodes.consume({
      clientId: client.id,
      codeChallenge: candidate.codeChallenge,
      codeHash,
      redirectUri: input.redirectUri,
      resource: candidate.resource,
    });
    if (!consumed) {
      throw new OAuthProtocolError(
        "invalid_grant",
        "The authorization code is invalid or expired."
      );
    }
    await this.options.stores.grants.touch(grant.id);
    const identityScopes = intersectScopes(
      candidate.identityScopes,
      grant.identityScopes
    ) as typeof candidate.identityScopes;
    return this.issueInitialTokens({
      client,
      grant,
      identityScopes,
      oidc: identityScopes.includes("openid")
        ? {
            amr: candidate.authenticationMethods,
            authTime: candidate.authenticatedAt,
            nonce: candidate.nonce,
          }
        : undefined,
      scopes: scopesIssuedForGrant(candidate.scopes, grant),
    });
  }

  async refreshMutation(
    input: {
      clientId: string;
      refreshToken: string;
      resource: string;
      scope?: string | null;
    },
    expectedKind?: OAuthRefreshMutationIntent["kind"]
  ): Promise<OAuthRefreshMutationResult> {
    const client = await this.getClient(input.clientId);
    const resource = assertClientResource(client, input.resource);
    const tokenHash = await hashOAuthSecret(input.refreshToken);
    const current =
      await this.options.stores.refreshTokens.getByHash(tokenHash);
    if (
      !current ||
      current.clientId !== client.id ||
      current.resource !== resource
    ) {
      throw new OAuthProtocolError(
        "invalid_grant",
        "The refresh token is invalid."
      );
    }
    const requestedScopes =
      input.scope == null ? [...current.scopes] : parseScopes(input.scope);
    if (!isScopeSubset(requestedScopes, current.scopes)) {
      throw new OAuthProtocolError(
        "invalid_scope",
        "The requested scope exceeds the original grant."
      );
    }
    const grant = await this.options.stores.grants.get(current.grantId);
    if (
      !(
        grant &&
        activeGrant(grant, this.now()) &&
        (await this.options.userIsEligible({
          organizationId: current.organizationId,
          userId: current.userId,
        }))
      )
    ) {
      throw new OAuthProtocolError(
        "invalid_grant",
        "The authorization grant is no longer active."
      );
    }
    const scopes = scopesIssuedForGrant(requestedScopes, grant);
    const identityScopes = intersectScopes(
      current.identityScopes,
      grant.identityScopes
    ) as typeof current.identityScopes;
    const replacementToken = generateOpaqueSecret();
    const result = await this.options.stores.refreshTokens.rotate({
      clientId: client.id,
      replacement: {
        clientId: client.id,
        expiresAt: new Date(
          this.now().getTime() +
            this.options.config.refreshTokenTtlSeconds * 1000
        ),
        familyId: current.familyId,
        grantId: current.grantId,
        id: crypto.randomUUID(),
        organizationId: current.organizationId,
        parentTokenId: current.id,
        resource,
        scopes,
        identityScopes,
        tokenHash: await hashOAuthSecret(replacementToken),
        userId: current.userId,
      },
      resource,
      tokenHash,
    });
    if (result.kind === "replay") {
      if (expectedKind === "rotated") {
        throw new OAuthProtocolError(
          "invalid_grant",
          "The refresh token outcome changed during the request.",
          {
            cause: {
              actualKind: "reuse_detected",
              clientId: client.id,
              event: "oauth.refresh.outcome_mismatch",
              familyId: result.familyId,
              grantId: current.grantId,
            },
          }
        );
      }
      return {
        clientId: client.id,
        familyId: result.familyId,
        grantId: current.grantId,
        kind: "reuse_detected",
      };
    }
    if (result.kind !== "rotated") {
      throw new OAuthProtocolError(
        "invalid_grant",
        "The refresh token is invalid or expired."
      );
    }
    if (expectedKind === "reuse_detected") {
      throw new OAuthProtocolError(
        "invalid_grant",
        "The refresh token outcome changed during the request.",
        {
          cause: {
            actualKind: "rotated",
            clientId: client.id,
            event: "oauth.refresh.outcome_mismatch",
            familyId: current.familyId,
            grantId: current.grantId,
          },
        }
      );
    }
    const tokens = await this.issueAccessToken({
      client,
      familyId: current.familyId,
      grant,
      identityScopes,
      scopes,
    });
    return {
      kind: "rotated",
      response: {
        ...tokens,
        refreshToken: replacementToken,
      },
    };
  }

  async refreshMutationIntent(input: {
    clientId: string;
    refreshToken: string;
    resource: string;
  }): Promise<OAuthRefreshMutationIntent> {
    const client = await this.getClient(input.clientId);
    const resource = assertClientResource(client, input.resource);
    const tokenHash = await hashOAuthSecret(input.refreshToken);
    const current =
      await this.options.stores.refreshTokens.getByHash(tokenHash);
    if (
      !current ||
      current.clientId !== client.id ||
      current.resource !== resource
    ) {
      throw new OAuthProtocolError(
        "invalid_grant",
        "The refresh token is invalid."
      );
    }
    return {
      clientId: client.id,
      familyId: current.familyId,
      grantId: current.grantId,
      kind: current.status === "active" ? "rotated" : "reuse_detected",
    };
  }

  async refresh(input: {
    clientId: string;
    refreshToken: string;
    resource: string;
    scope?: string | null;
  }): Promise<OAuthTokenResponse> {
    const result = await this.refreshMutation(input);
    if (result.kind === "reuse_detected") {
      throw new OAuthProtocolError(
        "invalid_grant",
        "The refresh token has been reused.",
        {
          cause: {
            clientId: result.clientId,
            event: "oauth.refresh.reuse_detected",
            familyId: result.familyId,
            grantId: result.grantId,
          },
        }
      );
    }
    return result.response;
  }

  async revoke(input: {
    clientId: string;
    token: string;
    tokenTypeHint?: "access_token" | "refresh_token";
  }): Promise<void> {
    const hash = await hashOAuthSecret(input.token);
    const refresh = await this.options.stores.refreshTokens.getByHash(hash);
    if (refresh?.clientId === input.clientId) {
      await this.options.stores.refreshTokens.revokeFamily(
        refresh.familyId,
        "client_revocation"
      );
      return;
    }
    try {
      const decoded = decodeJwt(input.token);
      if (
        typeof decoded.aud !== "string" ||
        typeof decoded.client_id !== "string"
      ) {
        return;
      }
      const header = decodeProtectedHeader(input.token);
      if (header.alg !== "ES256" || typeof header.kid !== "string") {
        return;
      }
      const key = (await this.options.keyStore.listVerificationKeys()).find(
        (entry) => entry.kid === header.kid
      );
      if (!key) {
        return;
      }
      const claims = await this.options.signing.verifyAthenaToken({
        audience: decoded.aud,
        token: input.token,
      });
      if (
        typeof claims.jti !== "string" ||
        typeof claims.exp !== "number" ||
        typeof claims.athena_grant_id !== "string" ||
        claims.client_id !== input.clientId
      ) {
        return;
      }
      const grant = await this.options.stores.grants.get(
        claims.athena_grant_id
      );
      if (!grant || grant.clientId !== input.clientId) {
        return;
      }
      await this.options.stores.accessTokens.revoke({
        expiresAt: new Date(claims.exp * 1000),
        grantId: grant.id,
        jti: claims.jti,
        reason: "client_revocation",
        revokedAt: this.now(),
      });
    } catch {
      // RFC 7009 intentionally does not disclose whether a token was known.
    }
  }

  async listGrants(userId: string): Promise<
    Array<{
      client: OAuthClient | null;
      grant: OAuthAuthorizationGrant;
    }>
  > {
    const grants = await this.options.stores.grants.listForUser(userId);
    return Promise.all(
      grants.map(async (grant) => ({
        client: await this.options.stores.clients.get(grant.clientId),
        grant,
      }))
    );
  }

  async revokeGrant(input: { grantId: string; userId: string }): Promise<void> {
    const grant = await this.options.stores.grants.get(input.grantId);
    if (!grant || grant.userId !== input.userId) {
      throw new OAuthProtocolError(
        "invalid_request",
        "The authorization grant is invalid."
      );
    }
    await this.options.stores.grants.revoke({
      grantId: grant.id,
      reason: "user_revocation",
      revokedBy: input.userId,
    });
  }

  private async issueInitialTokens(input: {
    client: OAuthClient;
    grant: OAuthAuthorizationGrant;
    identityScopes: readonly OidcIdentityScope[];
    oidc?: {
      amr: readonly string[];
      authTime: Date;
      nonce: string | null;
    };
    scopes: readonly string[];
  }): Promise<OAuthTokenResponse> {
    const familyId = this.options.config.issueRefreshTokens
      ? crypto.randomUUID()
      : undefined;
    const response = await this.issueAccessToken({
      ...input,
      ...(familyId ? { familyId } : {}),
      identityScopes: input.identityScopes,
    });
    let idToken: string | undefined;
    if (input.oidc) {
      const user = await this.options.getUser?.(input.grant.userId);
      if (!user) {
        throw new OAuthProtocolError(
          "invalid_grant",
          "The authorization subject is no longer available."
        );
      }
      const identity = projectOidcClaims({
        identityScopes: input.identityScopes,
        user,
      });
      const issuedAt = Math.floor(this.now().getTime() / 1000);
      idToken = await this.options.signing.signOidcIdToken({
        ...identity,
        amr: input.oidc.amr,
        aud: input.client.id,
        auth_time: Math.floor(input.oidc.authTime.getTime() / 1000),
        exp: issuedAt + this.options.config.accessTokenTtlSeconds,
        iat: issuedAt,
        iss: this.options.issuer,
        ...(input.oidc.nonce != null ? { nonce: input.oidc.nonce } : {}),
        sub: input.grant.userId,
      });
    }
    if (!familyId) {
      return { ...response, ...(idToken ? { idToken } : {}) };
    }
    const refreshToken = generateOpaqueSecret();
    await this.options.stores.refreshTokens.create({
      clientId: input.client.id,
      expiresAt: new Date(
        this.now().getTime() + this.options.config.refreshTokenTtlSeconds * 1000
      ),
      familyId,
      grantId: input.grant.id,
      id: crypto.randomUUID(),
      identityScopes: input.identityScopes,
      organizationId: input.grant.organizationId,
      resource: input.grant.resource,
      scopes: input.scopes,
      tokenHash: await hashOAuthSecret(refreshToken),
      userId: input.grant.userId,
    });
    return {
      ...response,
      ...(idToken ? { idToken } : {}),
      refreshToken,
    };
  }

  private async issueAccessToken(input: {
    client: OAuthClient;
    familyId?: string;
    grant: OAuthAuthorizationGrant;
    identityScopes?: readonly OidcIdentityScope[];
    scopes: readonly string[];
  }): Promise<IssuedOAuthTokenSet> {
    const scopes = scopesIssuedForGrant(input.scopes, input.grant);
    const identityScopes = intersectScopes(
      input.identityScopes ?? [],
      input.grant.identityScopes
    );
    const claims = createAccessTokenClaims({
      clientId: input.client.id,
      familyId: input.familyId,
      grantId: input.grant.id,
      identityScopes,
      issuer: this.options.issuer,
      now: this.now(),
      organizationId: input.grant.organizationId,
      resource: input.grant.resource,
      scopes,
      subject: input.grant.userId,
      ttlSeconds: this.options.config.accessTokenTtlSeconds,
    });
    const accessToken = await this.options.signing.signOAuthAccessToken(claims);
    return {
      accessToken,
      expiresIn: this.options.config.accessTokenTtlSeconds,
      familyId: input.familyId,
      grantId: input.grant.id,
      identityScopes,
      scopes,
    };
  }
}
