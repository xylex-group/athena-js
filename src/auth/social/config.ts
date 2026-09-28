import { AthenaConfigurationError } from "../../config/errors.ts";

export interface AthenaAuthSocialProviderOptions {
  authorizationEndpoint?: string;
  clientId: string;
  clientSecret?: string;
  issuer?: string;
  jwksEndpoint?: string;
  scope?: string[];
  tokenEndpoint?: string;
  userInfoEndpoint?: string;
}

export interface AthenaAuthSocialOptions {
  providers?: Record<string, AthenaAuthSocialProviderOptions>;
}

export interface NormalizedSocialAuthConfig {
  providers: Record<string, AthenaAuthSocialProviderOptions>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function assertSocialConfigObject(key: string, value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      `auth.${key} must be an object provider map`,
      "auth"
    );
  }
}

function normalizeSocialProviderBag(
  value: unknown,
  preserveSecret: boolean
): AthenaAuthSocialProviderOptions | undefined {
  const record = asRecord(value);
  if (!record) {
    return;
  }
  const normalized = {
    ...record,
    authorizationEndpoint: asString(record.authorizationEndpoint),
    clientId: asString(record.clientId) ?? "",
    issuer: asString(record.issuer),
    jwksEndpoint: asString(record.jwksEndpoint),
    tokenEndpoint: asString(record.tokenEndpoint),
    userInfoEndpoint: asString(record.userInfoEndpoint),
  } as AthenaAuthSocialProviderOptions;
  if (preserveSecret) {
    normalized.clientSecret = asString(record.clientSecret) ?? "";
  } else {
    delete normalized.clientSecret;
  }
  return normalized;
}

function normalizeSocialProviderMap(
  value: unknown,
  preserveSecret: boolean
): Record<string, AthenaAuthSocialProviderOptions> {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  const providers: Record<string, AthenaAuthSocialProviderOptions> = {};
  for (const [id, bag] of Object.entries(record)) {
    const normalized = normalizeSocialProviderBag(bag, preserveSecret);
    if (!normalized) {
      continue;
    }
    providers[id] = normalized;
  }
  return providers;
}

function extractSocialProviderMap(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) {
    return;
  }
  const nested = asRecord(record.providers);
  return nested ?? record;
}

/**
 * Normalize the public social provider aliases without importing the
 * Node-only social adapter. Remote/browser configs never retain secrets.
 */
export function normalizeAuthSocialProviders(
  raw: Record<string, unknown>
): NormalizedSocialAuthConfig {
  assertSocialConfigObject("social", raw.social);
  assertSocialConfigObject("oauth", raw.oauth);
  assertSocialConfigObject("socialProviders", raw.socialProviders);
  const providers = normalizeSocialProviderMap(
    extractSocialProviderMap(raw.social) ?? raw.oauth ?? raw.socialProviders,
    raw.mode === "local"
  );
  return { providers };
}
