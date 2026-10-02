import {
  normalizeAuthBridgeDestinationOrigin,
  normalizeAuthBridgeRedirectPath,
} from "../../bridge/code.ts";
import { issueAuthBridgeCode } from "../../bridge/service.ts";
import {
  sanitizeHookAccount,
  sanitizeHookMember,
  sanitizeHookSession,
  sanitizeHookUser,
} from "../../hooks/sanitize.ts";
import type { OAuth2Tokens } from "../../oauth2/types.ts";
import {
  AthenaSocialOAuthProviderMixupError,
  AthenaSocialServerError,
} from "../../social/server/errors.ts";
import { resolveSocialProvider } from "../../social/server/provider-registry.ts";
import {
  resolveSocialCallbackUri,
  validatePostAuthRedirect,
} from "../../social/server/redirect.ts";
import type { OAuthTransactionRecord } from "../../social/server/transaction-store.ts";
import { sha256Hex } from "../../social/server/transaction-store.ts";
import { isUserEffectivelyBanned } from "../admin-contract.ts";
import type { AuthProcedureContext } from "../credential-password-routes.ts";
import { countRemainingAuthenticationMethods } from "../credential-viability.ts";
import { AthenaAuthRuntimeError, jsonResponse } from "../errors.ts";
import type {
  AuthAccountRow,
  AuthIdentityConnectionRow,
  AuthUserRow,
} from "../models.ts";
import { requireIdentityConnectionForEmail } from "../identity-connections/policy.ts";
import {
  asStringField,
  readJsonBody,
  requireStringField,
} from "../security.ts";
import { openPkceEnvelope } from "./pkce-encryption.ts";
import type { AthenaEmbeddedSocialRuntime } from "./runtime.ts";

function socialIdTokenNonceMatches(
  claim: string,
  nonceHash: string,
  hashedClaim: string
): boolean {
  return hashedClaim === nonceHash || claim === nonceHash;
}

function socialError(error: unknown): AthenaAuthRuntimeError {
  if (error instanceof AthenaAuthRuntimeError) {
    return error;
  }
  if (error instanceof AthenaSocialServerError) {
    const mixup = error instanceof AthenaSocialOAuthProviderMixupError;
    return new AthenaAuthRuntimeError(400, error.message, {
      cause: error,
      code: error.code,
      internalMessage: mixup ? "OAuth provider mix-up" : error.message,
    });
  }
  return AthenaAuthRuntimeError.internal(error);
}

function redirectPolicyContext(
  trustedOrigins: readonly string[],
  origin?: string
) {
  return {
    origin,
    production: process.env.NODE_ENV === "production",
    trustedOrigins,
  };
}

const FORBIDDEN_LOCATION_QUERY = /(?:^|[?&])(?:token|session|bearer)=/i;

function assertSafePostAuthLocation(location: string): string {
  if (FORBIDDEN_LOCATION_QUERY.test(location)) {
    throw new AthenaAuthRuntimeError(
      400,
      "OAuth callback redirect must not include a session bearer",
      { code: "ATHENA_AUTH_REDIRECT_UNTRUSTED" }
    );
  }
  return location;
}

function safeLocationRedirect(headers: Headers, location: string): Response {
  headers.set("Location", assertSafePostAuthLocation(location));
  return new Response(null, { headers, status: 302 });
}

async function finishSocialPostAuthRedirect(
  ctx: AuthProcedureContext,
  request: Request,
  destination: string,
  session?: { id: string; userId: string } | null
): Promise<Response> {
  const { deps, headers } = ctx;
  const requestOrigin = new URL(request.url).origin;
  const dest = new URL(destination);
  if (dest.origin === requestOrigin) {
    return safeLocationRedirect(headers, dest.toString());
  }
  if (!(deps.config.bridge.enabled && session)) {
    return safeLocationRedirect(headers, dest.toString());
  }
  const destinationOrigin = normalizeAuthBridgeDestinationOrigin(dest.origin);
  const redirectPath = normalizeAuthBridgeRedirectPath(
    `${dest.pathname}${dest.search}`
  );
  const ttlMs = deps.config.bridge.codeTtlSeconds * 1000;
  const issued = await issueAuthBridgeCode({
    destinationOrigin,
    expiresAt: new Date(Date.now() + ttlMs),
    redirectPath,
    sessionId: session.id,
    store: deps.getBridgeCodeStore(),
    userId: session.userId,
  });
  const bridged = new URL(redirectPath, destinationOrigin);
  bridged.searchParams.set("bridge_code", issued.code);
  return safeLocationRedirect(headers, bridged.toString());
}

async function runUserSignInSocial(
  ctx: AuthProcedureContext,
  input: {
    email?: string | null;
    emailVerified?: boolean;
    name?: string | null;
    provider: string;
    providerUserId: string;
    federation?: AuthIdentityConnectionRow;
    request: Request;
  }
) {
  const { deps, headers, traceId } = ctx;
  return deps.mutate({
    context: {
      actor: { kind: "user" },
      request: deps.hookRequest(input.request, `/callback/${input.provider}`),
      traceId,
    },
    event: "user.sign-in.social",
    execute: async (scope) => {
      const resolved = await resolveOrCreateSocialAccount(scope.stores, {
        email:
          input.federation && input.emailVerified !== true
            ? undefined
            : input.email,
        emailVerified: input.emailVerified,
        intent: "sign-in",
        name: input.name,
        providerId: input.provider,
        providerUserId: input.providerUserId,
      });
      await requireIdentityConnectionForEmail(
        scope.stores,
        resolved.user.email,
        input.federation?.id
      );
      if (isUserEffectivelyBanned(resolved.user)) {
        throw AthenaAuthRuntimeError.forbidden("User is banned");
      }
      let createdMember:
        | Awaited<ReturnType<typeof scope.stores.addMember>>
        | undefined;
      if (input.federation) {
        const identity = await scope.stores.linkFederatedIdentity({
          connectionId: input.federation.id,
          id: crypto.randomUUID(),
          issuer: input.federation.issuer,
          subject: input.providerUserId,
          userId: resolved.user.id,
        });
        await scope.stores.touchFederatedIdentity(identity.id, new Date());
        if (input.federation.jit_enabled) {
          const member = await scope.stores.getMember(
            input.federation.organization_id,
            resolved.user.id
          );
          if (!member) {
            createdMember = await scope.stores.addMember({
              id: crypto.randomUUID(),
              organizationId: input.federation.organization_id,
              role: input.federation.jit_default_role_id ?? "organization_member",
              userId: resolved.user.id,
            });
          }
        }
      }
      const session = await deps.issueSession(
        input.request,
        scope.stores,
        resolved.user.id,
        headers,
        { methods: ["social"] }
      );
      const user =
        (await scope.stores.getUserById(resolved.user.id)) ?? resolved.user;
      return { account: resolved.account, createdMember, session, user };
    },
    input: { provider: input.provider },
    resultOf: ({ account, session, user }) => ({
      account: sanitizeHookAccount(account),
      session: sanitizeHookSession(session),
      user: sanitizeHookUser(user),
    }),
    secondaryEvents: ({ createdMember, session }) => [
      ...(createdMember
        ? [
            {
              event: "organization.member.add" as const,
              input: {
                organizationId: createdMember.organization_id,
                role: createdMember.role,
                userId: createdMember.user_id,
              },
              result: { member: sanitizeHookMember(createdMember) },
            },
          ]
        : []),
      {
        event: "session.issue" as const,
        input: { userId: session.user_id },
        result: { session: sanitizeHookSession(session) },
      },
    ],
  });
}

const IDENTITY_CONNECTION_PROVIDER_PREFIX = "identity-connection-";

async function configureIdentityConnectionProvider(
  providerId: string,
  ctx: AuthProcedureContext,
  runtime: AthenaEmbeddedSocialRuntime
): Promise<AuthIdentityConnectionRow | undefined> {
  if (!providerId.startsWith(IDENTITY_CONNECTION_PROVIDER_PREFIX)) {
    return;
  }
  const connectionId = providerId.slice(IDENTITY_CONNECTION_PROVIDER_PREFIX.length);
  if (!connectionId) throw AthenaAuthRuntimeError.badRequest("connectionId is required");
  const connection = await ctx.stores.getIdentityConnection(connectionId);
  if (!connection?.enabled) {
    throw AthenaAuthRuntimeError.notFound("Enabled identity connection not found");
  }
  let clientSecret: string | undefined;
  if (connection.token_endpoint_auth_method !== "none") {
    const resolver = ctx.deps.resolveIdentityConnectionCredential;
    if (!connection.credential_ref || !resolver) {
      throw new AthenaAuthRuntimeError(
        503,
        "Identity connection credential is unavailable",
        { code: "ATHENA_AUTH_IDENTITY_CONNECTION_CREDENTIAL_UNAVAILABLE" }
      );
    }
    clientSecret = await resolver(connection.credential_ref);
    if (!clientSecret) {
      throw new AthenaAuthRuntimeError(
        503,
        "Identity connection credential is unavailable",
        { code: "ATHENA_AUTH_IDENTITY_CONNECTION_CREDENTIAL_UNAVAILABLE" }
      );
    }
  }
  runtime.social.providers[providerId] = {
    clientId: connection.client_id,
    ...(clientSecret ? { clientSecret } : {}),
    issuer: connection.issuer,
    ...(connection.resource_uri ? { resource: connection.resource_uri } : {}),
    tokenEndpointAuthMethod: connection.token_endpoint_auth_method,
  };
  return connection;
}

async function runAccountLink(
  ctx: AuthProcedureContext,
  input: {
    email?: string | null;
    emailVerified?: boolean;
    name?: string | null;
    provider: string;
    providerUserId: string;
    request: Request;
    userId: string;
  }
) {
  const { deps, traceId } = ctx;
  return deps.mutate({
    context: {
      actor: { kind: "user", userId: input.userId },
      request: deps.hookRequest(input.request, "/link-social"),
      traceId,
    },
    event: "account.link",
    execute: async (scope) => {
      const resolved = await resolveOrCreateSocialAccount(scope.stores, {
        email: input.email,
        emailVerified: input.emailVerified,
        intent: "link",
        name: input.name,
        providerId: input.provider,
        providerUserId: input.providerUserId,
        userId: input.userId,
      });
      return { account: resolved.account, user: resolved.user };
    },
    input: { provider: input.provider, userId: input.userId },
    resultOf: ({ account, user }) => ({
      account: sanitizeHookAccount(account),
      user: sanitizeHookUser(user),
    }),
  });
}

function findUnlinkAccount(
  accounts: readonly AuthAccountRow[],
  input: { accountId?: string; providerId?: string }
): AuthAccountRow | undefined {
  return accounts.find((row) => {
    const matchesRowId = Boolean(input.accountId) && row.id === input.accountId;
    const matchesProviderSubject =
      Boolean(input.accountId) && row.account_id === input.accountId;
    const matchesProvider =
      Boolean(input.providerId) && row.provider_id === input.providerId;
    const matchesId = matchesRowId || matchesProviderSubject;
    if (input.accountId && input.providerId) {
      return matchesId && matchesProvider;
    }
    if (input.accountId) {
      return matchesId;
    }
    return matchesProvider;
  });
}

async function runAccountUnlink(
  ctx: AuthProcedureContext,
  input: {
    accountId?: string;
    providerId?: string;
    request: Request;
    userId: string;
  }
) {
  const { deps, traceId } = ctx;
  return deps.mutate({
    context: {
      actor: { kind: "user", userId: input.userId },
      request: deps.hookRequest(input.request, "/unlink-account"),
      traceId,
    },
    event: "account.unlink",
    execute: async (scope) => {
      const accounts = await scope.stores.listAccounts(input.userId);
      const account = findUnlinkAccount(accounts, input);
      if (!account) {
        throw AthenaAuthRuntimeError.notFound("Account not found");
      }
      if (account.provider_id.startsWith(IDENTITY_CONNECTION_PROVIDER_PREFIX)) {
        throw AthenaAuthRuntimeError.badRequest(
          "Identity Connection accounts cannot be unlinked"
        );
      }
      const remaining = await countRemainingAuthenticationMethods(
        scope.stores,
        input.userId,
        { accountId: account.id }
      );
      if (remaining <= 0) {
        throw new AthenaAuthRuntimeError(
          400,
          "Cannot unlink the last credential",
          { code: "ATHENA_AUTH_LAST_CREDENTIAL" }
        );
      }
      await scope.stores.deleteAccount(account.id);
      return {
        accountId: account.id,
        deleted: true as const,
        id: account.id,
        provider: account.provider_id,
        userId: account.user_id,
      };
    },
    input: {
      accountId: input.accountId ?? "",
      provider: input.providerId ?? "",
      userId: input.userId,
    },
    previous: async () => {
      const accounts = await ctx.stores.listAccounts(input.userId);
      const account = findUnlinkAccount(accounts, input);
      if (!account) {
        throw AthenaAuthRuntimeError.notFound("Account not found");
      }
      return { account: sanitizeHookAccount(account) };
    },
    resultOf: (result) =>
      result as {
        accountId: string;
        deleted: true;
        id: string;
        provider: string;
        userId: string;
      },
  });
}

async function resolveOrCreateSocialAccount(
  stores: AuthProcedureContext["stores"],
  input: {
    email?: string | null;
    emailVerified?: boolean;
    intent: "link" | "sign-in";
    name?: string | null;
    providerId: string;
    providerUserId: string;
    userId?: string | null;
  }
): Promise<{ account: AuthAccountRow; created: boolean; user: AuthUserRow }> {
  const existing = await stores.findAccountByProvider(
    input.providerId,
    input.providerUserId
  );
  if (existing) {
    if (
      input.intent === "link" &&
      input.userId &&
      existing.user_id !== input.userId
    ) {
      throw new AthenaAuthRuntimeError(
        409,
        "Social account is already linked to another user",
        { code: "ATHENA_AUTH_ACCOUNT_LINK_CONFLICT" }
      );
    }
    const user = await stores.getUserById(existing.user_id);
    if (!user) {
      throw AthenaAuthRuntimeError.internal(
        new Error("linked social account is missing its user")
      );
    }
    return { account: existing, created: false, user };
  }

  if (input.intent === "link") {
    if (!input.userId) {
      throw new AthenaAuthRuntimeError(
        401,
        "Linking a social account requires the current user",
        { code: "ATHENA_AUTH_OAUTH_LINK_USER_REQUIRED" }
      );
    }
    const user = await stores.getUserById(input.userId);
    if (!user) {
      throw AthenaAuthRuntimeError.unauthenticated();
    }
    const account = await stores.createAccount({
      accountId: input.providerUserId,
      id: crypto.randomUUID(),
      providerId: input.providerId,
      userId: user.id,
    });
    return { account, created: true, user };
  }

  let user: AuthUserRow | undefined;
  if (input.email) {
    user = await stores.getUserByEmail(input.email);
  }
  if (!user) {
    user = await stores.createUser({
      email: input.email ?? undefined,
      emailVerified: input.emailVerified === true,
      id: crypto.randomUUID(),
      name: input.name ?? undefined,
    });
  }
  const account = await stores.createAccount({
    accountId: input.providerUserId,
    id: crypto.randomUUID(),
    providerId: input.providerId,
    userId: user.id,
  });
  return { account, created: true, user };
}

async function exchangeSocialIdentity(
  runtime: AthenaEmbeddedSocialRuntime,
  transaction: OAuthTransactionRecord,
  code: string
): Promise<{
  email?: string | null;
  emailVerified?: boolean;
  id: string;
  name?: string | null;
} | null> {
  const provider = resolveSocialProvider(
    runtime.social,
    transaction.providerId
  );
  const envelope = await openPkceEnvelope(
    transaction.pkceVerifierCiphertext,
    runtime.secret
  );
  let tokens: OAuth2Tokens | null;
  try {
    tokens = await provider.validateAuthorizationCode({
      code,
      codeVerifier: envelope.verifier,
      redirectURI: transaction.redirectUri,
    });
  } catch (error) {
    throw new AthenaAuthRuntimeError(400, "OAuth token exchange failed", {
      cause: error,
      code: "ATHENA_AUTH_OAUTH_TOKEN_EXCHANGE_FAILED",
    });
  }
  if (!tokens) {
    throw new AthenaAuthRuntimeError(400, "OAuth token exchange failed", {
      code: "ATHENA_AUTH_OAUTH_TOKEN_EXCHANGE_FAILED",
    });
  }
  let verifiedIdTokenClaims: Record<string, unknown> | undefined;
  if (tokens.idToken) {
    if (typeof provider.verifyIdToken !== "function") {
      throw new AthenaAuthRuntimeError(400, "Invalid ID token", {
        code: "ATHENA_AUTH_OAUTH_ID_TOKEN_INVALID",
      });
    }
    const { decodeJwt } = await import("jose");
    const claims = decodeJwt(tokens.idToken) as { nonce?: unknown };
    if (typeof claims.nonce !== "string" || claims.nonce.length === 0) {
      throw new AthenaAuthRuntimeError(400, "OIDC nonce mismatch", {
        code: "ATHENA_AUTH_OAUTH_NONCE_MISMATCH",
      });
    }
    const hashed = await sha256Hex(claims.nonce);
    if (
      !socialIdTokenNonceMatches(claims.nonce, transaction.nonceHash, hashed)
    ) {
      throw new AthenaAuthRuntimeError(400, "OIDC nonce mismatch", {
        code: "ATHENA_AUTH_OAUTH_NONCE_MISMATCH",
      });
    }
    let verified: boolean | { claims: Record<string, unknown> } = false;
    try {
      verified = await provider.verifyIdToken(tokens.idToken, claims.nonce);
    } catch {
      verified = false;
    }
    if (!verified) {
      throw new AthenaAuthRuntimeError(400, "Invalid ID token", {
        code: "ATHENA_AUTH_OAUTH_ID_TOKEN_INVALID",
      });
    }
    if (verified !== true) {
      verifiedIdTokenClaims = verified.claims;
    }
  }
  const profile = await provider.getUserInfo(tokens);
  const verifiedSubject = verifiedIdTokenClaims?.sub;
  const profileSubject = profile?.user.id;
  if (
    typeof verifiedSubject === "string" &&
    profileSubject != null &&
    String(profileSubject) !== verifiedSubject
  ) {
    throw new AthenaAuthRuntimeError(400, "OIDC subject mismatch", {
      code: "ATHENA_AUTH_OAUTH_ID_TOKEN_INVALID",
    });
  }
  const id = verifiedSubject ?? profileSubject;
  if (id === undefined || id === null || String(id).length === 0) {
    return null;
  }
  return {
    email:
      profile?.user.email ??
      (typeof verifiedIdTokenClaims?.email === "string"
        ? verifiedIdTokenClaims.email
        : undefined),
    emailVerified:
      profile?.user.emailVerified ??
      verifiedIdTokenClaims?.email_verified === true,
    id: String(id),
    name:
      profile?.user.name ??
      (typeof verifiedIdTokenClaims?.name === "string"
        ? verifiedIdTokenClaims.name
        : undefined),
  };
}

async function handleSocialCallback(
  request: Request,
  path: string,
  ctx: AuthProcedureContext
): Promise<Response> {
  const { deps } = ctx;
  const provider =
    path === "/callback/{provider}" ? "" : path.slice("/callback/".length);
  if (!provider) {
    throw AthenaAuthRuntimeError.badRequest("provider is required");
  }
  const { code, state } = await readCallbackParams(request);
  if (!(code && state)) {
    throw new AthenaAuthRuntimeError(400, "code and state are required", {
      code: "ATHENA_AUTH_OAUTH_CALLBACK_INVALID",
    });
  }
  const runtime = await deps.getSocialRuntime();
  if (!runtime) {
    throw new AthenaAuthRuntimeError(
      501,
      "Social authentication is not configured",
      { code: "ATHENA_AUTH_SOCIAL_NOT_CONFIGURED" }
    );
  }
  let transaction: OAuthTransactionRecord;
  try {
    transaction = (await runtime.engine.consumeTransaction({
      provider,
      state,
    })) as OAuthTransactionRecord;
  } catch (error) {
    throw socialError(error);
  }
  const envelope = await openPkceEnvelope(
    transaction.pkceVerifierCiphertext,
    runtime.secret
  );
  const postAuth =
    envelope.postAuthRedirect ??
    deps.config.security.trustedOrigins[0] ??
    new URL(request.url).origin;
  let destination: string;
  try {
    destination = validatePostAuthRedirect(
      postAuth,
      redirectPolicyContext(
        deps.config.security.trustedOrigins,
        new URL(request.url).origin
      )
    );
  } catch (error) {
    throw socialError(error);
  }

  if (transaction.providerId !== provider) {
    throw new AthenaSocialOAuthProviderMixupError();
  }

  const federation = await configureIdentityConnectionProvider(
    provider,
    ctx,
    runtime
  );
  if (federation && transaction.intent === "link") {
    throw AthenaAuthRuntimeError.badRequest(
      "Identity Connections do not support account linking"
    );
  }

  const identity = await exchangeSocialIdentity(runtime, transaction, code);
  if (!identity) {
    throw new AthenaAuthRuntimeError(400, "OAuth userinfo failed", {
      code: "ATHENA_AUTH_OAUTH_USERINFO_FAILED",
    });
  }
  const federatedDomains = Array.isArray(federation?.domains)
    ? federation.domains
    : [];
  if (federatedDomains.length) {
    const domain = identity.email?.split("@").at(-1)?.toLowerCase();
    if (
      !identity.emailVerified ||
      !domain ||
      !federatedDomains.some((allowed) => allowed.toLowerCase() === domain)
    ) {
      throw AthenaAuthRuntimeError.forbidden(
        "The verified identity email is outside this connection's domains"
      );
    }
  }
  await requireIdentityConnectionForEmail(
    ctx.stores,
    identity.email,
    federation?.id
  );

  if (transaction.intent === "link") {
    await runAccountLink(ctx, {
      email: identity.email,
      emailVerified: identity.emailVerified,
      name: identity.name,
      provider,
      providerUserId: identity.id,
      request,
      userId: transaction.userId ?? "",
    });
    return finishSocialPostAuthRedirect(ctx, request, destination);
  }

  const issued = await runUserSignInSocial(ctx, {
    email: identity.email,
    emailVerified: identity.emailVerified,
    name: identity.name,
    federation,
    provider,
    providerUserId: identity.id,
    request,
  });
  return finishSocialPostAuthRedirect(ctx, request, destination, {
    id: issued.session.id,
    userId: issued.session.user_id,
  });
}

async function readCallbackParams(
  request: Request
): Promise<{ code: string; state: string }> {
  if (request.method === "POST") {
    const contentType = request.headers.get("content-type") ?? "";
    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const form = await request.formData();
      return {
        code: String(form.get("code") ?? "").trim(),
        state: String(form.get("state") ?? "").trim(),
      };
    }
  }
  const params = new URL(request.url).searchParams;
  return {
    code: params.get("code")?.trim() ?? "",
    state: params.get("state")?.trim() ?? "",
  };
}

export async function handleSocialRoutes(
  request: Request,
  path: string,
  method: string,
  ctx: AuthProcedureContext
): Promise<Response | undefined> {
  const { deps, headers, stores } = ctx;
  const trusted = deps.config.security.trustedOrigins;

  if (
    (method === "GET" || method === "POST") &&
    (path === "/callback/{provider}" || /^\/callback\/[^/]+$/.test(path))
  ) {
    try {
      return await handleSocialCallback(request, path, ctx);
    } catch (error) {
      if (error instanceof AthenaSocialOAuthProviderMixupError) {
        throw socialError(error);
      }
      throw socialError(error);
    }
  }

  if (path === "/sign-in/social" && method === "POST") {
    const body = await readJsonBody(
      request,
      deps.config.security.bodyLimitBytes
    );
    const provider = requireStringField(body, "provider");
    const callbackURL = requireStringField(body, "callbackURL");
    let postAuth: string;
    try {
      postAuth = validatePostAuthRedirect(
        callbackURL,
        redirectPolicyContext(trusted, new URL(request.url).origin)
      );
    } catch (error) {
      throw socialError(error);
    }
    const runtime = await deps.getSocialRuntime();
    if (!runtime) {
      throw new AthenaAuthRuntimeError(
        501,
        "Social authentication is not configured",
        { code: "ATHENA_AUTH_SOCIAL_NOT_CONFIGURED" }
      );
    }
    const redirectUri = resolveSocialCallbackUri({
      basePath: deps.config.basePath,
      baseURL: new URL(request.url).origin,
      provider,
    });
    try {
      await configureIdentityConnectionProvider(provider, ctx, runtime);
      const started = await runtime.engine.startAuthorization({
        intent: "sign-in",
        postAuthRedirect: postAuth,
        provider,
        redirectUri,
      });
      return jsonResponse(200, { redirect: true, url: started.url }, headers);
    } catch (error) {
      throw socialError(error);
    }
  }

  if (path === "/link-social" && method === "POST") {
    const { user } = await deps.requireSession(request, stores);
    const body = await readJsonBody(
      request,
      deps.config.security.bodyLimitBytes
    );
    const provider = requireStringField(body, "provider");
    if (provider.startsWith(IDENTITY_CONNECTION_PROVIDER_PREFIX)) {
      throw AthenaAuthRuntimeError.badRequest(
        "Identity Connections do not support account linking"
      );
    }
    const callbackURL = requireStringField(body, "callbackURL");
    let postAuth: string;
    try {
      postAuth = validatePostAuthRedirect(
        callbackURL,
        redirectPolicyContext(trusted, new URL(request.url).origin)
      );
    } catch (error) {
      throw socialError(error);
    }
    const runtime = await deps.getSocialRuntime();
    if (!runtime) {
      throw new AthenaAuthRuntimeError(
        501,
        "Social authentication is not configured",
        { code: "ATHENA_AUTH_SOCIAL_NOT_CONFIGURED" }
      );
    }
    const redirectUri = resolveSocialCallbackUri({
      basePath: deps.config.basePath,
      baseURL: new URL(request.url).origin,
      provider,
    });
    try {
      const started = await runtime.engine.startAuthorization({
        intent: "link",
        postAuthRedirect: postAuth,
        provider,
        redirectUri,
        userId: user.id,
      });
      return jsonResponse(200, { redirect: true, url: started.url }, headers);
    } catch (error) {
      throw socialError(error);
    }
  }

  if (path === "/unlink-account" && method === "POST") {
    const { user } = await deps.requireSession(request, stores);
    const body = await readJsonBody(
      request,
      deps.config.security.bodyLimitBytes
    );
    const providerId =
      asStringField(body, "providerId") ?? asStringField(body, "provider");
    const accountId = asStringField(body, "accountId");
    await runAccountUnlink(ctx, {
      accountId,
      providerId,
      request,
      userId: user.id,
    });
    return jsonResponse(200, { status: true }, headers);
  }
}
