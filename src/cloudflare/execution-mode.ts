/**
 * Pure edge vs gateway execution resolution (no client construction).
 * Used by {@link createClient} and re-exported from the cloudflare façade.
 */

import { AthenaConfigurationError } from "../config/errors.ts";
import { ATHENA_ENV_GATEWAY_URL_KEYS } from "../env/index.ts";
import type { D1DatabaseLike } from "./types.ts";

/** How DB/storage execution is routed. */
export type AthenaExecutionMode = "gateway" | "edge" | "auto";

/** Resolved mode after applying config + env (never `auto`). */
export type AthenaResolvedExecutionMode = "gateway" | "edge";

/** Env key used when `mode` is omitted or `'auto'`. */
export const ATHENA_EXECUTION_MODE_ENV_KEY = "ATHENA_EXECUTION_MODE";

/**
 * When both D1 and a gateway URL are available in `auto` mode, which backend wins.
 * Default: `edge` (prefer local bindings when present).
 */
export type AthenaExecutionPrefer = "edge" | "gateway";

export const ATHENA_EXECUTION_PREFER_ENV_KEY = "ATHENA_EXECUTION_PREFER";

const MODE_ALIASES: Record<string, AthenaExecutionMode> = {
  auto: "auto",
  cloudflare: "edge",
  "cloudflare-edge": "edge",
  d1: "edge",
  edge: "edge",
  gateway: "gateway",
  http: "gateway",
  local: "edge",
  remote: "gateway",
  server: "gateway",
};

export interface ResolveAthenaExecutionModeInput {
  /** D1 binding when present enables edge in auto mode. */
  d1?: D1DatabaseLike | null;
  /** Optional env map; also used when reading `ATHENA_EXECUTION_MODE`. */
  env?: Record<string, string | undefined>;
  /** Explicit mode. Default: `'auto'` (or env `ATHENA_EXECUTION_MODE`). */
  mode?: AthenaExecutionMode | string | null;
  /**
   * When `mode` is `auto` and **both** D1 and a gateway URL exist, pick a winner.
   * Default `edge`. Override with `prefer: 'gateway'` or env `ATHENA_EXECUTION_PREFER`.
   */
  prefer?: AthenaExecutionPrefer | string | null;
  /** Gateway base URL (or unified root) for server mode. */
  url?: string | null;
}

function normalizeOptional(
  value: string | null | undefined
): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeModeString(
  value: string | null | undefined
): AthenaExecutionMode | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const key = value.trim().toLowerCase();
  if (!key) {
    return undefined;
  }
  const mapped = MODE_ALIASES[key];
  if (!mapped) {
    throw new AthenaConfigurationError(
      "ATHENA_NO_SERVICE_CONFIGURED",
      `Unknown Athena execution mode "${value}". Use gateway | edge | auto (aliases: server, remote, cloudflare, d1).`,
      "db"
    );
  }
  return mapped;
}

function isD1Binding(value: unknown): value is D1DatabaseLike {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as D1DatabaseLike).prepare === "function"
  );
}

function resolveGatewayUrl(
  url: string | null | undefined,
  env: Record<string, string | undefined>
): string | undefined {
  if (normalizeOptional(url)) {
    return normalizeOptional(url);
  }
  // SSOT: ATHENA_ENV_GATEWAY_URL_KEYS (url + db catalogs) from env module
  for (const key of ATHENA_ENV_GATEWAY_URL_KEYS) {
    const value = normalizeOptional(env[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function resolvePrefer(
  prefer: AthenaExecutionPrefer | string | null | undefined,
  env: Record<string, string | undefined>
): AthenaResolvedExecutionMode {
  const raw =
    normalizeOptional(
      typeof prefer === "string" ? prefer : (prefer ?? undefined)
    ) ??
    normalizeOptional(env[ATHENA_EXECUTION_PREFER_ENV_KEY]) ??
    "edge";
  const key = raw.toLowerCase();
  if (
    key === "gateway" ||
    key === "server" ||
    key === "remote" ||
    key === "http"
  ) {
    return "gateway";
  }
  if (
    key === "edge" ||
    key === "d1" ||
    key === "cloudflare" ||
    key === "local"
  ) {
    return "edge";
  }
  throw new AthenaConfigurationError(
    "ATHENA_NO_SERVICE_CONFIGURED",
    `Unknown Athena execution prefer "${raw}". Use edge | gateway.`,
    "db"
  );
}

/**
 * Resolve whether to use gateway HTTP or edge D1/R2 bindings.
 *
 * Auto rules (after env override):
 * 1. Only D1 → `edge`
 * 2. Only gateway URL → `gateway`
 * 3. Both → `prefer` (default `edge`, or env `ATHENA_EXECUTION_PREFER`)
 * 4. Neither → throw {@link AthenaConfigurationError}
 */
export function resolveAthenaExecutionMode(
  input: ResolveAthenaExecutionModeInput = {}
): AthenaResolvedExecutionMode {
  const env = input.env ?? {};
  const fromEnv = normalizeModeString(env[ATHENA_EXECUTION_MODE_ENV_KEY]);
  const requested = normalizeModeString(input.mode) ?? fromEnv ?? "auto";
  const url = resolveGatewayUrl(input.url, env);
  const hasD1 = isD1Binding(input.d1);
  const hasGateway = Boolean(url);

  if (requested === "gateway") {
    if (!hasGateway) {
      throw new AthenaConfigurationError(
        "ATHENA_NO_SERVICE_CONFIGURED",
        'Athena execution mode is "gateway" but no url / ATHENA_URL / ATHENA_DB_URL / ATHENA_GATEWAY_URL was provided.',
        "db"
      );
    }
    return "gateway";
  }
  if (requested === "edge") {
    if (!hasD1) {
      throw new AthenaConfigurationError(
        "ATHENA_NO_SERVICE_CONFIGURED",
        'Athena execution mode is "edge" but no D1 binding was provided (db.d1 / config.d1 / env.DB).',
        "db"
      );
    }
    return "edge";
  }

  // auto
  if (hasD1 && hasGateway) {
    return resolvePrefer(input.prefer, env);
  }
  if (hasD1) {
    return "edge";
  }
  if (hasGateway) {
    return "gateway";
  }

  throw new AthenaConfigurationError(
    "ATHENA_NO_SERVICE_CONFIGURED",
    'Cannot resolve Athena execution mode: provide mode "gateway" with url/key, mode "edge" with d1, or mode "auto" with either a D1 binding or a gateway URL (ATHENA_URL / ATHENA_DB_URL / ATHENA_GATEWAY_URL).',
    "db"
  );
}

export function isD1DatabaseBinding(value: unknown): value is D1DatabaseLike {
  return isD1Binding(value);
}
