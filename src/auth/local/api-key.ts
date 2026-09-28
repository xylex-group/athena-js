import { type AthenaRightKey, parseAthenaRightKey } from "../../rights/key.ts";
import { rightMatches } from "../../rights/matching.ts";
import { getAthenaAuthorizationRight } from "../../runtime/authorization/catalog.ts";
import { capabilitiesFromRights } from "../../runtime/authorization/capabilities.ts";
import type { AuthorizationSnapshot } from "../../runtime/authorization/types.ts";
import type { AuthApiKeyRow } from "./stores.ts";

export type ApiKeyScopeKind = "legacy" | "organization" | "platform";

const START_LENGTH = 6;
const MAX_API_KEY_LIFETIME_SECONDS = 365 * 24 * 60 * 60;
const MAX_API_KEY_REMAINING = 1_000_000;

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  );
  return Buffer.from(digest).toString("base64url");
}

export async function generateApiKey(prefix?: string): Promise<{
  fullKey: string;
  hash: string;
  start: string;
}> {
  const raw = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64url"
  );
  const start = raw.slice(0, START_LENGTH);
  const fullKey = `${prefix ?? ""}${raw}`;
  return {
    fullKey,
    hash: await sha256Base64Url(fullKey),
    start,
  };
}

export function parseApiKeyInteger(
  value: unknown,
  field: string,
  options: { max: number; min?: number } = { max: Number.MAX_SAFE_INTEGER }
): number | undefined {
  if (value === undefined || value === null || value === "") {
    return;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw new TypeError(`${field} must be an integer`);
  }
  const parsed =
    typeof value === "number"
      ? value
      : Number(value.trim());
  const min = options.min ?? 1;
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < min ||
    parsed > options.max
  ) {
    throw new TypeError(`${field} must be an integer between ${min} and ${options.max}`);
  }
  return parsed;
}

export function normalizeApiKeyPrefix(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return;
  }
  if (
    typeof value !== "string" ||
    value.length > 32 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new TypeError("prefix must contain only letters, numbers, '_' or '-'");
  }
  return value;
}

export function parseApiKeyLifetime(value: unknown): number | undefined {
  return parseApiKeyInteger(value, "expiresIn", {
    max: MAX_API_KEY_LIFETIME_SECONDS,
  });
}

export function parseApiKeyRemaining(value: unknown): number | undefined {
  return parseApiKeyInteger(value, "remaining", {
    max: MAX_API_KEY_REMAINING,
  });
}

export function parseApiKeyPermissionKeys(value: string): AthenaRightKey[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError("permissions must be a JSON object");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("permissions must be a JSON object");
  }

  const rights: AthenaRightKey[] = [];
  for (const [resource, actions] of Object.entries(parsed)) {
    if (
      !Array.isArray(actions) ||
      actions.some((action) => typeof action !== "string" || action.length === 0)
    ) {
      throw new TypeError(
        "permissions must map resources to non-empty action strings"
      );
    }
    for (const action of actions) {
      rights.push(
        parseAthenaRightKey(
          resource === "*" && action === "*" ? "*" : `${resource}.${action}`
        )
      );
    }
  }
  return rights;
}

export function toPublicApiKey(
  row: AuthApiKeyRow,
  fullKey?: string
): Record<string, unknown> {
  return {
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
    enabled: Boolean(row.enabled),
    expiresAt: row.expires_at
      ? row.expires_at instanceof Date
        ? row.expires_at.toISOString()
        : new Date(row.expires_at).toISOString()
      : null,
    id: row.id,
    key: fullKey,
    lastRequest: row.last_request
      ? row.last_request instanceof Date
        ? row.last_request.toISOString()
        : new Date(row.last_request).toISOString()
      : null,
    metadata: row.metadata ? safeJson(row.metadata) : null,
    name: row.name,
    permissions: row.permissions ? safeJson(row.permissions) : null,
    prefix: row.prefix,
    remaining: row.remaining,
    organizationId: row.organization_id ?? null,
    scopeKind: apiKeyScopeKind(row),
    start: row.start,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString(),
    userId: row.user_id,
  };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function isApiKeyExpired(row: AuthApiKeyRow): boolean {
  if (!row.expires_at) {
    return false;
  }
  return new Date(row.expires_at).getTime() <= Date.now();
}

export function isApiKeyUsable(row: AuthApiKeyRow): boolean {
  return (
    row.enabled &&
    !isApiKeyExpired(row) &&
    (row.remaining === null || row.remaining > 0)
  );
}

export function apiKeyScopeKind(row: AuthApiKeyRow): ApiKeyScopeKind {
  return row.scope_kind ?? "legacy";
}

export async function isApiKeyScopeUsable(
  row: AuthApiKeyRow,
  stores: {
    getMember: (
      organizationId: string,
      userId: string
    ) => Promise<unknown>;
  }
): Promise<boolean> {
  const scopeKind = apiKeyScopeKind(row);
  if (scopeKind === "organization") {
    return (
      typeof row.organization_id === "string" &&
      row.organization_id.length > 0 &&
      Boolean(await stores.getMember(row.organization_id, row.user_id))
    );
  }
  return row.organization_id == null;
}

export function bindApiKeyAuthorization(
  ownerAuthorization: AuthorizationSnapshot,
  permissions: readonly AthenaRightKey[] | undefined,
  scopeKind: ApiKeyScopeKind
): AuthorizationSnapshot {
  if (scopeKind === "legacy" || !permissions) {
    return {
      ...ownerAuthorization,
      assignableRoles: [],
      capabilities: capabilitiesFromRights([]),
      effectiveRights: [],
      roles: [],
    };
  }
  const scopeRights =
    scopeKind === "organization"
      ? ownerAuthorization.effectiveRights.filter((right) => {
          const definition = getAthenaAuthorizationRight(right);
          return definition !== undefined && definition.scopeKind !== "platform";
        })
      : ownerAuthorization.effectiveRights;
  const effectiveRights =
    scopeKind === "organization"
      ? permissions.flatMap((permission) => {
          const definition = getAthenaAuthorizationRight(permission);
          if (definition) {
            return scopeRights.some((ownedRight) =>
              rightMatches(ownedRight, permission)
            )
              ? [permission]
              : [];
          }
          return scopeRights.filter((ownedRight) =>
            rightMatches(permission, ownedRight)
          );
        })
      : permissions.filter((permission) =>
          ownerAuthorization.effectiveRights.some((ownedRight) =>
            rightMatches(ownedRight, permission)
          )
        );
  return {
    ...ownerAuthorization,
    assignableRoles: [],
    capabilities: capabilitiesFromRights(effectiveRights),
    effectiveRights,
    roles: [],
  };
}
