import type {
  AthenaAdminHasPermissionRequest,
  AthenaAuthCallOptions,
  AthenaAuthFetchCompatibleInput,
} from "../auth/types.ts";

export type {
  AthenaAdminQueryExecutionMetadata,
  AthenaAdminQueryInput,
  AthenaAdminQueryResult,
  AthenaExpectedQueryShape,
  AthenaRawQueryDiagnosticsMode,
  AthenaRawQueryOperation,
} from "./query.ts";
export {
  ATHENA_ADMIN_QUERY_EMPTY_SQL,
  ATHENA_ADMIN_QUERY_INVALID_SHAPE,
  ATHENA_ADMIN_QUERY_MULTI_STATEMENT,
  ATHENA_RAW_SQL_COMPAT_DEPRECATED,
  assertNonEmptySql,
  assertValidAdminQueryShape,
  classifyRawSqlOperation,
  createAdminQuery,
  defaultExpectedShapeForOperation,
  maybeWarnRawQueryDeprecated,
  sqlLooksLikeMultipleStatements,
} from "./query.ts";

/**
 * Minimal session shape used by the admin convenience helpers.
 *
 * This stays framework-agnostic so callers can pass Athena auth sessions,
 * app-local session wrappers, or request-derived session snapshots.
 */
export interface AthenaAdminSessionLike {
  session?:
    | {
        token?: string | null | undefined;
        activeOrganizationId?: string | null | undefined;
      }
    | null
    | undefined;
  user?:
    | {
        id?: string | null | undefined;
        role?: string | null | undefined;
      }
    | null
    | undefined;
}

/**
 * Minimal client surface for admin permission checks.
 * Only `auth.admin.hasPermission` is required (full admin binding is fine too).
 * Uses a wide callable so real `createClient` auth bindings and mocks both assign.
 */
export interface AthenaAdminPermissionClient {
  auth: {
    admin: {
      // biome-ignore lint/suspicious/noExplicitAny: intentionally wide callable so real bindings and mocks both assign
      hasPermission: (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...args: any[]
      ) => PromiseLike<{
        ok?: boolean;
        data?: { success?: boolean } | null;
      }>;
    };
  };
}

/**
 * Normalizes common Athena client shapes into the admin-permission client contract.
 *
 * Accepts:
 * - `createClient(...)` → `{ auth: { admin } }`
 * - auth bindings only → `{ admin, … }` wrapped as `{ auth: bindings }`
 */
export function resolveAdminPermissionClient(
  client: unknown
): AthenaAdminPermissionClient | null {
  if (!client || typeof client !== "object") {
    return null;
  }

  const record = client as Record<string, unknown>;
  const nestedAuth = record.auth;

  if (
    nestedAuth &&
    typeof nestedAuth === "object" &&
    nestedAuth !== null &&
    "admin" in nestedAuth
  ) {
    return client as AthenaAdminPermissionClient;
  }

  if ("admin" in record) {
    return {
      auth: client as unknown as AthenaAdminPermissionClient["auth"],
    };
  }

  return null;
}

/**
 * Request credentials for admin permission checks without manual cookie
 * string matching. Prefer these over assembling `fetchOptions` by hand.
 */
export interface AthenaAdminRequestCredentials {
  /** Bearer token (without the `Bearer ` prefix). */
  bearerToken?: string | null;
  /** Raw `Cookie` header value from the current request. */
  cookie?: string | null;
}

/**
 * Build auth `fetchOptions` for admin routes from cookie and/or bearer.
 *
 * Replaces app helpers that inspect cookie strings for `athena-auth` /
 * `better-auth` prefixes before calling `hasPermission`.
 */
export function buildAdminAuthFetchOptions(
  credentials: AthenaAdminRequestCredentials = {}
): NonNullable<AthenaAuthFetchCompatibleInput["fetchOptions"]> {
  const cookie = credentials.cookie?.trim() || undefined;
  const bearerToken = credentials.bearerToken?.trim() || undefined;
  const headers: Record<string, string> = {};
  if (cookie) {
    headers.cookie = cookie;
  }
  if (bearerToken) {
    headers.authorization = `Bearer ${bearerToken}`;
  }
  return {
    credentials: "include",
    ...(bearerToken ? { bearerToken } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };
}

export interface AthenaAdminPermissionCheckInput {
  allowRoleBypass?: boolean;
  /**
   * Cookie/bearer from the request. Merged under any explicit `fetchOptions`
   * (explicit keys win on shallow header merge).
   */
  credentials?: AthenaAdminRequestCredentials;
  fetchOptions?: AthenaAuthFetchCompatibleInput["fetchOptions"];
  permission?: AthenaAdminHasPermissionRequest["permission"];
  permissions: AthenaAdminHasPermissionRequest["permissions"];
  requestOptions?: AthenaAuthCallOptions;
  session: AthenaAdminSessionLike | null | undefined;
}

export interface AthenaAdminPermissionSuccess<
  TSession extends AthenaAdminSessionLike = AthenaAdminSessionLike,
> {
  ok: true;
  session: NonNullable<TSession>;
}

export interface AthenaAdminPermissionFailure {
  error: "Unauthorized" | "Forbidden";
  ok: false;
  status: 401 | 403;
}

export type AthenaAdminPermissionResult<
  TSession extends AthenaAdminSessionLike = AthenaAdminSessionLike,
> = AthenaAdminPermissionSuccess<TSession> | AthenaAdminPermissionFailure;

/**
 * Returns true when the session user already carries the `admin` role locally.
 *
 * Role strings are treated as a comma-separated list and normalized
 * case-insensitively so `"admin"`, `"ADMIN"`, and `"member, admin"` all pass.
 */
export function hasAdminRole(
  session: AthenaAdminSessionLike | null | undefined
): boolean {
  const role = session?.user?.role;
  if (!role) {
    return false;
  }

  return role
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .includes("admin");
}

/**
 * Checks admin permission against the configured Athena auth client.
 *
 * This helper short-circuits when no session user is present and, by default,
 * trusts a local `admin` role before calling `client.auth.admin.hasPermission(...)`.
 */
function mergeAdminFetchOptions(
  input: AthenaAdminPermissionCheckInput
): AthenaAuthFetchCompatibleInput["fetchOptions"] | undefined {
  const fromCredentials = input.credentials
    ? buildAdminAuthFetchOptions(input.credentials)
    : undefined;
  const explicit = input.fetchOptions;
  if (!(fromCredentials || explicit)) {
    return;
  }
  if (!fromCredentials) {
    return explicit;
  }
  if (!explicit) {
    return fromCredentials;
  }
  return {
    ...fromCredentials,
    ...explicit,
    headers: {
      ...(fromCredentials.headers ?? {}),
      ...(explicit.headers ?? {}),
    },
  };
}

export async function hasAdminPermission(
  client: AthenaAdminPermissionClient,
  input: AthenaAdminPermissionCheckInput
): Promise<boolean> {
  if (!input.session?.user?.id) {
    return false;
  }

  if (input.allowRoleBypass !== false && hasAdminRole(input.session)) {
    return true;
  }

  const fetchOptions = mergeAdminFetchOptions(input);

  const result = await client.auth.admin.hasPermission(
    {
      permission: input.permission,
      permissions: input.permissions,
      ...(fetchOptions ? { fetchOptions } : {}),
    },
    input.requestOptions
  );

  return Boolean(result.ok && result.data?.success);
}

/**
 * Resolves an admin permission check into a small framework-agnostic guard result.
 *
 * Consumers can map the returned `{ ok, status, error }` shape into Next.js,
 * Hono, Express, or any other response layer without importing framework types here.
 */
export async function resolveAdminPermission<
  TSession extends AthenaAdminSessionLike = AthenaAdminSessionLike,
>(
  client: AthenaAdminPermissionClient,
  input: Omit<AthenaAdminPermissionCheckInput, "session"> & {
    session: TSession | null | undefined;
  }
): Promise<AthenaAdminPermissionResult<TSession>> {
  if (!input.session) {
    return { error: "Unauthorized", ok: false, status: 401 };
  }

  if (!(await hasAdminPermission(client, input))) {
    return { error: "Forbidden", ok: false, status: 403 };
  }

  return {
    ok: true,
    session: input.session as NonNullable<TSession>,
  };
}
