import type { AuthApiKeyRow } from "./stores.ts";

const START_LENGTH = 6;

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
