import type {
  OAuthAuthorizationCode,
  OAuthAuthorizationGrant,
  OAuthAuthorizationRequest,
  OAuthClient,
  OAuthRefreshToken,
  OAuthRevokedAccessToken,
} from "../../authorization-server/types.ts";
import { normalizeRegisteredRedirectUri } from "../../authorization-server/redirect-uri.ts";
import { normalizeResourceUri } from "../../authorization-server/resource.ts";
import { OAuthProtocolError } from "../../authorization-server/errors.ts";
import {
  type AuthorizeOAuthGrantInput,
  type CreateOAuthAuthorizationCodeInput,
  type CreateOAuthAuthorizationRequestInput,
  type CreateOAuthRefreshTokenInput,
  type OAuthAuthorizationServerStores,
  type OAuthGrantLookup,
  type OAuthRefreshRotationResult,
  type RotateOAuthRefreshTokenInput,
} from "./store.ts";

function cloneDate(value: Date | null): Date | null {
  return value ? new Date(value) : null;
}

function cloneClient(client: OAuthClient): OAuthClient {
  return {
    ...client,
    createdAt: new Date(client.createdAt),
    metadata: structuredClone(client.metadata),
    redirectUris: [...client.redirectUris],
    resourceUris: [...client.resourceUris],
    scopes: [...client.scopes],
    updatedAt: new Date(client.updatedAt),
  };
}

function cloneGrant(grant: OAuthAuthorizationGrant): OAuthAuthorizationGrant {
  return {
    ...grant,
    authorizedAt: new Date(grant.authorizedAt),
    createdAt: new Date(grant.createdAt),
    expiresAt: cloneDate(grant.expiresAt),
    identityScopes: [...grant.identityScopes],
    lastUsedAt: cloneDate(grant.lastUsedAt),
    revokedAt: cloneDate(grant.revokedAt),
    scopes: [...grant.scopes],
    updatedAt: new Date(grant.updatedAt),
  };
}

function cloneRequest(
  request: OAuthAuthorizationRequest
): OAuthAuthorizationRequest {
  return {
    ...request,
    createdAt: new Date(request.createdAt),
    expiresAt: new Date(request.expiresAt),
    identityScopes: [...request.identityScopes],
    prompt: [...request.prompt],
    requestedScopes: [...request.requestedScopes],
    resolvedAt: cloneDate(request.resolvedAt),
  };
}

function cloneCode(code: OAuthAuthorizationCode): OAuthAuthorizationCode {
  return {
    ...code,
    authenticatedAt: new Date(code.authenticatedAt),
    authenticationMethods: [...code.authenticationMethods],
    consumedAt: cloneDate(code.consumedAt),
    createdAt: new Date(code.createdAt),
    expiresAt: new Date(code.expiresAt),
    identityScopes: [...code.identityScopes],
    scopes: [...code.scopes],
  };
}

function cloneRefresh(token: OAuthRefreshToken): OAuthRefreshToken {
  return {
    ...token,
    createdAt: new Date(token.createdAt),
    expiresAt: new Date(token.expiresAt),
    revokedAt: cloneDate(token.revokedAt),
    rotatedAt: cloneDate(token.rotatedAt),
    identityScopes: [...token.identityScopes],
    scopes: [...token.scopes],
    usedAt: cloneDate(token.usedAt),
  };
}

function isActiveGrant(grant: OAuthAuthorizationGrant, now: Date): boolean {
  return (
    grant.status === "active" &&
    (grant.expiresAt === null || grant.expiresAt.getTime() > now.getTime()) &&
    grant.revokedAt === null
  );
}

function grantHasStatus(
  grant: OAuthAuthorizationGrant,
  status: OAuthAuthorizationGrant["status"],
  now: Date
): boolean {
  if (status === "revoked") {
    return grant.status === "revoked" || grant.revokedAt !== null;
  }
  if (status === "expired") {
    return (
      grant.status === "expired" ||
      (grant.status === "active" &&
        grant.expiresAt !== null &&
        grant.expiresAt.getTime() <= now.getTime())
    );
  }
  return isActiveGrant(grant, now);
}

function normalizeScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
}

function normalizeResourceUris(resources: readonly string[]): string[] {
  return [...new Set(resources.map(normalizeResourceUri))].sort();
}

function grantMatches(
  left: OAuthGrantLookup,
  right: OAuthAuthorizationGrant
): boolean {
  return (
    left.clientId === right.clientId &&
    left.organizationId === right.organizationId &&
    left.resource === right.resource &&
    left.userId === right.userId
  );
}

function createGrant(input: AuthorizeOAuthGrantInput): OAuthAuthorizationGrant {
  const now = new Date();
  return {
    authorizedAt: now,
    clientId: input.clientId,
    createdAt: now,
    expiresAt: null,
    id: crypto.randomUUID(),
    identityScopes: [],
    lastUsedAt: null,
    organizationId: input.organizationId,
    resource: input.resource,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    scopes: normalizeScopes(input.scopes),
    status: "active",
    updatedAt: now,
    userId: input.userId,
  };
}

function createRequest(
  input: CreateOAuthAuthorizationRequestInput
): OAuthAuthorizationRequest {
  return {
    clientId: input.clientId,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: input.codeChallengeMethod,
    createdAt: new Date(),
    expiresAt: new Date(input.expiresAt),
    id: input.id,
    identityScopes: [...(input.identityScopes ?? [])],
    maxAge: input.maxAge ?? null,
    nonce: input.nonce ?? null,
    organizationId: input.organizationId ?? null,
    prompt: [...(input.prompt ?? [])],
    redirectUri: input.redirectUri,
    requestedScopes: [...input.requestedScopes],
    resolvedAt: null,
    resource: input.resource,
    stateCiphertext: input.stateCiphertext,
    status: "pending",
    userId: input.userId ?? null,
  };
}

function createCode(
  input: CreateOAuthAuthorizationCodeInput & { codeHash: string }
): OAuthAuthorizationCode {
  return {
    authenticatedAt: new Date(input.authenticatedAt ?? new Date()),
    authenticationMethods: [...(input.authenticationMethods ?? [])],
    clientId: input.clientId,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: input.codeChallengeMethod,
    consumedAt: null,
    consumeReason: null,
    createdAt: new Date(),
    expiresAt: new Date(input.expiresAt),
    grantId: input.grantId,
    id: input.id,
    identityScopes: [...input.identityScopes],
    nonce: input.nonce ?? null,
    organizationId: input.organizationId ?? null,
    redirectUri: input.redirectUri,
    resource: input.resource,
    scopes: [...input.scopes],
    userId: input.userId,
  };
}

function createRefresh(input: CreateOAuthRefreshTokenInput): OAuthRefreshToken {
  return {
    clientId: input.clientId,
    createdAt: new Date(),
    expiresAt: new Date(input.expiresAt),
    familyId: input.familyId,
    grantId: input.grantId,
    id: input.id,
    identityScopes: [...input.identityScopes],
    organizationId: input.organizationId ?? null,
    parentTokenId: input.parentTokenId ?? null,
    resource: input.resource,
    revokedAt: null,
    revokeReason: null,
    rotatedAt: null,
    scopes: [...input.scopes],
    status: "active",
    usedAt: null,
    userId: input.userId,
  };
}

export interface MemoryOAuthAuthorizationServerState {
  clients: Map<string, OAuthClient>;
  grants: Map<string, OAuthAuthorizationGrant>;
  requests: Map<string, OAuthAuthorizationRequest>;
  codes: Map<string, OAuthAuthorizationCode>;
  refreshTokens: Map<string, OAuthRefreshToken>;
  revokedAccessTokens: Map<string, OAuthRevokedAccessToken>;
  mutationTail: Promise<unknown>;
}

export interface MemoryOAuthAuthorizationServerSnapshot {
  clients: Map<string, OAuthClient>;
  grants: Map<string, OAuthAuthorizationGrant>;
  requests: Map<string, OAuthAuthorizationRequest>;
  codes: Map<string, OAuthAuthorizationCode>;
  refreshTokens: Map<string, OAuthRefreshToken>;
  revokedAccessTokens: Map<string, OAuthRevokedAccessToken>;
}

export function createMemoryOAuthAuthorizationServerState(): MemoryOAuthAuthorizationServerState {
  return {
    clients: new Map(),
    grants: new Map(),
    requests: new Map(),
    codes: new Map(),
    refreshTokens: new Map(),
    revokedAccessTokens: new Map(),
    mutationTail: Promise.resolve(),
  };
}

function cloneMap<K, V>(source: Map<K, V>, clone: (value: V) => V): Map<K, V> {
  return new Map(
    [...source.entries()].map(([key, value]) => [key, clone(value)])
  );
}

export function snapshotMemoryOAuthAuthorizationServerState(
  state: MemoryOAuthAuthorizationServerState
): MemoryOAuthAuthorizationServerSnapshot {
  return {
    clients: cloneMap(state.clients, cloneClient),
    grants: cloneMap(state.grants, cloneGrant),
    requests: cloneMap(state.requests, cloneRequest),
    codes: cloneMap(state.codes, cloneCode),
    refreshTokens: cloneMap(state.refreshTokens, cloneRefresh),
    revokedAccessTokens: cloneMap(state.revokedAccessTokens, (value) => ({
      ...value,
      expiresAt: new Date(value.expiresAt),
      revokedAt: new Date(value.revokedAt),
    })),
  };
}

export function restoreMemoryOAuthAuthorizationServerState(
  state: MemoryOAuthAuthorizationServerState,
  snapshot: MemoryOAuthAuthorizationServerSnapshot
): void {
  replaceMap(state.clients, snapshot.clients, cloneClient);
  replaceMap(state.grants, snapshot.grants, cloneGrant);
  replaceMap(state.requests, snapshot.requests, cloneRequest);
  replaceMap(state.codes, snapshot.codes, cloneCode);
  replaceMap(state.refreshTokens, snapshot.refreshTokens, cloneRefresh);
  replaceMap(
    state.revokedAccessTokens,
    snapshot.revokedAccessTokens,
    (value) => ({
      ...value,
      expiresAt: new Date(value.expiresAt),
      revokedAt: new Date(value.revokedAt),
    })
  );
}

function replaceMap<K, V>(
  target: Map<K, V>,
  source: Map<K, V>,
  clone: (value: V) => V
): void {
  target.clear();
  for (const [key, value] of source) {
    target.set(key, clone(value));
  }
}

export function createMemoryOAuthAuthorizationServerStores(
  options: {
    state?: MemoryOAuthAuthorizationServerState;
    transactionBound?: boolean;
  } = {}
): OAuthAuthorizationServerStores {
  const state = options.state ?? createMemoryOAuthAuthorizationServerState();
  const {
    clients,
    grants,
    requests,
    codes,
    refreshTokens,
    revokedAccessTokens,
  } = state;

  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    if (options.transactionBound) {
      return operation();
    }
    const result = state.mutationTail.then(operation, operation);
    state.mutationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  return {
    completeAuthorization: async (input) =>
      serialize(async () => {
        const request = requests.get(input.requestId);
        if (
          !request ||
          request.status !== "pending" ||
          request.userId !== null ||
          request.expiresAt.getTime() <= Date.now()
        ) {
          throw new Error("OAuth authorization interaction is not pending");
        }
        const grantInput = {
          clientId: input.clientId,
          organizationId: input.organizationId ?? null,
          resource: input.resource,
          scopes: input.scopes,
          userId: input.userId,
        };
        const existing = [...grants.values()].find(
          (candidate) =>
            isActiveGrant(candidate, new Date()) &&
            grantMatches(grantInput, candidate)
        );
        if (
          input.preserveExistingGrant &&
          (!existing ||
            input.scopes.some((scope) => !existing.scopes.includes(scope)) ||
            input.identityScopes.some(
              (scope) => !existing.identityScopes.includes(scope)
            ))
        ) {
          throw new OAuthProtocolError(
            "consent_required",
            "The user has not consented to this request."
          );
        }
        const grant = existing ?? createGrant(grantInput);
        if (!input.preserveExistingGrant) {
          grant.scopes = [...new Set(input.scopes)].sort();
          grant.identityScopes = [...input.identityScopes].sort();
          grant.authorizedAt = new Date();
          grant.updatedAt = new Date();
        }
        if (!existing) {
          grants.set(grant.id, grant);
        }
        request.status = "approved";
        request.userId = input.userId;
        request.organizationId = input.organizationId ?? null;
        request.resolvedAt = new Date();
        const code = createCode({ ...input, grantId: grant.id });
        codes.set(input.codeHash, code);
        request.status = "consumed";
        request.resolvedAt = new Date();
        return {
          code: cloneCode(code),
          grant: cloneGrant(grant),
          request: cloneRequest(request),
        };
      }),
    accessTokens: {
      async isRevoked(jti) {
        const row = revokedAccessTokens.get(jti);
        return Boolean(row && row.expiresAt.getTime() > Date.now());
      },
      async revoke(input) {
        revokedAccessTokens.set(input.jti, {
          ...input,
          expiresAt: new Date(input.expiresAt),
          revokedAt: new Date(input.revokedAt),
        });
      },
    },
    authorizationCodes: {
      async consume(input) {
        return serialize(async () => {
          const row = codes.get(input.codeHash);
          if (!row || row.expiresAt.getTime() <= Date.now()) {
            return null;
          }
          if (
            row.clientId !== input.clientId ||
            row.redirectUri !== input.redirectUri ||
            row.resource !== input.resource ||
            row.consumedAt !== null
          ) {
            return null;
          }
          row.consumedAt = new Date();
          row.consumeReason = "consumed";
          return cloneCode(row);
        });
      },
      async create(input) {
        const row = createCode(input);
        codes.set(input.codeHash, row);
        return cloneCode(row);
      },
      async getByHash(codeHash) {
        const row = codes.get(codeHash);
        return row ? cloneCode(row) : null;
      },
    },
    authorizationRequests: {
      async approve(id, input) {
        return serialize(async () => {
          const row = requests.get(id);
          if (
            !row ||
            row.status !== "pending" ||
            row.expiresAt.getTime() <= Date.now()
          ) {
            return null;
          }
          row.status = "approved";
          row.userId = input.userId;
          row.organizationId = input.organizationId ?? null;
          row.resolvedAt = new Date();
          return cloneRequest(row);
        });
      },
      async create(input) {
        const row = createRequest(input);
        requests.set(row.id, row);
        return cloneRequest(row);
      },
      async deny(id) {
        await serialize(async () => {
          const row = requests.get(id);
          if (row?.status === "pending") {
            row.status = "denied";
            row.resolvedAt = new Date();
          }
        });
      },
      async get(id) {
        const row = requests.get(id);
        return row ? cloneRequest(row) : null;
      },
      async consume(id) {
        return serialize(async () => {
          const row = requests.get(id);
          if (!row || row.status !== "approved") {
            return null;
          }
          row.status = "consumed";
          row.resolvedAt = new Date();
          return cloneRequest(row);
        });
      },
    },
    clients: {
      async create(input) {
        const now = new Date();
        const row: OAuthClient = {
          clientName: input.clientName,
          clientType: "public",
          clientUrl: input.clientUrl ?? null,
          createdAt: now,
          grantType: "authorization_code",
          id: input.id,
          isActive: true,
          metadata: { ...(input.metadata ?? {}) },
          redirectUris: input.redirectUris.map(normalizeRegisteredRedirectUri),
          registrationKind: "pre-registered",
          resourceUris: normalizeResourceUris(input.resourceUris),
          responseType: "code",
          scopes: normalizeScopes(input.scopes),
          tokenEndpointAuthMethod: "none",
          updatedAt: now,
        };
        clients.set(row.id, row);
        return cloneClient(row);
      },
      async disable(clientId) {
        await serialize(async () => {
          const row = clients.get(clientId);
          if (row) {
            row.isActive = false;
            row.updatedAt = new Date();
          }
        });
      },
      async get(clientId) {
        const row = clients.get(clientId);
        return row ? cloneClient(row) : null;
      },
      async list(input = {}) {
        const matching = [...clients.values()]
          .filter(
            (row) =>
              input.isActive === undefined || row.isActive === input.isActive
          )
          .sort(
            (a, b) =>
              b.createdAt.getTime() - a.createdAt.getTime() ||
              a.id.localeCompare(b.id)
          );
        const offset = Math.max(0, Math.trunc(input.offset ?? 0));
        const limit = Math.max(0, Math.trunc(input.limit ?? matching.length));
        return {
          clients: matching.slice(offset, offset + limit).map(cloneClient),
          total: matching.length,
        };
      },
      async update(clientId, input) {
        return serialize(async () => {
          const row = clients.get(clientId);
          if (!row) {
            return null;
          }
          Object.assign(row, {
            ...(input.clientName ? { clientName: input.clientName } : {}),
            ...(input.clientUrl !== undefined
              ? { clientUrl: input.clientUrl }
              : {}),
            ...(input.metadata ? { metadata: { ...input.metadata } } : {}),
            ...(input.redirectUris
              ? {
                  redirectUris: input.redirectUris.map(
                    normalizeRegisteredRedirectUri
                  ),
                }
              : {}),
            ...(input.resourceUris
              ? { resourceUris: normalizeResourceUris(input.resourceUris) }
              : {}),
            ...(input.scopes ? { scopes: normalizeScopes(input.scopes) } : {}),
            updatedAt: new Date(),
          });
          return cloneClient(row);
        });
      },
    },
    grants: {
      async authorize(input) {
        return serialize(async () => {
          const existing = [...grants.values()].find(
            (grant) =>
              isActiveGrant(grant, new Date()) && grantMatches(input, grant)
          );
          if (existing) {
            existing.scopes = [...new Set(input.scopes)].sort();
            existing.authorizedAt = new Date();
            existing.updatedAt = new Date();
            return cloneGrant(existing);
          }
          const created = createGrant(input);
          grants.set(created.id, created);
          return cloneGrant(created);
        });
      },
      async findActive(input) {
        const row = [...grants.values()].find(
          (grant) =>
            isActiveGrant(grant, new Date()) && grantMatches(input, grant)
        );
        return row ? cloneGrant(row) : null;
      },
      async get(id) {
        const row = grants.get(id);
        return row ? cloneGrant(row) : null;
      },
      async listForUser(userId) {
        return (await this.list({ userId })).grants;
      },
      async list(input = {}) {
        const now = new Date();
        const matching = [...grants.values()]
          .filter(
            (row) => input.userId === undefined || row.userId === input.userId
          )
          .filter(
            (row) =>
              input.clientId === undefined || row.clientId === input.clientId
          )
          .filter(
            (row) =>
              input.organizationId === undefined ||
              row.organizationId === input.organizationId
          )
          .filter(
            (row) =>
              input.resource === undefined || row.resource === input.resource
          )
          .filter(
            (row) =>
              input.status === undefined ||
              grantHasStatus(row, input.status, now)
          )
          .sort(
            (a, b) =>
              b.authorizedAt.getTime() - a.authorizedAt.getTime() ||
              a.id.localeCompare(b.id)
          );
        const offset = Math.max(0, Math.trunc(input.offset ?? 0));
        const limit = Math.max(0, Math.trunc(input.limit ?? matching.length));
        return {
          grants: matching.slice(offset, offset + limit).map(cloneGrant),
          total: matching.length,
        };
      },
      async revoke(input) {
        await serialize(async () => {
          const row = grants.get(input.grantId);
          if (row) {
            row.status = "revoked";
            row.revokedAt = new Date();
            row.revokedBy = input.revokedBy ?? null;
            row.revokeReason = input.reason;
            row.updatedAt = new Date();
          }
        });
      },
      async touch(id) {
        await serialize(async () => {
          const row = grants.get(id);
          if (row) {
            row.lastUsedAt = new Date();
            row.updatedAt = new Date();
          }
        });
      },
    },
    refreshTokens: {
      async create(input) {
        const row = createRefresh(input);
        refreshTokens.set(input.tokenHash, row);
        return cloneRefresh(row);
      },
      async getByHash(tokenHash) {
        const row = refreshTokens.get(tokenHash);
        return row ? cloneRefresh(row) : null;
      },
      async listFamily(familyId) {
        return [...refreshTokens.values()]
          .filter((row) => row.familyId === familyId)
          .map(cloneRefresh);
      },
      async revokeFamily(familyId, reason) {
        await serialize(async () => {
          for (const row of refreshTokens.values()) {
            if (row.familyId === familyId && row.status !== "revoked") {
              row.status = "revoked";
              row.revokedAt = new Date();
              row.revokeReason = reason;
            }
          }
        });
      },
      async rotate(
        input: RotateOAuthRefreshTokenInput
      ): Promise<OAuthRefreshRotationResult> {
        return serialize(async () => {
          const row = refreshTokens.get(input.tokenHash);
          if (!row) {
            return { kind: "missing" };
          }
          if (row.status !== "active") {
            for (const familyRow of refreshTokens.values()) {
              if (familyRow.familyId === row.familyId) {
                familyRow.status = "reuse_detected";
                familyRow.revokedAt = new Date();
                familyRow.revokeReason = "refresh_token_reuse";
              }
            }
            return { familyId: row.familyId, kind: "replay" };
          }
          if (
            row.clientId !== input.clientId ||
            row.resource !== input.resource ||
            row.expiresAt.getTime() <= Date.now()
          ) {
            return { kind: "missing" };
          }
          row.status = "rotated";
          row.usedAt = new Date();
          row.rotatedAt = new Date();
          const replacement = createRefresh(input.replacement);
          refreshTokens.set(input.replacement.tokenHash, replacement);
          return {
            kind: "rotated",
            previous: cloneRefresh(row),
            replacement: cloneRefresh(replacement),
          };
        });
      },
    },
  };
}
