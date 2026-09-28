import {
  applyGeneratorProjectEnv,
  normalizeGeneratorConfig,
} from "./config.ts";
import type {
  AthenaGeneratorConfig,
  GeneratorProviderConfig,
  LoadedGeneratorConfig,
} from "./types.ts";

export type GeneratorDatabaseAuthorityMode = "direct" | "gateway" | "auto";

export type GeneratorDatabaseAuthoritySource =
  | "explicit-provider"
  | "loaded-config"
  | "environment-probe";

/**
 * Where a schema list written into config came from.
 *
 * - `discovered` — live catalog introspection
 * - `configured` — existing loaded/config schemas (no live discovery)
 * - `explicit` — caller-supplied schemas option
 * - `fallback` — `DEFAULT_POSTGRES_SCHEMAS` because discovery was unavailable
 */
export type GeneratorSchemaProvenance =
  | "discovered"
  | "configured"
  | "explicit"
  | "fallback";

export interface ResolvedGeneratorDatabaseAuthority {
  mode: "direct" | "gateway";
  provider: GeneratorProviderConfig;
  restoreEnv: () => void;
  source: GeneratorDatabaseAuthoritySource;
}

export interface ResolveGeneratorDatabaseAuthorityOptions {
  /**
   * When false, skip loading project `.env*` into `process.env`.
   * Defaults to true. Pass false when the caller already applied project env
   * (for example inside `loadGeneratorConfig`).
   */
  applyProjectEnv?: boolean;
  cwd?: string;
  loaded?: LoadedGeneratorConfig;
  /** Preferred provider mode when probing from environment. */
  mode?: GeneratorDatabaseAuthorityMode;
  /** Pre-resolved provider (skips probe / loaded lookup). */
  provider?: GeneratorProviderConfig;
}

function hasNonEmptyEnv(keys: readonly string[]): boolean {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return true;
    }
  }
  return false;
}

const DIRECT_CONNECTION_KEYS = [
  "ATHENA_GENERATOR_PG_URL",
  "DATABASE_URL",
  "PG_URL",
  "POSTGRES_URL",
  "POSTGRESQL_URL",
] as const;

const GATEWAY_URL_KEYS = [
  "ATHENA_URL",
  "ATHENA_GATEWAY_URL",
  "ATHENA_GENERATOR_URL",
] as const;

const GATEWAY_KEY_KEYS = [
  "ATHENA_API_KEY",
  "ATHENA_GATEWAY_API_KEY",
  "ATHENA_GENERATOR_API_KEY",
] as const;

/**
 * Picks direct vs gateway from env after project `.env*` has been applied.
 * Prefers direct when a connection string is present.
 */
export function detectAuthorityMode(
  preferred: GeneratorDatabaseAuthorityMode = "auto"
): "direct" | "gateway" {
  if (preferred === "direct" || preferred === "gateway") {
    return preferred;
  }

  const hasDirect = hasNonEmptyEnv(DIRECT_CONNECTION_KEYS);
  const hasGateway =
    hasNonEmptyEnv(GATEWAY_URL_KEYS) && hasNonEmptyEnv(GATEWAY_KEY_KEYS);

  if (hasDirect) {
    return "direct";
  }
  if (hasGateway) {
    return "gateway";
  }

  return "direct";
}

function providerModeOf(
  provider: GeneratorProviderConfig | undefined,
  preferred: GeneratorDatabaseAuthorityMode
): "direct" | "gateway" {
  if (provider && provider.kind === "postgres") {
    if (provider.mode === "gateway") {
      return "gateway";
    }
    if (provider.mode === "direct") {
      return "direct";
    }
  }
  return detectAuthorityMode(preferred);
}

/**
 * Resolves the canonical generator database authority used by migrate, init
 * schema discovery, generate, diff, and introspection.
 *
 * Always prefers an explicit provider, then a loaded normalized config, then an
 * environment probe — after optionally applying project `.env*` files the same
 * way `loadGeneratorConfig` / migrate do.
 */
export function resolveGeneratorDatabaseAuthority(
  options: ResolveGeneratorDatabaseAuthorityOptions = {}
): ResolvedGeneratorDatabaseAuthority {
  const cwd = options.cwd ?? process.cwd();
  const preferredMode = options.mode ?? "auto";
  const restoreEnv =
    options.applyProjectEnv === false
      ? () => {}
      : applyGeneratorProjectEnv(cwd);

  try {
    if (options.provider) {
      return {
        mode: providerModeOf(options.provider, preferredMode),
        provider: options.provider,
        restoreEnv,
        source: "explicit-provider",
      };
    }

    if (options.loaded) {
      return {
        mode: providerModeOf(options.loaded.config.provider, preferredMode),
        provider: options.loaded.config.provider,
        restoreEnv,
        source: "loaded-config",
      };
    }

    const mode = detectAuthorityMode(preferredMode);
    const probeConfig: AthenaGeneratorConfig = {
      provider:
        mode === "gateway"
          ? { kind: "postgres", mode: "gateway" }
          : { kind: "postgres", mode: "direct" },
    };
    const normalized = normalizeGeneratorConfig(probeConfig);
    return {
      mode,
      provider: normalized.provider,
      restoreEnv,
      source: "environment-probe",
    };
  } catch (error) {
    restoreEnv();
    throw error;
  }
}

/**
 * Human-readable explanation when schema discovery could not run and the CLI
 * fell back to `DEFAULT_POSTGRES_SCHEMAS` (typically `public`).
 */
export function formatSchemaFallbackMessages(options: {
  discoveryError?: string;
  schemas: readonly string[];
  /** Optional hint of schemas that often exist after migrate (e.g. athena). */
  expectedLiveSchemas?: readonly string[];
}): string[] {
  const reason =
    options.discoveryError?.trim() ||
    "no PostgreSQL connection could be resolved.";
  const schemaList = options.schemas.join(", ") || "public";
  const lines = [
    `Schema discovery unavailable: ${reason}`,
    `Config created with fallback schemas: ${schemaList}.`,
    "These schemas were NOT discovered from the database.",
    "",
    "To discover schemas, provide DATABASE_URL or another supported",
    "connection source and rerun:",
    "",
    "  athena-js init",
  ];

  const hints = options.expectedLiveSchemas?.filter((value) => value.trim());
  if (hints && hints.length > 0) {
    lines.push("", "Expected live schemas may include:");
    for (const schema of hints) {
      lines.push(`  ${schema}`);
    }
  }

  return lines;
}
