import { requireAthenaAdmin } from "../admin-guard.ts";
import { AthenaAuthRuntimeError, jsonResponse } from "../errors.ts";
import type { AthenaIdentityConnection } from "../../types/catalog.ts";
import type { AuthIdentityConnectionRow } from "../models.ts";
import type { AuthRuntimeDependencies } from "../runtime-dependencies.ts";
import { readJsonBody, requireStringField } from "../security.ts";
import type { AthenaAuthStores } from "../store-contract.ts";
import type { CreateAuthIdentityConnectionInput } from "./types.ts";

function rejectFields(
  body: Record<string, unknown>,
  fields: readonly string[]
): void {
  const field = fields.find((name) => Object.hasOwn(body, name));
  if (field) {
    throw AthenaAuthRuntimeError.badRequest(`${field} is server-managed`);
  }
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw AthenaAuthRuntimeError.badRequest(`${field} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw AthenaAuthRuntimeError.badRequest(`${field} must be a string or null`);
  }
  const normalized = value.trim();
  return normalized || null;
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw AthenaAuthRuntimeError.badRequest(`${field} must be an array of strings`);
  }
  return [...new Set(value.map((entry) => entry.trim()).filter(Boolean))];
}

function booleanField(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw AthenaAuthRuntimeError.badRequest(`${field} must be a boolean`);
  }
  return value;
}

function authMethod(
  value: unknown
): "client_secret_basic" | "client_secret_post" | "none" {
  if (
    value === "client_secret_basic" ||
    value === "client_secret_post" ||
    value === "none"
  ) {
    return value;
  }
  throw AthenaAuthRuntimeError.badRequest("Unsupported tokenEndpointAuthMethod");
}

function normalizeDomains(value: unknown): string[] {
  const domains = [
    ...new Set(
      stringArray(value, "domains").map((domain) => domain.toLowerCase())
    ),
  ];
  for (const domain of domains) {
    if (
      domain.length > 253 ||
      !domain.includes(".") ||
      domain.split(".").some((label) =>
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
      )
    ) {
      throw AthenaAuthRuntimeError.badRequest(`Invalid email domain: ${domain}`);
    }
  }
  return domains;
}

function validateIssuer(value: unknown): string {
  const issuer = stringField(value, "issuer");
  let parsed: URL;
  try {
    parsed = new URL(issuer);
  } catch {
    throw AthenaAuthRuntimeError.badRequest("issuer must be an absolute URL");
  }
  const developmentLoopback =
    process.env.NODE_ENV !== "production" &&
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (
    (parsed.protocol !== "https:" && !developmentLoopback) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw AthenaAuthRuntimeError.badRequest("issuer must be an HTTP(S) issuer URL");
  }
  return issuer;
}

function validateResource(value: unknown): string | null {
  const resource = optionalString(value, "resource");
  if (!resource) return null;
  try {
    const parsed = new URL(resource);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return resource;
    }
  } catch {
    // Report through the same public validation error below.
  }
  throw AthenaAuthRuntimeError.badRequest("resource must be an absolute HTTP(S) URI");
}

function toDto(row: AuthIdentityConnectionRow): AthenaIdentityConnection {
  return {
    authenticationRequired: row.authentication_required,
    clientId: row.client_id,
    connectionType: row.connection_type,
    createdAt: new Date(row.created_at).toISOString(),
    credentialRef: row.credential_ref,
    domains: Array.isArray(row.domains) ? row.domains : [],
    enabled: row.enabled,
    id: row.id,
    issuer: row.issuer,
    jitDefaultRoleId: row.jit_default_role_id,
    jitEnabled: row.jit_enabled,
    name: row.name,
    organizationId: row.organization_id,
    resource: row.resource_uri,
    updatedAt: new Date(row.updated_at).toISOString(),
    tokenEndpointAuthMethod: row.token_endpoint_auth_method,
  };
}

function auditConnection(row: AuthIdentityConnectionRow) {
  return {
    authenticationRequired: row.authentication_required,
    clientId: row.client_id,
    connectionType: "oidc" as const,
    domains: Array.isArray(row.domains) ? [...row.domains] : [],
    enabled: row.enabled,
    id: row.id,
    issuer: row.issuer,
    jitDefaultRoleId: row.jit_default_role_id,
    jitEnabled: row.jit_enabled,
    name: row.name,
    organizationId: row.organization_id,
    resource: row.resource_uri,
    tokenEndpointAuthMethod: row.token_endpoint_auth_method,
  };
}

async function assertDomainsAvailable(
  stores: AthenaAuthStores,
  domains: readonly string[],
  exceptConnectionId?: string
): Promise<void> {
  for (const domain of domains) {
    const existing = await stores.findIdentityConnectionByDomain(domain);
    if (existing && existing.id !== exceptConnectionId) {
      throw new AthenaAuthRuntimeError(
        409,
        `The ${domain} domain is already assigned to an enabled identity connection`,
        { code: "ATHENA_AUTH_IDENTITY_CONNECTION_DOMAIN_CONFLICT" }
      );
    }
  }
}

async function normalizeJitDefaultRoleId(
  stores: AthenaAuthStores,
  organizationId: string,
  roleRef: string | null
): Promise<string | null> {
  if (!roleRef) return null;
  const role = await stores.authorization.lookupAssignableOrganizationRole(
    organizationId,
    roleRef
  );
  if (!role || !role.assignable || role.scopeKind !== "organization") {
    throw AthenaAuthRuntimeError.badRequest(
      "jitDefaultRoleId must reference an assignable organization role"
    );
  }
  return role.id;
}

async function requireAdmin(
  request: Request,
  deps: AuthRuntimeDependencies,
  stores: AthenaAuthStores
) {
  return requireAthenaAdmin(request, (current) =>
    deps.requireSession(current, stores)
  );
}

export async function handleIdentityConnectionAdminRoute(
  request: Request,
  path: string,
  method: string,
  deps: AuthRuntimeDependencies,
  stores: AthenaAuthStores,
  headers: Headers
): Promise<Response | undefined> {
  const recognized = new Set([
    "POST /admin/identity-connection/create",
    "GET /admin/identity-connection/get",
    "GET /admin/identity-connection/list",
    "POST /admin/identity-connection/update",
    "POST /admin/identity-connection/disable",
  ]);
  if (!recognized.has(`${method} ${path}`)) return;
  const admin = await requireAdmin(request, deps, stores);
  const mutationContext = (routePath: string) => ({
    actor: { kind: "user" as const, userId: admin.user.id },
    request: deps.hookRequest(request, routePath),
    traceId: crypto.randomUUID(),
  });
  if (path === "/admin/identity-connection/create" && method === "POST") {
    const body = await readJsonBody(request, deps.config.security.bodyLimitBytes);
    rejectFields(body, ["clientSecret", "connectionType", "id", "secret"]);
    const organizationId = stringField(body.organizationId, "organizationId");
    const name = stringField(body.name, "name");
    const clientId = stringField(body.clientId, "clientId");
    const credentialRef = optionalString(body.credentialRef, "credentialRef");
    const tokenEndpointAuthMethod =
      body.tokenEndpointAuthMethod === undefined
        ? "none"
        : authMethod(body.tokenEndpointAuthMethod);
    if (tokenEndpointAuthMethod !== "none" && !credentialRef) {
      throw AthenaAuthRuntimeError.badRequest(
        "credentialRef is required for confidential OIDC clients"
      );
    }
    const organization = await stores.getOrganization(organizationId);
    if (!organization) throw AthenaAuthRuntimeError.notFound("Organization not found");
    const domains = normalizeDomains(body.domains);
    const input: CreateAuthIdentityConnectionInput = {
        authenticationRequired:
          body.authenticationRequired === undefined
            ? false
            : booleanField(body.authenticationRequired, "authenticationRequired"),
        clientId,
        connectionType: "oidc",
        credentialRef,
        domains,
        enabled:
          body.enabled === undefined ? false : booleanField(body.enabled, "enabled"),
        id: crypto.randomUUID(),
        issuer: validateIssuer(body.issuer),
        jitDefaultRoleId: optionalString(body.jitDefaultRoleId, "jitDefaultRoleId"),
        jitEnabled:
          body.jitEnabled === undefined
            ? false
            : booleanField(body.jitEnabled, "jitEnabled"),
        name,
        organizationId,
        resource: validateResource(body.resource),
        tokenEndpointAuthMethod,
      };
    const connection = await deps.mutate<
      "identity.connection.create",
      AuthIdentityConnectionRow
    >({
      context: mutationContext(path),
      event: "identity.connection.create",
      execute: async (scope) => {
        if (input.enabled) {
          await scope.stores.lockIdentityConnectionDomainRouting();
          await assertDomainsAvailable(scope.stores, domains);
        }
        const jitDefaultRoleId = await normalizeJitDefaultRoleId(
          scope.stores,
          organizationId,
          input.jitDefaultRoleId
        );
        return scope.stores.createIdentityConnection({
          ...input,
          jitDefaultRoleId,
        });
      },
      input: { connectionId: input.id, organizationId },
      resultOf: (row) => ({ connection: auditConnection(row) }),
    });
    return jsonResponse(201, { connection: toDto(connection) }, headers);
  }
  if (path === "/admin/identity-connection/get" && method === "GET") {
    const connectionId = new URL(request.url).searchParams.get("connectionId");
    if (!connectionId) throw AthenaAuthRuntimeError.badRequest("connectionId is required");
    const connection = await stores.getIdentityConnection(connectionId);
    if (!connection) throw AthenaAuthRuntimeError.notFound("Identity connection not found");
    return jsonResponse(200, { connection: toDto(connection) }, headers);
  }
  if (path === "/admin/identity-connection/list" && method === "GET") {
    const organizationId = new URL(request.url).searchParams.get("organizationId");
    if (!organizationId) throw AthenaAuthRuntimeError.badRequest("organizationId is required");
    const connections = await stores.listIdentityConnections(organizationId);
    return jsonResponse(
      200,
      { connections: connections.map(toDto), total: connections.length },
      headers
    );
  }
  if (path === "/admin/identity-connection/update" && method === "POST") {
    const body = await readJsonBody(request, deps.config.security.bodyLimitBytes);
    rejectFields(body, ["clientSecret", "connectionType", "id", "issuer", "organizationId", "secret"]);
    const connectionId = requireStringField(body, "connectionId");
    const existing = await stores.getIdentityConnection(connectionId);
    if (!existing) throw AthenaAuthRuntimeError.notFound("Identity connection not found");
    const credentialRef =
      body.credentialRef === undefined
        ? existing.credential_ref
        : optionalString(body.credentialRef, "credentialRef");
    const tokenEndpointAuthMethod =
      body.tokenEndpointAuthMethod === undefined
        ? existing.token_endpoint_auth_method
        : authMethod(body.tokenEndpointAuthMethod);
    if (tokenEndpointAuthMethod !== "none" && !credentialRef) {
      throw AthenaAuthRuntimeError.badRequest(
        "credentialRef is required for confidential OIDC clients"
      );
    }
    const patch = {
      ...(body.authenticationRequired === undefined
        ? {}
        : { authenticationRequired: booleanField(body.authenticationRequired, "authenticationRequired") }),
      ...(body.clientId === undefined ? {} : { clientId: stringField(body.clientId, "clientId") }),
      ...(body.credentialRef === undefined
        ? {}
        : { credentialRef: optionalString(body.credentialRef, "credentialRef") }),
      ...(body.domains === undefined ? {} : { domains: normalizeDomains(body.domains) }),
      ...(body.enabled === undefined ? {} : { enabled: booleanField(body.enabled, "enabled") }),
      ...(body.jitDefaultRoleId === undefined
        ? {}
        : { jitDefaultRoleId: optionalString(body.jitDefaultRoleId, "jitDefaultRoleId") }),
      ...(body.jitEnabled === undefined ? {} : { jitEnabled: booleanField(body.jitEnabled, "jitEnabled") }),
      ...(body.name === undefined ? {} : { name: stringField(body.name, "name") }),
      ...(body.resource === undefined ? {} : { resource: validateResource(body.resource) }),
      ...(body.tokenEndpointAuthMethod === undefined
        ? {}
        : { tokenEndpointAuthMethod }),
    };
    const before = existing;
    const connection = await deps.mutate<
      "identity.connection.update",
      { previous: AuthIdentityConnectionRow; updated: AuthIdentityConnectionRow }
    >({
      context: mutationContext(path),
      event: "identity.connection.update",
      execute: async (scope) => {
        const previous = await scope.stores.getIdentityConnection(connectionId);
        if (!previous) throw AthenaAuthRuntimeError.notFound("Identity connection not found");
        const domains = Array.isArray(previous.domains) ? previous.domains : [];
        const nextDomains = patch.domains ?? domains;
        const willBeEnabled = patch.enabled ?? previous.enabled;
        if (willBeEnabled) {
          await scope.stores.lockIdentityConnectionDomainRouting();
          await assertDomainsAvailable(scope.stores, nextDomains, connectionId);
        }
        const jitDefaultRoleId =
          patch.jitDefaultRoleId === undefined
            ? undefined
            : await normalizeJitDefaultRoleId(
                scope.stores,
                previous.organization_id,
                patch.jitDefaultRoleId
              );
        const updated = await scope.stores.updateIdentityConnection(connectionId, {
          ...patch,
          ...(patch.jitDefaultRoleId !== undefined ? { jitDefaultRoleId } : {}),
        });
        if (!updated) throw AthenaAuthRuntimeError.notFound("Identity connection not found");
        return { previous, updated };
      },
      input: { connectionId, organizationId: before.organization_id },
      previous: async () => ({ connection: auditConnection(before) }),
      previousOf: (result) => ({ connection: auditConnection(result.previous) }),
      resultOf: (result) => ({ connection: auditConnection(result.updated) }),
    }).then((result) => result.updated);
    if (!connection) throw AthenaAuthRuntimeError.notFound("Identity connection not found");
    return jsonResponse(200, { connection: toDto(connection) }, headers);
  }
  if (path === "/admin/identity-connection/disable" && method === "POST") {
    const body = await readJsonBody(request, deps.config.security.bodyLimitBytes);
    const connectionId = requireStringField(body, "connectionId");
    const before = await stores.getIdentityConnection(connectionId);
    if (!before) throw AthenaAuthRuntimeError.notFound("Identity connection not found");
    const disabled = await deps.mutate<
      "identity.connection.disable",
      AuthIdentityConnectionRow
    >({
      context: mutationContext(path),
      event: "identity.connection.disable",
      execute: async (scope) => {
        const previous = await scope.stores.getIdentityConnection(connectionId);
        if (!previous) throw AthenaAuthRuntimeError.notFound("Identity connection not found");
        const disabled = await scope.stores.disableIdentityConnection(connectionId);
        if (!disabled) throw AthenaAuthRuntimeError.notFound("Identity connection not found");
        return previous;
      },
      input: { connectionId, organizationId: before.organization_id },
      previous: async () => ({ connection: auditConnection(before) }),
      previousOf: (previous) => ({ connection: auditConnection(previous) }),
      resultOf: () => ({ connectionId, disabled: true as const }),
    });
    if (!disabled) throw AthenaAuthRuntimeError.notFound("Identity connection not found");
    return jsonResponse(200, { connectionId, disabled: true }, headers);
  }
  return;
}
