/**
 * Canonical Athena environment resolution and createClient alias catalogs.
 *
 * Primary keys (default for {@link resolveAthenaEnv}):
 * - `ATHENA_URL`
 * - `ATHENA_API_KEY`
 * - `ATHENA_CLIENT`
 * - `ATHENA_AUTH_URL`
 *
 * Pass `legacyAliases: true` to also accept historical multi-key sets used by
 * older apps.
 *
 * **createClient / Workers / execution-mode** always consult the ordered
 * catalogs below (`ATHENA_ENV_URL_KEYS`, `ATHENA_ENV_DB_URL_KEYS`,
 * `ATHENA_ENV_API_KEY_KEYS`, `ATHENA_ENV_CLIENT_KEYS`,
 * `ATHENA_ENV_GATEWAY_URL_KEYS`). Those lists are the single source of truth —
 * do not re-copy them in v3-client or cloudflare façades.
 *
 * Service-specific keys (auth/chat/storage) and generator-only keys
 * (`ATHENA_GENERATOR_*`) stay in their owning modules.
 */

import type { EnvLike } from "../utils/athena-auth-url.ts";

/** Recommended primary environment keys. */
export const ATHENA_ENV_PRIMARY_KEYS = {
  apiKey: "ATHENA_API_KEY",
  authUrl: "ATHENA_AUTH_URL",
  client: "ATHENA_CLIENT",
  url: "ATHENA_URL",
} as const;

// ---------------------------------------------------------------------------
// createClient / Workers / execution-mode catalogs (order = priority)
// ---------------------------------------------------------------------------

/**
 * Unified root URL keys for createClient top-level `url` / env root.
 * Used before path derivation for service URLs.
 */
export const ATHENA_ENV_URL_KEYS = [
  "ATHENA_URL",
  "NEXT_PUBLIC_ATHENA_URL",
] as const;

/**
 * DB / gateway service URL keys for createClient `db.url`.
 * Consulted after root URL derivation when no explicit `db.url` is set.
 */
export const ATHENA_ENV_DB_URL_KEYS = [
  "ATHENA_DB_URL",
  "ATHENA_GATEWAY_URL",
  "NEXT_PUBLIC_ATHENA_DB_API_URL",
] as const;

/**
 * Combined gateway/root URL keys for execution-mode resolution and Worker façades.
 * Order matches createClient: root URL keys first, then DB-specific aliases.
 */
export const ATHENA_ENV_GATEWAY_URL_KEYS = [
  ...ATHENA_ENV_URL_KEYS,
  ...ATHENA_ENV_DB_URL_KEYS,
] as const;

/** API key keys accepted by createClient resolveCore (and Worker key forwarding). */
export const ATHENA_ENV_API_KEY_KEYS = [
  "ATHENA_API_KEY",
  "NEXT_PUBLIC_ATHENA_API_KEY",
  "ATHENA_GATEWAY_API_KEY",
  "X_API_KEY",
] as const;

/** Client-name keys accepted by createClient resolveCore (`X-Athena-Client`). */
export const ATHENA_ENV_CLIENT_KEYS = [
  "ATHENA_CLIENT",
  "ATHENA_GATEWAY_CLIENT",
  "ATHENA_GENERATOR_CLIENT",
  "NEXT_PUBLIC_ATHENA_CLIENT",
  "NEXT_PUBLIC_ATHENA_GATEWAY_CLIENT",
] as const;

// ---------------------------------------------------------------------------
// resolveAthenaEnv legacy catalogs (gated by legacyAliases; membership differs
// from createClient lists — do not merge without a product decision)
// ---------------------------------------------------------------------------

/** Legacy URL aliases for {@link resolveAthenaEnv} (order = priority). */
export const ATHENA_ENV_LEGACY_URL_KEYS = [
  "ATHENA_URL",
  "NEXT_PUBLIC_ATHENA_URL",
  "ATHENA_GATEWAY_URL",
  "NEXT_PUBLIC_ATHENA_GATEWAY_URL",
] as const;

/** Legacy API key aliases for {@link resolveAthenaEnv}. */
export const ATHENA_ENV_LEGACY_API_KEY_KEYS = [
  "ATHENA_API_KEY",
  "ATHENA_KEY",
  "ATHENA_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_ATHENA_API_KEY",
  "NEXT_PUBLIC_ATHENA_PUBLISHABLE_KEY",
] as const;

/** Legacy client-name aliases for {@link resolveAthenaEnv}. */
export const ATHENA_ENV_LEGACY_CLIENT_KEYS = [
  "ATHENA_CLIENT",
  "NEXT_PUBLIC_ATHENA_CLIENT",
  "ATHENA_CLIENT_NAME",
] as const;

/** Legacy auth URL aliases for {@link resolveAthenaEnv}. */
export const ATHENA_ENV_LEGACY_AUTH_URL_KEYS = [
  "ATHENA_AUTH_URL",
  "ATHENA_AUTH_UPSTREAM_URL",
  "NEXT_PUBLIC_ATHENA_AUTH_URL",
  "NEXT_PUBLIC_ATHENA_AUTH_UPSTREAM_URL",
] as const;

export type AthenaEnvField = "url" | "apiKey" | "client" | "authUrl";

export interface ResolveAthenaEnvOptions {
  /** Log which keys resolved and which were ignored (non-production only unless forced). */
  debug?: boolean;
  /** Explicit env map. Defaults to `process.env` when available. */
  env?: EnvLike;
  /**
   * When true, fall back to {@link ATHENA_ENV_LEGACY_*_KEYS} after primary keys.
   * Default false so new apps only document one key set.
   */
  legacyAliases?: boolean;
}

export interface AthenaEnvResolution {
  apiKey?: string;
  authUrl?: string;
  client?: string;
  /** Non-empty keys that were considered but not chosen (lower priority). */
  ignored: Array<{ field: AthenaEnvField; key: string }>;
  /** Key that supplied each field, when present. */
  sources: Partial<Record<AthenaEnvField, string>>;
  url?: string;
}

function readProcessEnv(): EnvLike {
  try {
    return (globalThis as { process?: { env?: EnvLike } }).process?.env ?? {};
  } catch {
    return {};
  }
}

function candidatesFor(
  field: AthenaEnvField,
  legacyAliases: boolean
): readonly string[] {
  const primary = ATHENA_ENV_PRIMARY_KEYS[field];
  if (!legacyAliases) {
    return [primary];
  }

  switch (field) {
    case "url":
      return ATHENA_ENV_LEGACY_URL_KEYS;
    case "apiKey":
      return ATHENA_ENV_LEGACY_API_KEY_KEYS;
    case "client":
      return ATHENA_ENV_LEGACY_CLIENT_KEYS;
    case "authUrl":
      return ATHENA_ENV_LEGACY_AUTH_URL_KEYS;
    default:
      return [primary];
  }
}

function pickField(
  field: AthenaEnvField,
  source: EnvLike,
  legacyAliases: boolean,
  ignored: AthenaEnvResolution["ignored"]
): { value?: string; key?: string } {
  const keys = candidatesFor(field, legacyAliases);
  let chosen: { value?: string; key?: string } = {};

  for (const key of keys) {
    const raw = source[key]?.trim();
    if (!raw) {
      continue;
    }
    if (chosen.value) {
      ignored.push({ field, key });
    } else {
      chosen = { key, value: raw };
    }
  }

  return chosen;
}

/**
 * Resolve Athena connection settings from an env map.
 *
 * Primary keys only unless `legacyAliases: true`.
 */
export function resolveAthenaEnv(
  options: ResolveAthenaEnvOptions = {}
): AthenaEnvResolution {
  const source = options.env ?? readProcessEnv();
  const legacyAliases = options.legacyAliases === true;
  const ignored: AthenaEnvResolution["ignored"] = [];

  const url = pickField("url", source, legacyAliases, ignored);
  const apiKey = pickField("apiKey", source, legacyAliases, ignored);
  const client = pickField("client", source, legacyAliases, ignored);
  const authUrl = pickField("authUrl", source, legacyAliases, ignored);

  const result: AthenaEnvResolution = {
    apiKey: apiKey.value,
    authUrl: authUrl.value,
    client: client.value,
    ignored,
    sources: {
      ...(url.key ? { url: url.key } : {}),
      ...(apiKey.key ? { apiKey: apiKey.key } : {}),
      ...(client.key ? { client: client.key } : {}),
      ...(authUrl.key ? { authUrl: authUrl.key } : {}),
    },
    url: url.value,
  };

  const shouldDebug =
    options.debug === true ||
    (options.debug !== false &&
      (globalThis as { process?: { env?: { ATHENA_ENV_DEBUG?: string } } })
        .process?.env?.ATHENA_ENV_DEBUG === "1");

  if (shouldDebug) {
    console.info("[athena/env] resolved", {
      hasApiKey: Boolean(result.apiKey),
      hasAuthUrl: Boolean(result.authUrl),
      hasClient: Boolean(result.client),
      hasUrl: Boolean(result.url),
      ignored: result.ignored,
      sources: result.sources,
    });
  }

  return result;
}

/**
 * Like {@link resolveAthenaEnv}, but throws when `url` or `apiKey` is missing.
 */
export function requireAthenaEnv(
  options: ResolveAthenaEnvOptions = {}
): AthenaEnvResolution & { url: string; apiKey: string } {
  const resolved = resolveAthenaEnv(options);
  if (!(resolved.url && resolved.apiKey)) {
    const missing: string[] = [];
    if (!resolved.url) {
      missing.push(ATHENA_ENV_PRIMARY_KEYS.url);
    }
    if (!resolved.apiKey) {
      missing.push(ATHENA_ENV_PRIMARY_KEYS.apiKey);
    }
    throw new Error(
      `Missing required Athena env: ${missing.join(", ")}. ` +
        (options.legacyAliases
          ? "Legacy aliases were enabled but none resolved."
          : "Set primary keys, or pass legacyAliases: true for historical names.")
    );
  }
  return {
    ...resolved,
    apiKey: resolved.apiKey,
    url: resolved.url,
  };
}
