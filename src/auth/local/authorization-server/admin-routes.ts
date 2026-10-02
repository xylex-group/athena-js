import type {
  OAuthAuthorizationGrant,
  OAuthClient,
} from "../../authorization-server/types.ts";
import { normalizeRegisteredRedirectUri } from "../../authorization-server/redirect-uri.ts";
import { normalizeResourceUri } from "../../authorization-server/resource.ts";
import type {
  AthenaAuthorizationServerClient,
  AthenaAuthorizationServerGrant,
} from "../../types/catalog.ts";
import type { AthenaAuthMutationScope } from "../../hooks/scope.ts";
import { requireAthenaAdmin } from "../admin-guard.ts";
import { AthenaAuthRuntimeError, jsonResponse } from "../errors.ts";
import type { AthenaAuthStores } from "../memory-stores.ts";
import type { AuthRuntimeDependencies } from "../runtime-dependencies.ts";
import { readJsonBody, requireStringField } from "../security.ts";

const CLIENT_SERVER_FIELDS = [
  "clientType",
  "grantType",
  "isActive",
  "provider",
  "registrationKind",
  "responseType",
  "tokenEndpointAuthMethod",
] as const;

function rejectServerFields(
  body: Record<string, unknown>,
  fields: readonly string[]
): void {
  const field = fields.find((key) => Object.hasOwn(body, key));
  if (field) {
    throw AthenaAuthRuntimeError.badRequest(`${field} is server-managed`);
  }
}

function toAuthorizationServerClientDto(
  client: OAuthClient
): AthenaAuthorizationServerClient {
  return {
    clientName: client.clientName,
    clientType: client.clientType,
    clientUrl: client.clientUrl,
    createdAt: client.createdAt.toISOString(),
    grantType: client.grantType,
    id: client.id,
    isActive: client.isActive,
    metadata: client.metadata,
    redirectUris: client.redirectUris,
    registrationKind: client.registrationKind,
    resourceUris: client.resourceUris,
    responseType: client.responseType,
    scopes: client.scopes,
    tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
    updatedAt: client.updatedAt.toISOString(),
  };
}

function toAuthorizationServerGrantDto(
  grant: OAuthAuthorizationGrant
): AthenaAuthorizationServerGrant {
  return {
    authorizedAt: grant.authorizedAt.toISOString(),
    clientId: grant.clientId,
    createdAt: grant.createdAt.toISOString(),
    expiresAt: grant.expiresAt?.toISOString() ?? null,
    id: grant.id,
    lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
    organizationId: grant.organizationId,
    resource: grant.resource,
    revokeReason: grant.revokeReason,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    revokedBy: grant.revokedBy,
    scopes: grant.scopes,
    status: grant.status,
    updatedAt: grant.updatedAt.toISOString(),
    userId: grant.userId,
  };
}

function stringArray(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw AthenaAuthRuntimeError.badRequest(
      `${key} must be an array of strings`
    );
  }
  return value.map((entry) => (entry as string).trim()).filter(Boolean);
}

function metadataField(body: Record<string, unknown>) {
  const metadata = body.metadata;
  if (metadata === undefined) {
    return undefined;
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw AthenaAuthRuntimeError.badRequest("metadata must be an object");
  }
  return metadata as Record<string, unknown>;
}

function optionalText(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value !== "string") {
    throw AthenaAuthRuntimeError.badRequest(`${key} must be a string or null`);
  }
  return value.trim();
}

function queryText(url: URL, key: string) {
  const value = url.searchParams.get(key)?.trim();
  return value || undefined;
}

function nullableQueryText(url: URL, key: string) {
  // A missing key omits the filter; an empty value requests SQL NULL.
  if (!url.searchParams.has(key)) {
    return undefined;
  }
  return url.searchParams.get(key)?.trim() || null;
}

function queryInteger(url: URL, key: string, fallback: number) {
  const value = url.searchParams.get(key);
  if (value === null) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw AthenaAuthRuntimeError.badRequest(
      `${key} must be a non-negative integer`
    );
  }
  return parsed;
}

function queryPage(url: URL) {
  return {
    limit: Math.min(queryInteger(url, "limit", 50), 100),
    offset: queryInteger(url, "offset", 0),
  };
}

function normalizedList(
  body: Record<string, unknown>,
  key: string,
  normalize: (value: string) => string
): string[] {
  try {
    return [...new Set(stringArray(body, key).map(normalize))].sort();
  } catch (error) {
    if (error instanceof AthenaAuthRuntimeError) {
      throw error;
    }
    throw AthenaAuthRuntimeError.badRequest(
      error instanceof Error ? error.message : `${key} contains an invalid value`
    );
  }
}

function transactionOAuth(scope: AthenaAuthMutationScope) {
  if (!scope.oauth) {
    throw AthenaAuthRuntimeError.internal(
      new Error("OAuth Authorization Server stores are unavailable in mutation scope")
    );
  }
  return scope.oauth;
}

export async function handleAuthorizationServerAdminRoutes(
  request: Request,
  path: string,
  method: string,
  input: {
    deps: AuthRuntimeDependencies;
    headers: Headers;
    stores: AthenaAuthStores;
  }
): Promise<Response | undefined> {
  if (!path.startsWith("/admin/authorization-server/")) {
    return undefined;
  }
  const { deps, headers, stores } = input;
  const admin = await requireAthenaAdmin(request, (candidate) =>
    deps.requireSession(candidate, stores)
  );
  const body =
    method === "POST"
      ? await readJsonBody(request, deps.config.security.bodyLimitBytes)
      : undefined;

  if (
    path === "/admin/authorization-server/client/create" &&
    method === "POST"
  ) {
    const fields = body as Record<string, unknown>;
    rejectServerFields(fields, CLIENT_SERVER_FIELDS);
    const redirectUris = normalizedList(
      fields,
      "redirectUris",
      normalizeRegisteredRedirectUri
    );
    if (redirectUris.length === 0) {
      throw AthenaAuthRuntimeError.badRequest(
        "redirectUris must contain at least one URI"
      );
    }
    const clientInput = {
      clientName: requireStringField(fields, "clientName"),
      clientUrl: optionalText(fields, "clientUrl"),
      id: crypto.randomUUID(),
      metadata: metadataField(fields),
      redirectUris,
      resourceUris: normalizedList(fields, "resourceUris", normalizeResourceUri),
      scopes: normalizedList(fields, "scopes", (scope) => scope),
    };
    const client = await deps.transaction((scope) =>
      transactionOAuth(scope).clients.create(clientInput)
    );
    return jsonResponse(
      200,
      { client: toAuthorizationServerClientDto(client) },
      headers
    );
  }

  if (path === "/admin/authorization-server/client/get" && method === "GET") {
    const clientId = queryText(new URL(request.url), "clientId");
    if (!clientId) {
      throw AthenaAuthRuntimeError.badRequest("clientId is required");
    }
    const oauth = await deps.getOAuthStores();
    const client = await oauth.clients.get(clientId);
    if (!client) {
      throw AthenaAuthRuntimeError.notFound("OAuth client not found");
    }
    return jsonResponse(
      200,
      { client: toAuthorizationServerClientDto(client) },
      headers
    );
  }

  if (path === "/admin/authorization-server/client/list" && method === "GET") {
    const url = new URL(request.url);
    const active = queryText(url, "isActive");
    if (active !== undefined && active !== "true" && active !== "false") {
      throw AthenaAuthRuntimeError.badRequest("isActive must be true or false");
    }
    const pageOptions = queryPage(url);
    const oauth = await deps.getOAuthStores();
    const page = await oauth.clients.list({
      isActive: active === undefined ? undefined : active === "true",
      ...pageOptions,
    });
    return jsonResponse(
      200,
      {
        clients: page.clients.map(toAuthorizationServerClientDto),
        ...pageOptions,
        total: page.total,
      },
      headers
    );
  }

  if (
    path === "/admin/authorization-server/client/update" &&
    method === "POST"
  ) {
    const fields = body as Record<string, unknown>;
    rejectServerFields(fields, ["id", ...CLIENT_SERVER_FIELDS]);
    const clientId = requireStringField(fields, "clientId");
    const redirectUris =
      fields.redirectUris === undefined
        ? undefined
        : normalizedList(fields, "redirectUris", normalizeRegisteredRedirectUri);
    if (redirectUris?.length === 0) {
      throw AthenaAuthRuntimeError.badRequest(
        "redirectUris must contain at least one URI"
      );
    }
    const clientName =
      fields.clientName === undefined
        ? undefined
        : requireStringField(fields, "clientName");
    const client = await deps.transaction((scope) =>
      transactionOAuth(scope).clients.update(clientId, {
        clientName,
        clientUrl: optionalText(fields, "clientUrl"),
        metadata: metadataField(fields),
        redirectUris,
        resourceUris:
          fields.resourceUris === undefined
            ? undefined
            : normalizedList(fields, "resourceUris", normalizeResourceUri),
        scopes:
          fields.scopes === undefined
            ? undefined
            : normalizedList(fields, "scopes", (scope) => scope),
      })
    );
    if (!client) {
      throw AthenaAuthRuntimeError.notFound("OAuth client not found");
    }
    return jsonResponse(
      200,
      { client: toAuthorizationServerClientDto(client) },
      headers
    );
  }

  if (
    path === "/admin/authorization-server/client/disable" &&
    method === "POST"
  ) {
    const clientId = requireStringField(
      body as Record<string, unknown>,
      "clientId"
    );
    await deps.transaction(async (scope) => {
      const oauth = transactionOAuth(scope);
      if (!(await oauth.clients.get(clientId))) {
        throw AthenaAuthRuntimeError.notFound("OAuth client not found");
      }
      await oauth.clients.disable(clientId);
    });
    return jsonResponse(200, { clientId, disabled: true }, headers);
  }

  if (path === "/admin/authorization-server/grant/list" && method === "GET") {
    const url = new URL(request.url);
    const status = queryText(url, "status");
    if (
      status !== undefined &&
      status !== "active" &&
      status !== "expired" &&
      status !== "revoked"
    ) {
      throw AthenaAuthRuntimeError.badRequest("status is invalid");
    }
    const pageOptions = queryPage(url);
    const oauth = await deps.getOAuthStores();
    const page = await oauth.grants.list({
      clientId: queryText(url, "clientId"),
      ...pageOptions,
      organizationId: nullableQueryText(url, "organizationId"),
      resource: queryText(url, "resource"),
      status: status as OAuthAuthorizationGrant["status"] | undefined,
      userId: queryText(url, "userId"),
    });
    return jsonResponse(
      200,
      {
        grants: page.grants.map(toAuthorizationServerGrantDto),
        ...pageOptions,
        total: page.total,
      },
      headers
    );
  }

  if (
    path === "/admin/authorization-server/grant/revoke" &&
    method === "POST"
  ) {
    const fields = body as Record<string, unknown>;
    const grantId = requireStringField(fields, "grantId");
    const reason = requireStringField(fields, "reason");
    await deps.transaction(async (scope) => {
      const oauth = transactionOAuth(scope);
      if (!(await oauth.grants.get(grantId))) {
        throw AthenaAuthRuntimeError.notFound("Authorization grant not found");
      }
      await oauth.grants.revoke({
        grantId,
        reason,
        revokedBy: admin.user.id,
      });
    });
    return jsonResponse(200, { grantId, revoked: true }, headers);
  }

  return undefined;
}
