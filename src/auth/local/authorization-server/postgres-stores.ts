import { ATHENA_AUTH_TABLES } from "../../contract/index.ts";
import type {
  OAuthAuthorizationCode,
  OAuthAuthorizationGrant,
  OAuthAuthorizationRequest,
  OAuthClient,
  OAuthRefreshToken,
  OAuthRevokedAccessToken,
  OidcIdentityScope,
  OidcPrompt,
} from "../../authorization-server/types.ts";
import { normalizeRegisteredRedirectUri } from "../../authorization-server/redirect-uri.ts";
import { normalizeResourceUri } from "../../authorization-server/resource.ts";
import { OAuthProtocolError } from "../../authorization-server/errors.ts";
import type { AthenaAuthDatabase } from "../database.ts";
import { isUniqueViolation } from "../runtime-helpers.ts";
import {
  type AuthorizeOAuthGrantInput,
  type CreateOAuthAuthorizationCodeInput,
  type CreateOAuthClientInput,
  type OAuthAuthorizationServerStores,
  type OAuthGrantListInput,
  type OAuthRefreshRotationResult,
  type RotateOAuthRefreshTokenInput,
  type UpdateOAuthClientInput,
} from "./store.ts";

function normalizeScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
}

function normalizeResourceUris(resources: readonly string[]): string[] {
  return [...new Set(resources.map(normalizeResourceUri))].sort();
}

function date(value: unknown): Date {
  return value instanceof Date ? new Date(value) : new Date(String(value));
}

function nullableDate(value: unknown): Date | null {
  return value == null ? null : date(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function metadata(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function client(row: Record<string, unknown>): OAuthClient {
  return {
    clientName: String(row.client_name),
    clientType: "public",
    clientUrl: typeof row.client_url === "string" ? row.client_url : null,
    createdAt: date(row.created_at),
    grantType: "authorization_code",
    id: String(row.id),
    isActive: row.is_active !== false,
    metadata: metadata(row.metadata),
    redirectUris: stringArray(row.redirect_uris),
    registrationKind: "pre-registered",
    resourceUris: stringArray(row.resource_uris),
    responseType: "code",
    scopes: stringArray(row.scopes),
    tokenEndpointAuthMethod: "none",
    updatedAt: date(row.updated_at),
  };
}

function grant(row: Record<string, unknown>): OAuthAuthorizationGrant {
  return {
    authorizedAt: date(row.authorized_at),
    clientId: String(row.client_id),
    createdAt: date(row.created_at),
    expiresAt: nullableDate(row.expires_at),
    id: String(row.id),
    identityScopes: stringArray(row.identity_scopes) as OidcIdentityScope[],
    lastUsedAt: nullableDate(row.last_used_at),
    organizationId:
      typeof row.organization_id === "string" ? row.organization_id : null,
    resource: String(row.resource),
    revokedAt: nullableDate(row.revoked_at),
    revokedBy: typeof row.revoked_by === "string" ? row.revoked_by : null,
    revokeReason:
      typeof row.revoke_reason === "string" ? row.revoke_reason : null,
    scopes: stringArray(row.scopes),
    status:
      row.status === "revoked" || row.status === "expired"
        ? row.status
        : "active",
    updatedAt: date(row.updated_at),
    userId: String(row.user_id),
  };
}

function authorizationRequest(
  row: Record<string, unknown>
): OAuthAuthorizationRequest {
  return {
    clientId: String(row.client_id),
    codeChallenge: String(row.code_challenge),
    codeChallengeMethod: "S256",
    createdAt: date(row.created_at),
    expiresAt: date(row.expires_at),
    id: String(row.id),
    identityScopes: stringArray(row.identity_scopes) as OidcIdentityScope[],
    maxAge:
      row.max_age == null
        ? null
        : typeof row.max_age === "number"
          ? row.max_age
          : Number(row.max_age),
    nonce: typeof row.nonce === "string" ? row.nonce : null,
    organizationId:
      typeof row.organization_id === "string" ? row.organization_id : null,
    prompt: stringArray(row.prompt) as OidcPrompt[],
    redirectUri: String(row.redirect_uri),
    requestedScopes: stringArray(row.requested_scopes),
    resolvedAt: nullableDate(row.resolved_at),
    resource: String(row.resource),
    stateCiphertext: String(row.state_ciphertext),
    status:
      row.status === "approved" ||
      row.status === "denied" ||
      row.status === "expired" ||
      row.status === "consumed"
        ? row.status
        : "pending",
    userId: typeof row.user_id === "string" ? row.user_id : null,
  };
}

function authorizationCode(
  row: Record<string, unknown>
): OAuthAuthorizationCode {
  return {
    authenticatedAt: date(row.authenticated_at ?? row.created_at),
    authenticationMethods: stringArray(row.authentication_methods),
    clientId: String(row.client_id),
    codeChallenge: String(row.code_challenge),
    codeChallengeMethod: "S256",
    consumedAt: nullableDate(row.consumed_at),
    consumeReason:
      typeof row.consume_reason === "string" ? row.consume_reason : null,
    createdAt: date(row.created_at),
    expiresAt: date(row.expires_at),
    grantId: String(row.grant_id),
    id: String(row.id),
    identityScopes: stringArray(row.identity_scopes) as OidcIdentityScope[],
    nonce: typeof row.nonce === "string" ? row.nonce : null,
    organizationId:
      typeof row.organization_id === "string" ? row.organization_id : null,
    redirectUri: String(row.redirect_uri),
    resource: String(row.resource),
    scopes: stringArray(row.scopes),
    userId: String(row.user_id),
  };
}

function refreshToken(row: Record<string, unknown>): OAuthRefreshToken {
  const status = row.status;
  return {
    clientId: String(row.client_id),
    createdAt: date(row.created_at),
    expiresAt: date(row.expires_at),
    familyId: String(row.family_id),
    grantId: String(row.grant_id),
    id: String(row.id),
    identityScopes: stringArray(row.identity_scopes) as OidcIdentityScope[],
    organizationId:
      typeof row.organization_id === "string" ? row.organization_id : null,
    parentTokenId:
      typeof row.parent_token_id === "string" ? row.parent_token_id : null,
    resource: String(row.resource),
    revokedAt: nullableDate(row.revoked_at),
    revokeReason:
      typeof row.revoke_reason === "string" ? row.revoke_reason : null,
    rotatedAt: nullableDate(row.rotated_at),
    scopes: stringArray(row.scopes),
    status:
      status === "rotated" ||
      status === "revoked" ||
      status === "expired" ||
      status === "reuse_detected"
        ? status
        : "active",
    usedAt: nullableDate(row.used_at),
    userId: String(row.user_id),
  };
}

export function createPostgresOAuthAuthorizationServerStores(
  database: AthenaAuthDatabase,
  options: { transactionBound?: boolean } = {}
): OAuthAuthorizationServerStores {
  const transaction = <T>(
    fn: (tx: AthenaAuthDatabase) => Promise<T>
  ): Promise<T> =>
    options.transactionBound ? fn(database) : database.transaction(fn);

  return {
    completeAuthorization: async (input) =>
      transaction(async (tx) => {
        const requestResult = await tx.query<Record<string, unknown>>(
          `SELECT * FROM ${ATHENA_AUTH_TABLES.oauthAuthorizationRequests}
           WHERE id = $1
           FOR UPDATE`,
          [input.requestId]
        );
        const requestRow = requestResult.rows[0];
        const request = requestRow
          ? authorizationRequest(requestRow)
          : undefined;
        if (
          !request ||
          request.status !== "pending" ||
          request.userId !== null ||
          request.expiresAt.getTime() <= Date.now()
        ) {
          throw new Error("OAuth authorization interaction is not pending");
        }
        const existingGrant = await tx.query<Record<string, unknown>>(
          `SELECT * FROM ${ATHENA_AUTH_TABLES.oauthAuthorizationGrants}
           WHERE client_id = $1 AND user_id = $2
             AND organization_id IS NOT DISTINCT FROM $3
             AND resource = $4 AND status = 'active'
             AND (expires_at IS NULL OR expires_at > NOW())
           FOR UPDATE`,
          [
            input.clientId,
            input.userId,
            input.organizationId ?? null,
            input.resource,
          ]
        );
        const lockedGrant = existingGrant.rows[0]
          ? grant(existingGrant.rows[0])
          : null;
        if (
          input.preserveExistingGrant &&
          (!lockedGrant ||
            input.scopes.some((scope) => !lockedGrant.scopes.includes(scope)) ||
            input.identityScopes.some(
              (scope) => !lockedGrant.identityScopes.includes(scope)
            ))
        ) {
          throw new OAuthProtocolError(
            "consent_required",
            "The user has not consented to this request."
          );
        }
        let grantRow: Record<string, unknown>;
        if (input.preserveExistingGrant) {
          grantRow = existingGrant.rows[0] as Record<string, unknown>;
        } else if (existingGrant.rows[0]) {
          const updated = await tx.query<Record<string, unknown>>(
            `UPDATE ${ATHENA_AUTH_TABLES.oauthAuthorizationGrants}
             SET scopes = $2,
                 identity_scopes = $3,
                 authorized_at = NOW(), updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [
              existingGrant.rows[0].id,
              input.scopes,
              input.identityScopes,
            ]
          );
          grantRow = updated.rows[0] as Record<string, unknown>;
        } else {
          const created = await tx.query<Record<string, unknown>>(
            `INSERT INTO ${ATHENA_AUTH_TABLES.oauthAuthorizationGrants} (
               id, user_id, organization_id, client_id, resource, scopes,
               identity_scopes
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
              crypto.randomUUID(),
              input.userId,
              input.organizationId ?? null,
              input.clientId,
              input.resource,
              input.scopes,
              input.identityScopes,
            ]
          );
          grantRow = created.rows[0] as Record<string, unknown>;
        }
        const codeResult = await tx.query<Record<string, unknown>>(
          `INSERT INTO ${ATHENA_AUTH_TABLES.oauthAuthorizationCodes} (
             id, code_hash, grant_id, user_id, organization_id, client_id,
             redirect_uri, resource, scopes, code_challenge,
             code_challenge_method, expires_at, identity_scopes, nonce, authenticated_at,
             authentication_methods
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           RETURNING *`,
          [
            input.id,
            input.codeHash,
            grantRow.id,
            input.userId,
            input.organizationId ?? null,
            input.clientId,
            input.redirectUri,
            input.resource,
            input.scopes,
            input.codeChallenge,
            input.codeChallengeMethod,
            input.expiresAt,
            input.identityScopes,
            input.nonce ?? null,
            input.authenticatedAt,
            input.authenticationMethods,
          ]
        );
        const consumedRequest = await tx.query<Record<string, unknown>>(
          `UPDATE ${ATHENA_AUTH_TABLES.oauthAuthorizationRequests}
           SET status = 'consumed', user_id = $2, organization_id = $3,
               resolved_at = NOW()
           WHERE id = $1 AND status = 'pending'
           RETURNING *`,
          [input.requestId, input.userId, input.organizationId ?? null]
        );
        if (!consumedRequest.rows[0]) {
          throw new Error(
            "OAuth authorization interaction could not be consumed"
          );
        }
        return {
          code: authorizationCode(
            codeResult.rows[0] as Record<string, unknown>
          ),
          grant: grant(grantRow),
          request: authorizationRequest(consumedRequest.rows[0]),
        };
      }),
    accessTokens: {
      async isRevoked(jti) {
        const result = await database.query<Record<string, unknown>>(
          `SELECT jti FROM ${ATHENA_AUTH_TABLES.oauthRevokedAccessTokens}
           WHERE jti = $1 AND expires_at > NOW()`,
          [jti]
        );
        return Boolean(result.rows[0]);
      },
      async revoke(input: OAuthRevokedAccessToken) {
        await database.query(
          `INSERT INTO ${ATHENA_AUTH_TABLES.oauthRevokedAccessTokens}
             (jti, grant_id, expires_at, revoked_at, reason)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (jti) DO UPDATE SET
             expires_at = EXCLUDED.expires_at,
             reason = EXCLUDED.reason`,
          [
            input.jti,
            input.grantId,
            input.expiresAt,
            input.revokedAt,
            input.reason,
          ]
        );
      },
    },
    authorizationCodes: {
      async consume(input) {
        return transaction(async (tx) => {
          const result = await tx.query<Record<string, unknown>>(
            `SELECT * FROM ${ATHENA_AUTH_TABLES.oauthAuthorizationCodes}
             WHERE code_hash = $1
             FOR UPDATE`,
            [input.codeHash]
          );
          const row = result.rows[0];
          if (!row) {
            return null;
          }
          const code = authorizationCode(row);
          if (
            code.consumedAt ||
            code.expiresAt.getTime() <= Date.now() ||
            code.clientId !== input.clientId ||
            code.redirectUri !== input.redirectUri ||
            code.resource !== input.resource
          ) {
            return null;
          }
          const consumed = await tx.query<Record<string, unknown>>(
            `UPDATE ${ATHENA_AUTH_TABLES.oauthAuthorizationCodes}
             SET consumed_at = NOW(), consume_reason = 'consumed'
             WHERE code_hash = $1 AND consumed_at IS NULL
             RETURNING *`,
            [input.codeHash]
          );
          return consumed.rows[0] ? authorizationCode(consumed.rows[0]) : null;
        });
      },
      async create(
        input: CreateOAuthAuthorizationCodeInput & { codeHash: string }
      ) {
        const result = await database.query<Record<string, unknown>>(
          `INSERT INTO ${ATHENA_AUTH_TABLES.oauthAuthorizationCodes} (
             id, code_hash, grant_id, user_id, organization_id, client_id,
             redirect_uri, resource, scopes, code_challenge,
             code_challenge_method, expires_at, nonce, authenticated_at,
             authentication_methods
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING *`,
          [
            input.id,
            input.codeHash,
            input.grantId,
            input.userId,
            input.organizationId ?? null,
            input.clientId,
            input.redirectUri,
            input.resource,
            input.scopes,
            input.codeChallenge,
            input.codeChallengeMethod,
            input.expiresAt,
            input.nonce ?? null,
            input.authenticatedAt ?? new Date(),
            input.authenticationMethods ?? [],
          ]
        );
        return authorizationCode(result.rows[0] as Record<string, unknown>);
      },
      async getByHash(codeHash) {
        const result = await database.query<Record<string, unknown>>(
          `SELECT * FROM ${ATHENA_AUTH_TABLES.oauthAuthorizationCodes}
           WHERE code_hash = $1`,
          [codeHash]
        );
        return result.rows[0] ? authorizationCode(result.rows[0]) : null;
      },
    },
    authorizationRequests: {
      async approve(id, input) {
        const result = await database.query<Record<string, unknown>>(
          `UPDATE ${ATHENA_AUTH_TABLES.oauthAuthorizationRequests}
           SET status = 'approved', user_id = $2, organization_id = $3,
               resolved_at = NOW()
           WHERE id = $1 AND status = 'pending' AND expires_at > NOW()
           RETURNING *`,
          [id, input.userId, input.organizationId ?? null]
        );
        return result.rows[0] ? authorizationRequest(result.rows[0]) : null;
      },
      async create(input) {
        const result = await database.query<Record<string, unknown>>(
          `INSERT INTO ${ATHENA_AUTH_TABLES.oauthAuthorizationRequests} (
             id, request_hash, client_id, redirect_uri, resource,
             requested_scopes, state_ciphertext, code_challenge,
             code_challenge_method, user_id, organization_id, expires_at,
             identity_scopes, nonce, max_age, prompt
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           RETURNING *`,
          [
            input.id,
            input.requestHash,
            input.clientId,
            input.redirectUri,
            input.resource,
            input.requestedScopes,
            input.stateCiphertext,
            input.codeChallenge,
            input.codeChallengeMethod,
            input.userId ?? null,
            input.organizationId ?? null,
            input.expiresAt,
            input.identityScopes ?? [],
            input.nonce ?? null,
            input.maxAge ?? null,
            input.prompt ?? [],
          ]
        );
        return authorizationRequest(result.rows[0] as Record<string, unknown>);
      },
      async deny(id) {
        await database.query(
          `UPDATE ${ATHENA_AUTH_TABLES.oauthAuthorizationRequests}
           SET status = 'denied', resolved_at = NOW()
           WHERE id = $1 AND status = 'pending'`,
          [id]
        );
      },
      async get(id) {
        const result = await database.query<Record<string, unknown>>(
          `SELECT * FROM ${ATHENA_AUTH_TABLES.oauthAuthorizationRequests}
           WHERE id = $1`,
          [id]
        );
        return result.rows[0] ? authorizationRequest(result.rows[0]) : null;
      },
      async consume(id) {
        const result = await database.query<Record<string, unknown>>(
          `UPDATE ${ATHENA_AUTH_TABLES.oauthAuthorizationRequests}
           SET status = 'consumed', resolved_at = NOW()
           WHERE id = $1 AND status = 'approved'
           RETURNING *`,
          [id]
        );
        return result.rows[0] ? authorizationRequest(result.rows[0]) : null;
      },
    },
    clients: {
      async create(input: CreateOAuthClientInput) {
        const result = await database.query<Record<string, unknown>>(
          `INSERT INTO ${ATHENA_AUTH_TABLES.oauthClients} (
             id, client_name, client_type, registration_kind, response_type,
             grant_type, token_authentication_method, redirect_uris, scopes,
             resource_uris, client_url, metadata
           ) VALUES ($1, $2, 'public', 'pre-registered', 'code',
             'authorization_code', 'none', $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            input.id,
            input.clientName,
            input.redirectUris.map(normalizeRegisteredRedirectUri),
            normalizeScopes(input.scopes),
            normalizeResourceUris(input.resourceUris),
            input.clientUrl ?? null,
            input.metadata ?? {},
          ]
        );
        return client(result.rows[0] as Record<string, unknown>);
      },
      async disable(clientId) {
        await database.query(
          `UPDATE ${ATHENA_AUTH_TABLES.oauthClients}
           SET is_active = FALSE, updated_at = NOW()
           WHERE id = $1`,
          [clientId]
        );
      },
      async get(clientId) {
        const result = await database.query<Record<string, unknown>>(
          `SELECT * FROM ${ATHENA_AUTH_TABLES.oauthClients} WHERE id = $1`,
          [clientId]
        );
        return result.rows[0] ? client(result.rows[0]) : null;
      },
      async list(input = {}) {
        const where =
          input.isActive === undefined ? "" : "WHERE is_active = $1";
        const params = input.isActive === undefined ? [] : [input.isActive];
        const count = await database.query<{ total: string | number }>(
          `SELECT COUNT(*) AS total FROM ${ATHENA_AUTH_TABLES.oauthClients} ${where}`,
          params
        );
        const offset = Math.max(0, Math.trunc(input.offset ?? 0));
        const limit = input.limit === undefined ? "ALL" : `$${params.length + 1}`;
        const pageParams: unknown[] = [...params];
        if (input.limit !== undefined) {
          pageParams.push(Math.max(0, Math.trunc(input.limit)));
        }
        pageParams.push(offset);
        const rows = await database.query<Record<string, unknown>>(
          `SELECT * FROM ${ATHENA_AUTH_TABLES.oauthClients} ${where}
           ORDER BY created_at DESC, id ASC
           LIMIT ${limit} OFFSET $${pageParams.length}`,
          pageParams
        );
        return {
          clients: rows.rows.map(client),
          total: Number(count.rows[0]?.total ?? 0),
        };
      },
      async update(clientId: string, input: UpdateOAuthClientInput) {
        const existing = await this.get(clientId);
        if (!existing) {
          return null;
        }
        const result = await database.query<Record<string, unknown>>(
          `UPDATE ${ATHENA_AUTH_TABLES.oauthClients}
           SET client_name = $2, client_url = $3, redirect_uris = $4,
               scopes = $5, resource_uris = $6, metadata = $7,
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [
            clientId,
            input.clientName ?? existing.clientName,
            input.clientUrl === undefined
              ? existing.clientUrl
              : input.clientUrl,
            input.redirectUris
              ? input.redirectUris.map(normalizeRegisteredRedirectUri)
              : existing.redirectUris,
            input.scopes ? normalizeScopes(input.scopes) : existing.scopes,
            input.resourceUris
              ? normalizeResourceUris(input.resourceUris)
              : existing.resourceUris,
            input.metadata ?? existing.metadata,
          ]
        );
        return result.rows[0] ? client(result.rows[0]) : null;
      },
    },
    grants: {
      async authorize(input: AuthorizeOAuthGrantInput) {
        try {
          return await transaction(async (tx) => {
            const existing = await tx.query<Record<string, unknown>>(
              `SELECT * FROM ${ATHENA_AUTH_TABLES.oauthAuthorizationGrants}
             WHERE client_id = $1 AND user_id = $2
               AND organization_id IS NOT DISTINCT FROM $3
               AND resource = $4 AND status = 'active'
             FOR UPDATE`,
              [
                input.clientId,
                input.userId,
                input.organizationId,
                input.resource,
              ]
            );
            if (existing.rows[0]) {
              const result = await tx.query<Record<string, unknown>>(
                `UPDATE ${ATHENA_AUTH_TABLES.oauthAuthorizationGrants}
               SET scopes = $2, authorized_at = NOW(), updated_at = NOW()
               WHERE id = $1
               RETURNING *`,
                [existing.rows[0].id, input.scopes]
              );
              return grant(result.rows[0] as Record<string, unknown>);
            }
            const result = await tx.query<Record<string, unknown>>(
              `INSERT INTO ${ATHENA_AUTH_TABLES.oauthAuthorizationGrants} (
               id, user_id, organization_id, client_id, resource, scopes
             ) VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
              [
                crypto.randomUUID(),
                input.userId,
                input.organizationId,
                input.clientId,
                input.resource,
                input.scopes,
              ]
            );
            return grant(result.rows[0] as Record<string, unknown>);
          });
        } catch (error) {
          if (!isUniqueViolation(error)) {
            throw error;
          }
          const raced = await this.findActive(input);
          if (!raced) {
            throw error;
          }
          const result = await database.query<Record<string, unknown>>(
            `UPDATE ${ATHENA_AUTH_TABLES.oauthAuthorizationGrants}
             SET scopes = $2, authorized_at = NOW(), updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [raced.id, input.scopes]
          );
          return grant(result.rows[0] as Record<string, unknown>);
        }
      },
      async findActive(input) {
        const result = await database.query<Record<string, unknown>>(
          `SELECT * FROM ${ATHENA_AUTH_TABLES.oauthAuthorizationGrants}
           WHERE client_id = $1 AND user_id = $2
             AND organization_id IS NOT DISTINCT FROM $3
             AND resource = $4 AND status = 'active'
             AND (expires_at IS NULL OR expires_at > NOW())`,
          [input.clientId, input.userId, input.organizationId, input.resource]
        );
        return result.rows[0] ? grant(result.rows[0]) : null;
      },
      async listForUser(userId) {
        return (await this.list({ userId })).grants;
      },
      async list(input: OAuthGrantListInput = {}) {
        const clauses: string[] = [];
        const params: unknown[] = [];
        for (const [key, column] of [
          ["userId", "user_id"],
          ["clientId", "client_id"],
          ["organizationId", "organization_id"],
          ["resource", "resource"],
        ] as const) {
          const value = input[key];
          if (value !== undefined) {
            params.push(value);
            clauses.push(
              key === "organizationId"
                ? `${column} IS NOT DISTINCT FROM $${params.length}`
                : `${column} = $${params.length}`
            );
          }
        }
        if (input.status === "active") {
          clauses.push(
            "(status = 'active' AND (expires_at IS NULL OR expires_at > NOW()) AND revoked_at IS NULL)"
          );
        } else if (input.status === "expired") {
          clauses.push(
            "(status = 'expired' OR (status = 'active' AND expires_at IS NOT NULL AND expires_at <= NOW()))"
          );
        } else if (input.status === "revoked") {
          clauses.push("(status = 'revoked' OR revoked_at IS NOT NULL)");
        }
        const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
        const count = await database.query<{ total: string | number }>(
          `SELECT COUNT(*) AS total FROM ${ATHENA_AUTH_TABLES.oauthAuthorizationGrants} ${where}`,
          params
        );
        const offset = Math.max(0, Math.trunc(input.offset ?? 0));
        const limit = input.limit === undefined ? "ALL" : `$${params.length + 1}`;
        const pageParams = [...params];
        if (input.limit !== undefined) {
          pageParams.push(Math.max(0, Math.trunc(input.limit)));
        }
        pageParams.push(offset);
        const result = await database.query<Record<string, unknown>>(
          `SELECT * FROM ${ATHENA_AUTH_TABLES.oauthAuthorizationGrants}
           ${where}
           ORDER BY authorized_at DESC, id ASC
           LIMIT ${limit} OFFSET $${pageParams.length}`,
          pageParams
        );
        return {
          grants: result.rows.map(grant),
          total: Number(count.rows[0]?.total ?? 0),
        };
      },
      async get(id) {
        const result = await database.query<Record<string, unknown>>(
          `SELECT * FROM ${ATHENA_AUTH_TABLES.oauthAuthorizationGrants}
           WHERE id = $1`,
          [id]
        );
        return result.rows[0] ? grant(result.rows[0]) : null;
      },
      async revoke(input) {
        await database.query(
          `UPDATE ${ATHENA_AUTH_TABLES.oauthAuthorizationGrants}
           SET status = 'revoked', revoked_at = NOW(), revoked_by = $2,
               revoke_reason = $3, updated_at = NOW()
           WHERE id = $1`,
          [input.grantId, input.revokedBy ?? null, input.reason]
        );
      },
      async touch(id) {
        await database.query(
          `UPDATE ${ATHENA_AUTH_TABLES.oauthAuthorizationGrants}
           SET last_used_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND status = 'active'`,
          [id]
        );
      },
    },
    refreshTokens: {
      async create(input) {
        const result = await database.query<Record<string, unknown>>(
          `INSERT INTO ${ATHENA_AUTH_TABLES.oauthRefreshTokens} (
             id, token_hash, family_id, grant_id, client_id, user_id,
             organization_id, resource, scopes, identity_scopes, parent_token_id, expires_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING *`,
          [
            input.id,
            input.tokenHash,
            input.familyId,
            input.grantId,
            input.clientId,
            input.userId,
            input.organizationId ?? null,
            input.resource,
            input.scopes,
            input.identityScopes,
            input.parentTokenId ?? null,
            input.expiresAt,
          ]
        );
        return refreshToken(result.rows[0] as Record<string, unknown>);
      },
      async getByHash(tokenHash) {
        const result = await database.query<Record<string, unknown>>(
          `SELECT * FROM ${ATHENA_AUTH_TABLES.oauthRefreshTokens}
           WHERE token_hash = $1`,
          [tokenHash]
        );
        return result.rows[0] ? refreshToken(result.rows[0]) : null;
      },
      async listFamily(familyId) {
        const result = await database.query<Record<string, unknown>>(
          `SELECT * FROM ${ATHENA_AUTH_TABLES.oauthRefreshTokens}
           WHERE family_id = $1
           ORDER BY created_at ASC`,
          [familyId]
        );
        return result.rows.map(refreshToken);
      },
      async revokeFamily(familyId, reason) {
        await database.query(
          `UPDATE ${ATHENA_AUTH_TABLES.oauthRefreshTokens}
           SET status = 'revoked', revoked_at = NOW(), revoke_reason = $2
           WHERE family_id = $1 AND status <> 'revoked'`,
          [familyId, reason]
        );
      },
      async rotate(input: RotateOAuthRefreshTokenInput) {
        return transaction(async (tx): Promise<OAuthRefreshRotationResult> => {
          const selected = await tx.query<Record<string, unknown>>(
            `SELECT * FROM ${ATHENA_AUTH_TABLES.oauthRefreshTokens}
             WHERE token_hash = $1
             FOR UPDATE`,
            [input.tokenHash]
          );
          const raw = selected.rows[0];
          if (!raw) {
            return { kind: "missing" };
          }
          const previous = refreshToken(raw);
          if (previous.status !== "active") {
            await tx.query(
              `UPDATE ${ATHENA_AUTH_TABLES.oauthRefreshTokens}
               SET status = 'reuse_detected', revoked_at = NOW(),
                   revoke_reason = 'refresh_token_reuse'
               WHERE family_id = $1`,
              [previous.familyId]
            );
            return { familyId: previous.familyId, kind: "replay" };
          }
          if (
            previous.clientId !== input.clientId ||
            previous.resource !== input.resource ||
            previous.expiresAt.getTime() <= Date.now()
          ) {
            return { kind: "missing" };
          }
          await tx.query(
            `UPDATE ${ATHENA_AUTH_TABLES.oauthRefreshTokens}
             SET status = 'rotated', used_at = NOW(), rotated_at = NOW()
             WHERE token_hash = $1 AND status = 'active'`,
            [input.tokenHash]
          );
          const inserted = await tx.query<Record<string, unknown>>(
            `INSERT INTO ${ATHENA_AUTH_TABLES.oauthRefreshTokens} (
               id, token_hash, family_id, grant_id, client_id, user_id,
               organization_id, resource, scopes, identity_scopes, parent_token_id, expires_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING *`,
            [
              input.replacement.id,
              input.replacement.tokenHash,
              input.replacement.familyId,
              input.replacement.grantId,
              input.replacement.clientId,
              input.replacement.userId,
              input.replacement.organizationId ?? null,
              input.replacement.resource,
              input.replacement.scopes,
              input.replacement.identityScopes,
              input.replacement.parentTokenId ?? null,
              input.replacement.expiresAt,
            ]
          );
          return {
            kind: "rotated",
            previous,
            replacement: refreshToken(
              inserted.rows[0] as Record<string, unknown>
            ),
          };
        });
      },
    },
  };
}
