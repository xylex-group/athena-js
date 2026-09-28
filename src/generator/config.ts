import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseBooleanFlag } from "../auxiliaries.ts";
import { AthenaConfigurationError } from "../config/errors.ts";
import {
  defineAthenaConfig,
  defineGeneratorConfig,
} from "../config/project-helpers.ts";
import { ATHENA_ENV_CLIENT_KEYS } from "../env/index.ts";
import type { BackendType } from "../gateway/types.ts";
import { DEFAULT_MIGRATIONS_DIRECTORY } from "../migrations/constants.ts";
import { toAthenaConfigIr, toAthenaGeneratorConfigIr } from "./config-ir.ts";
import { normalizeSchemaSelection } from "./schema-selection.ts";
import { normalizeTableSelection } from "./table-selection.ts";
import type {
  AthenaConfig,
  AthenaGeneratorConfig,
  AthenaMigrationsConfig,
  GeneratorArtifactWriteConfig,
  GeneratorArtifactWritePolicy,
  GeneratorExperimentalFlags,
  GeneratorFeatureFlags,
  GeneratorFilterConfig,
  GeneratorInternalConfig,
  GeneratorNamingConfig,
  GeneratorOutputConfig,
  GeneratorOutputFormat,
  GeneratorOutputPreset,
  GeneratorOutputTargets,
  GeneratorProviderConfig,
  GeneratorProviderInputConfig,
  LoadAthenaConfigOptions,
  LoadedAthenaConfig,
  LoadedGeneratorConfig,
  LoadGeneratorConfigOptions,
  NormalizedAthenaGeneratorConfig,
  NormalizedAthenaMigrationsConfig,
  NormalizedGeneratorFilterConfig,
  NormalizedGeneratorOutputConfig,
  PostgresDirectProviderInputConfig,
} from "./types.ts";

export { DEFAULT_MIGRATIONS_DIRECTORY };

const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

const DEFAULT_CONFIG_CANDIDATES = [
  "athena.config.ts",
  "athena.config.js",
  "athena-js.config.ts",
  "athena-js.config.js",
  ".athena.config.ts",
  ".athena.config.js",
];

/**
 * N-1 layout (Architecture 3 / early 4-RC root `athena/*`).
 * Generator still accepts this preset; doctor warns; migrate upgrades to N.
 */
const LEGACY_DEFAULT_TARGETS: GeneratorOutputTargets = {
  database: "athena/relations.ts",
  model: "athena/models/{schema_kebab}/{model_kebab}.ts",
  registry: "athena/registry.generated.ts",
  schema: "athena/schemas/{schema_kebab}.ts",
};

/**
 * Project artifact root — generated models sit next to `athena/migrations`
 * and `athena/schema.snapshot.json`. Runtime client files may still live
 * under `src/lib/athena/` without a generated subtree.
 */
export const ATHENA_PROJECT_GENERATED_ROOT = "athena/generated";

/**
 * Accepted runtime-colocated generated root (Architecture 4.0 N).
 * Still first-class; generate does not warn.
 */
export const ATHENA_RUNTIME_GENERATED_ROOT = "src/lib/athena/generated";

/**
 * Architecture 4.0 default (`preset: athena-direct`) — project `athena/generated/`.
 * Model home is the `models/` directory (not a single long-term file).
 */
const ATHENA_DIRECT_TARGETS: GeneratorOutputTargets = {
  database: `${ATHENA_PROJECT_GENERATED_ROOT}/relations.ts`,
  model: `${ATHENA_PROJECT_GENERATED_ROOT}/models/{schema_kebab}/{model_kebab}.ts`,
  registry: `${ATHENA_PROJECT_GENERATED_ROOT}/registry.ts`,
  schema: `${ATHENA_PROJECT_GENERATED_ROOT}/schema/{schema_kebab}.ts`,
};

/** Default generated root (project artifact folder). */
export const ATHENA_GENERATED_ROOT = ATHENA_PROJECT_GENERATED_ROOT;

function normalizeGeneratedPath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

/** True when a target lives under project or runtime-colocated generated roots. */
export function isCurrentAthenaGeneratedPath(pathValue: string): boolean {
  const path = normalizeGeneratedPath(pathValue);
  return (
    path === ATHENA_PROJECT_GENERATED_ROOT ||
    path.startsWith(`${ATHENA_PROJECT_GENERATED_ROOT}/`) ||
    path === ATHENA_RUNTIME_GENERATED_ROOT ||
    path.startsWith(`${ATHENA_RUNTIME_GENERATED_ROOT}/`)
  );
}

/**
 * True for flat N-1 `athena/*` (registry.generated.ts, athena/schema.ts, …)
 * and not for `athena/generated/**`.
 */
export function isLegacyFlatAthenaGeneratedPath(pathValue: string): boolean {
  const path = normalizeGeneratedPath(pathValue);
  if (isCurrentAthenaGeneratedPath(path)) {
    return false;
  }
  return path === "athena" || path.startsWith("athena/");
}

/** Path of generator ownership manifest relative to project cwd. */
export const GENERATED_MANIFEST_REL = ".athena/generated-manifest.json";

const DEFAULT_OUTPUT_FORMAT: GeneratorOutputFormat = "table-builder";
const DEFAULT_OUTPUT_PRESET: GeneratorOutputPreset = "athena-direct";
const DEFAULT_ARTIFACT_WRITE_POLICY: GeneratorArtifactWritePolicy = "merge";
const ARTIFACT_WRITE_POLICIES = new Set<GeneratorArtifactWritePolicy>([
  "merge",
  "skip",
  "overwrite",
]);

const DEFAULT_NAMING: GeneratorNamingConfig = {
  databaseConst: "camel",
  modelConst: "camel",
  modelType: "pascal",
  registryConst: "camel",
  schemaConst: "camel",
};

const DEFAULT_FEATURES: GeneratorFeatureFlags = {
  emitRegistry: true,
  emitRelations: true,
};

const DEFAULT_EXPERIMENTAL_FLAGS: GeneratorExperimentalFlags = {
  postgresGatewayIntrospection: false,
  scyllaProviderContracts: true,
};

const DEFAULT_INTERNAL_CONFIG: GeneratorInternalConfig = {
  schemaVersion: 1,
};

const DEFAULT_FILTER_CONFIG = {
  excludeTables: [],
  includeTables: [],
} as const;

const PROJECT_ENV_FILENAMES = [".env", ".env.local"] as const;

const DIRECT_CONNECTION_STRING_ENV_KEYS = [
  "ATHENA_GENERATOR_PG_URL",
  "DATABASE_URL",
  "PG_URL",
  "POSTGRES_URL",
  "POSTGRESQL_URL",
] as const;

const POSTGRES_DATABASE_ENV_KEYS = [
  "ATHENA_GENERATOR_DB",
  "ATHENA_DATABASE",
  "PGDATABASE",
] as const;

const POSTGRES_PASSWORD_ENV_KEYS = [
  "ATHENA_GENERATOR_PG_PASSWORD",
  "PGPASSWORD",
] as const;

/**
 * Generator gateway URL keys (server/CLI only — intentionally omits NEXT_PUBLIC_*).
 * Includes primary + gateway alias keys, plus generator-only ATHENA_GENERATOR_URL.
 */
const GATEWAY_URL_ENV_KEYS = [
  "ATHENA_URL",
  "ATHENA_GATEWAY_URL",
  "ATHENA_GENERATOR_URL",
] as const;

/**
 * Generator API key keys (server/CLI only — no NEXT_PUBLIC_*, adds ATHENA_GENERATOR_API_KEY).
 */
const GATEWAY_API_KEY_ENV_KEYS = [
  "ATHENA_API_KEY",
  "ATHENA_GATEWAY_API_KEY",
  "ATHENA_GENERATOR_API_KEY",
] as const;

/**
 * Registry client name for gateway introspection (`X-Athena-Client`).
 * Shared env client keys via ATHENA_ENV_CLIENT_KEYS SSOT.
 */
const GATEWAY_CLIENT_ENV_KEYS = ATHENA_ENV_CLIENT_KEYS;

const GENERATOR_SCHEMA_ENV_KEYS = ["ATHENA_GENERATOR_SCHEMAS"] as const;
const OUTPUT_FORMAT_ENV_KEYS = ["ATHENA_GENERATOR_OUTPUT_FORMAT"] as const;
const OUTPUT_PRESET_ENV_KEYS = ["ATHENA_GENERATOR_OUTPUT_PRESET"] as const;
const MODEL_TARGET_ENV_KEYS = ["ATHENA_GENERATOR_MODEL_TARGET"] as const;
const SCHEMA_TARGET_ENV_KEYS = ["ATHENA_GENERATOR_SCHEMA_TARGET"] as const;
const DATABASE_TARGET_ENV_KEYS = ["ATHENA_GENERATOR_DATABASE_TARGET"] as const;
const REGISTRY_TARGET_ENV_KEYS = ["ATHENA_GENERATOR_REGISTRY_TARGET"] as const;
const TABLES_ENV_KEYS = ["ATHENA_GENERATOR_TABLES"] as const;
const EXCLUDE_TABLES_ENV_KEYS = ["ATHENA_GENERATOR_EXCLUDE_TABLES"] as const;
const PLACEHOLDER_MAP_ENV_KEYS = ["ATHENA_GENERATOR_PLACEHOLDER_MAP"] as const;
const MODEL_TYPE_ENV_KEYS = [
  "ATHENA_GENERATOR_MODEL_TYPE",
  "ATHENA_GENERATOR_MODEL_STYLE",
] as const;
const MODEL_CONST_ENV_KEYS = ["ATHENA_GENERATOR_MODEL_CONST"] as const;
const SCHEMA_CONST_ENV_KEYS = ["ATHENA_GENERATOR_SCHEMA_CONST"] as const;
const DATABASE_CONST_ENV_KEYS = ["ATHENA_GENERATOR_DATABASE_CONST"] as const;
const REGISTRY_CONST_ENV_KEYS = ["ATHENA_GENERATOR_REGISTRY_CONST"] as const;
const EMIT_RELATIONS_ENV_KEYS = ["ATHENA_GENERATOR_EMIT_RELATIONS"] as const;
const EMIT_REGISTRY_ENV_KEYS = ["ATHENA_GENERATOR_EMIT_REGISTRY"] as const;
const GATEWAY_BACKEND_ENV_KEYS = ["ATHENA_GENERATOR_BACKEND"] as const;
const GATEWAY_EXPERIMENTAL_ENV_KEYS = [
  "ATHENA_GENERATOR_GATEWAY_EXPERIMENTAL",
] as const;
const SCYLLA_PROVIDER_CONTRACTS_ENV_KEYS = [
  "ATHENA_GENERATOR_SCYLLA_PROVIDER_CONTRACTS",
] as const;
const ENV_ONLY_CONFIG_PATH = "[environment defaults]";

const NAMING_STYLE_VALUES = [
  "preserve",
  "camel",
  "pascal",
  "snake",
  "kebab",
] as const;
const OUTPUT_FORMAT_VALUES = ["define-model", "table-builder"] as const;
const OUTPUT_PRESET_VALUES = ["legacy", "athena-direct"] as const;
const BACKEND_TYPE_VALUES = [
  "athena",
  "postgrest",
  "postgresql",
  "scylladb",
] as const;

const OUTPUT_PRESET_TARGETS: Record<
  GeneratorOutputPreset,
  GeneratorOutputTargets
> = {
  "athena-direct": ATHENA_DIRECT_TARGETS,
  legacy: LEGACY_DEFAULT_TARGETS,
};

function normalizeRawEnvValue(rawValue: string): string {
  if (
    rawValue.startsWith('"') &&
    rawValue.endsWith('"') &&
    rawValue.length >= 2
  ) {
    const inner = rawValue.slice(1, -1);
    return inner
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }

  if (
    rawValue.startsWith("'") &&
    rawValue.endsWith("'") &&
    rawValue.length >= 2
  ) {
    return rawValue.slice(1, -1);
  }

  const commentIndex = rawValue.search(/\s+#/);
  const withoutComment =
    commentIndex >= 0 ? rawValue.slice(0, commentIndex) : rawValue;
  return withoutComment.trim();
}

function parseEnvLine(line: string): [key: string, value: string] | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return;
  }

  const match = trimmed.match(
    /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/
  );
  if (!match) {
    return;
  }

  const [, key, rawValue] = match;
  return [key, normalizeRawEnvValue(rawValue.trim())];
}

function readProjectEnvEntries(cwd: string): Map<string, string> {
  const nodeEnv = process.env.NODE_ENV?.trim();
  const filenames = [
    ...PROJECT_ENV_FILENAMES,
    ...(nodeEnv ? [`.env.${nodeEnv}`, `.env.${nodeEnv}.local`] : []),
  ];

  const entries = new Map<string, string>();

  for (const filename of filenames) {
    const absolutePath = resolve(cwd, filename);
    if (!existsSync(absolutePath)) {
      continue;
    }

    const content = readFileSync(absolutePath, "utf8");
    const lines = content.split(/\r?\n/g);
    for (const line of lines) {
      const parsed = parseEnvLine(line);
      if (!parsed) {
        continue;
      }
      const [key, value] = parsed;
      entries.set(key, value);
    }
  }

  return entries;
}

/**
 * Loads project `.env*` into `process.env` without overriding existing shell
 * values. Same authority migrate / `loadGeneratorConfig` use before resolving
 * connection strings. Returns a restore function that removes staged keys.
 */
export function applyGeneratorProjectEnv(cwd: string): () => void {
  const envEntries = readProjectEnvEntries(cwd);
  if (envEntries.size === 0) {
    return () => { };
  }

  const initialKeys = new Set<string>(
    Object.keys(process.env).filter((key) => process.env[key] !== undefined)
  );
  const staged = new Map<string, string>();

  for (const [key, value] of envEntries.entries()) {
    if (initialKeys.has(key)) {
      continue;
    }
    staged.set(key, value);
  }

  for (const [key, value] of staged.entries()) {
    process.env[key] = value;
  }

  return () => {
    for (const key of staged.keys()) {
      delete process.env[key];
    }
  };
}

/** @deprecated Use {@link applyGeneratorProjectEnv}. */
const applyProjectEnv = applyGeneratorProjectEnv;

function readEnvStringValue(key: string): string | undefined {
  const value = process.env[key];
  if (typeof value !== "string") {
    return;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveFallbackValue(
  fallbackKeys: readonly string[]
): string | undefined {
  for (const key of fallbackKeys) {
    const value = readEnvStringValue(key);
    if (value) {
      return value;
    }
  }
}

function normalizeOneOfValue<const T extends string>(
  rawValue: string | undefined,
  allowedValues: readonly T[],
  envKeys: readonly string[]
): T | undefined {
  if (!rawValue) {
    return;
  }
  if (allowedValues.includes(rawValue as T)) {
    return rawValue as T;
  }
  throw new Error(
    `Generator config env vars ${envKeys.join(", ")} must resolve to one of: ${allowedValues.join(", ")}. Received: ${rawValue}.`
  );
}

function resolveOptionalOneOf<const T extends string>(
  envKeys: readonly string[],
  allowedValues: readonly T[]
): T | undefined {
  return normalizeOneOfValue(
    resolveFallbackValue(envKeys),
    allowedValues,
    envKeys
  );
}

function resolveOptionalBoolean(
  envKeys: readonly string[]
): boolean | undefined {
  const rawValue = resolveFallbackValue(envKeys);
  return rawValue === undefined ? undefined : parseBooleanFlag(rawValue, false);
}

function resolveOptionalJson<T>(envKeys: readonly string[]): T | undefined {
  const rawValue = resolveFallbackValue(envKeys);
  if (rawValue === undefined) {
    return;
  }
  try {
    return JSON.parse(rawValue) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Generator config env vars ${envKeys.join(", ")} must contain valid JSON. ${message}`,
      { cause: error }
    );
  }
}

function deriveDatabaseNameFromConnectionString(
  connectionString: string
): string | undefined {
  try {
    const parsedUrl = new URL(connectionString);
    if (!POSTGRES_PROTOCOLS.has(parsedUrl.protocol)) {
      return;
    }
    const pathname = parsedUrl.pathname.replace(/^\/+/, "").trim();
    return pathname.length > 0 ? decodeURIComponent(pathname) : undefined;
  } catch {
    // Invalid connection string — no database name.
  }
}

function normalizeOptionalString(
  value: unknown,
  fallbackKeys: readonly string[]
): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return resolveFallbackValue(fallbackKeys);
}

function normalizeRequiredString(
  value: unknown,
  fieldLabel: string,
  fallbackKeys: readonly string[]
): string {
  const resolved = normalizeOptionalString(value, fallbackKeys);
  if (resolved) {
    return resolved;
  }

  throw new Error(
    `Generator config is missing ${fieldLabel}. Set ${fieldLabel} directly or provide one of: ${fallbackKeys.join(", ")}.`
  );
}

function applyPostgresPasswordFallback(connectionString: string): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(connectionString);
  } catch {
    return connectionString;
  }

  if (!POSTGRES_PROTOCOLS.has(parsedUrl.protocol)) {
    return connectionString;
  }

  if (!parsedUrl.username || parsedUrl.password) {
    return connectionString;
  }

  const fallbackPassword = resolveFallbackValue(POSTGRES_PASSWORD_ENV_KEYS);
  if (!fallbackPassword) {
    return connectionString;
  }

  parsedUrl.password = fallbackPassword;
  return parsedUrl.toString();
}

function normalizeBooleanFlag(rawValue: unknown, fallback: boolean): boolean {
  if (typeof rawValue === "boolean") {
    return rawValue;
  }
  if (typeof rawValue === "string") {
    return parseBooleanFlag(rawValue, fallback);
  }
  return fallback;
}

function normalizeFeatureFlags(
  input: Partial<GeneratorFeatureFlags> | undefined
): GeneratorFeatureFlags {
  return {
    emitRegistry: normalizeBooleanFlag(
      input?.emitRegistry,
      DEFAULT_FEATURES.emitRegistry
    ),
    emitRelations: normalizeBooleanFlag(
      input?.emitRelations,
      DEFAULT_FEATURES.emitRelations
    ),
  };
}

function normalizeExperimentalFlags(
  input: Partial<GeneratorExperimentalFlags> | undefined
): GeneratorExperimentalFlags {
  return {
    postgresGatewayIntrospection: normalizeBooleanFlag(
      input?.postgresGatewayIntrospection,
      DEFAULT_EXPERIMENTAL_FLAGS.postgresGatewayIntrospection
    ),
    scyllaProviderContracts: normalizeBooleanFlag(
      input?.scyllaProviderContracts,
      DEFAULT_EXPERIMENTAL_FLAGS.scyllaProviderContracts
    ),
  };
}

function normalizeFilterConfig(
  input: GeneratorFilterConfig | undefined,
): NormalizedGeneratorFilterConfig {
  const normalized: NormalizedGeneratorFilterConfig = {
    excludeTables: normalizeTableSelection(input?.excludeTables),
    includeTables: normalizeTableSelection(input?.includeTables),
  };
  if (input !== undefined) {
    normalized.raw = input;
  }
  return normalized;
}

function normalizeArtifactWritePolicy(
  value: unknown,
  fieldName: string
): GeneratorArtifactWritePolicy {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_ARTIFACT_WRITE_POLICY;
  }
  if (
    typeof value === "string" &&
    ARTIFACT_WRITE_POLICIES.has(value as GeneratorArtifactWritePolicy)
  ) {
    return value as GeneratorArtifactWritePolicy;
  }
  throw new Error(
    `Invalid output.artifactWrite.${fieldName}: expected one of merge | skip | overwrite, received ${JSON.stringify(value)}.`
  );
}

function normalizeArtifactWriteConfig(
  input: GeneratorArtifactWriteConfig | undefined
): NormalizedGeneratorOutputConfig["artifactWrite"] {
  return {
    database: normalizeArtifactWritePolicy(input?.database, "database"),
    registry: normalizeArtifactWritePolicy(input?.registry, "registry"),
  };
}

function normalizeOutputConfig(
  output: GeneratorOutputConfig | undefined
): NormalizedGeneratorOutputConfig {
  const preset = output?.preset ?? DEFAULT_OUTPUT_PRESET;
  return {
    artifactWrite: normalizeArtifactWriteConfig(output?.artifactWrite),
    format: output?.format ?? DEFAULT_OUTPUT_FORMAT,
    placeholderMap: {
      ...(output?.placeholderMap ?? {}),
    },
    preset,
    targets: {
      ...OUTPUT_PRESET_TARGETS[preset],
      ...(output?.targets ?? {}),
    },
  };
}

function normalizeProviderConfig(
  provider: GeneratorProviderInputConfig
): GeneratorProviderConfig {
  if (provider.kind === "postgres" && provider.mode === "direct") {
    const connectionString = normalizeRequiredString(
      provider.connectionString,
      "provider.connectionString",
      DIRECT_CONNECTION_STRING_ENV_KEYS
    );
    const database =
      normalizeOptionalString(provider.database, POSTGRES_DATABASE_ENV_KEYS) ??
      deriveDatabaseNameFromConnectionString(connectionString);

    return {
      ...provider,
      connectionString: applyPostgresPasswordFallback(connectionString),
      database,
      schemas: normalizeSchemaSelection(provider.schemas),
    };
  }

  if (provider.kind === "postgres" && provider.mode === "gateway") {
    const gatewayUrl = normalizeRequiredString(
      provider.gatewayUrl,
      "provider.gatewayUrl",
      GATEWAY_URL_ENV_KEYS
    );
    const apiKey = normalizeRequiredString(
      provider.apiKey,
      "provider.apiKey",
      GATEWAY_API_KEY_ENV_KEYS
    );
    const database =
      normalizeOptionalString(provider.database, POSTGRES_DATABASE_ENV_KEYS) ??
      "postgres";
    const client = normalizeOptionalString(
      provider.client,
      GATEWAY_CLIENT_ENV_KEYS
    );

    return {
      ...provider,
      apiKey,
      database,
      gatewayUrl,
      ...(client ? { client } : {}),
      schemas: normalizeSchemaSelection(provider.schemas),
    };
  }

  if (provider.kind === "scylla" && provider.mode === "direct") {
    if (!provider.contactPoints?.length) {
      throw new Error(
        "Generator config is missing provider.contactPoints for scylla direct mode."
      );
    }
    const keyspace = normalizeOptionalString(provider.keyspace, []);
    if (!keyspace) {
      throw new Error(
        "Generator config is missing provider.keyspace for scylla direct mode."
      );
    }

    return {
      contactPoints: provider.contactPoints.slice(),
      datacenter: normalizeOptionalString(provider.datacenter, []),
      keyspace,
      kind: "scylla",
      mode: "direct",
    };
  }

  return provider;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isOptionalObjectField(
  record: Record<string, unknown>,
  key: string
): boolean {
  const value = record[key];
  return value === undefined || (typeof value === "object" && value !== null);
}

function isAthenaConfig(value: unknown): value is AthenaConfig {
  if (!isPlainRecord(value)) {
    return false;
  }
  if (
    !(
      isOptionalObjectField(value, "provider") &&
      isOptionalObjectField(value, "output") &&
      isOptionalObjectField(value, "tooling") &&
      isOptionalObjectField(value, "models") &&
      isOptionalObjectField(value, "policies") &&
      isOptionalObjectField(value, "migrations") &&
      isOptionalObjectField(value, "local") &&
      isOptionalObjectField(value, "modules") &&
      isOptionalObjectField(value, "features") &&
      isOptionalObjectField(value, "experimental") &&
      isOptionalObjectField(value, "filter") &&
      isOptionalObjectField(value, "naming")
    )
  ) {
    return false;
  }
  return (
    value.provider !== undefined ||
    value.models !== undefined ||
    value.policies !== undefined ||
    value.tooling !== undefined ||
    value.output !== undefined ||
    value.migrations !== undefined ||
    value.local !== undefined ||
    value.modules !== undefined ||
    value.features !== undefined ||
    value.experimental !== undefined ||
    value.filter !== undefined ||
    value.naming !== undefined
  );
}

function isAthenaGeneratorConfig(
  value: unknown
): value is AthenaGeneratorConfig {
  return (
    isAthenaConfig(value) &&
    Boolean(value.provider && typeof value.provider === "object")
  );
}

const PROJECT_CONFIG_NESTED_KEYS = new Set([
  "experimental",
  "features",
  "filter",
  "migrations",
  "local",
  "models",
  "modules",
  "naming",
  "output",
  "policies",
  "provider",
  "tooling",
]);

function retainAthenaConfig(input: AthenaConfig): AthenaConfig {
  return toAthenaConfigIr(input);
}

function normalizeMigrationsConfig(
  input: AthenaMigrationsConfig | undefined
): NormalizedAthenaMigrationsConfig {
  const directory =
    typeof input?.directory === "string" && input.directory.trim().length > 0
      ? input.directory.trim()
      : DEFAULT_MIGRATIONS_DIRECTORY;
  return { directory };
}

function applyProviderOverride(
  config: AthenaGeneratorConfig,
  providerOverride: PostgresDirectProviderInputConfig
): AthenaGeneratorConfig {
  return {
    ...config,
    provider: providerOverride,
  };
}

export function normalizeGeneratorConfig(
  input: AthenaGeneratorConfig
): NormalizedAthenaGeneratorConfig {
  const config = toAthenaGeneratorConfigIr(input);
  const normalizedFilter = normalizeFilterConfig(config.filter);
  const filter: NormalizedGeneratorFilterConfig = {
    ...DEFAULT_FILTER_CONFIG,
    ...normalizedFilter,
  };
  if (normalizedFilter.raw !== undefined) {
    filter.raw = normalizedFilter.raw;
  }
  return {
    experimental: normalizeExperimentalFlags(config.experimental),
    features: normalizeFeatureFlags(config.features),
    filter,
    internal: {
      ...DEFAULT_INTERNAL_CONFIG,
    },
    migrations: normalizeMigrationsConfig(config.migrations),
    ...(config.modules === undefined ? {} : { modules: config.modules }),
    naming: {
      ...DEFAULT_NAMING,
      ...(config.naming ?? {}),
    },
    output: normalizeOutputConfig(config.output),
    provider: normalizeProviderConfig(config.provider),
  };
}

export { defineAthenaConfig, defineGeneratorConfig };

/**
 * Finds a supported generator config filename in the provided directory.
 */
export function findGeneratorConfigPath(
  cwd: string = process.cwd()
): string | undefined {
  for (const candidate of DEFAULT_CONFIG_CANDIDATES) {
    const absolutePath = resolve(cwd, candidate);
    if (existsSync(absolutePath)) {
      return absolutePath;
    }
  }
}

function enqueueConfigExportCandidates(
  record: Record<string, unknown>,
  queue: unknown[]
): void {
  const defaultExport = record.default;
  if (defaultExport && typeof defaultExport === "object") {
    queue.push(defaultExport);
  }

  const namedConfigExport = record.config;
  if (namedConfigExport && typeof namedConfigExport === "object") {
    queue.push(namedConfigExport);
  }

  const moduleExports = record["module.exports"];
  if (moduleExports && typeof moduleExports === "object") {
    queue.push(moduleExports);
  }

  for (const [key, value] of Object.entries(record)) {
    if (PROJECT_CONFIG_NESTED_KEYS.has(key)) {
      continue;
    }
    if (value && typeof value === "object") {
      queue.push(value);
    }
  }
}

function extractAthenaConfigExport(module: unknown): AthenaConfig {
  const visited = new Set<unknown>();
  const queue: unknown[] = [module];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || visited.has(current)) {
      continue;
    }
    visited.add(current);

    const record = current as Record<string, unknown>;
    if (isAthenaConfig(record)) {
      return record;
    }

    enqueueConfigExportCandidates(record, queue);
  }

  throw new Error(
    "Athena config file must export a config object as default export or `config`."
  );
}

function extractGeneratorConfigExport(module: unknown): AthenaGeneratorConfig {
  const visited = new Set<unknown>();
  const queue: unknown[] = [module];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || visited.has(current)) {
      continue;
    }
    visited.add(current);

    const record = current as Record<string, unknown>;
    if (isAthenaGeneratorConfig(record)) {
      return record;
    }

    enqueueConfigExportCandidates(record, queue);
  }

  throw new Error(
    "Generator config file must export a config object as default export or `config`."
  );
}

function isTypeScriptConfigPath(filePath: string): boolean {
  return /\.[cm]?tsx?$/i.test(filePath);
}

function isUnknownTypeScriptModuleError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error);
  return (
    ((code === "ERR_UNKNOWN_FILE_EXTENSION" ||
      code === "ERR_UNKNOWN_MODULE_FORMAT") &&
      /\.tsx?/i.test(message)) ||
    /Unknown file extension ["']\.tsx?["']/i.test(message)
  );
}

function isNodeUnsupportedTypescriptSyntax(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = "code" in error ? error.code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return (
    code === "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX" ||
    /strip-only mode/i.test(message) ||
    /parameter property is not supported/i.test(message)
  );
}

/**
 * Native `import()` of `athena.config.ts` uses Node type-stripping. Syntax Node
 * cannot strip (constructor parameter properties) fails with a cryptic code.
 * Real evaluation failures are {@link AthenaConfigurationError}
 * `ATHENA_CONFIG_IMPORT_FAILED` — loaders still do not instantiate runtimes.
 */
export function explainGeneratorConfigLoadError(
  error: unknown,
  configPath: string
): AthenaConfigurationError {
  if (error instanceof AthenaConfigurationError) {
    return error;
  }

  const cause = error instanceof Error ? { cause: error } : undefined;
  if (isNodeUnsupportedTypescriptSyntax(error)) {
    const message = [
      `Cannot load ${configPath}: Node.js type-stripping cannot compile this TypeScript.`,
      "Constructor parameter properties (`constructor(private foo: T)`) and similar syntax are not supported in strip-only mode.",
      "Import `defineAthenaConfig` / `generatorEnv` from `@xylex-group/athena/config` (the compiled package), not from `./src/...`.",
      error instanceof Error ? error.message : String(error),
    ].join("\n");
    return new AthenaConfigurationError(
      "ATHENA_CONFIG_IMPORT_FAILED",
      message,
      undefined,
      cause
    );
  }

  if (isUnknownTypeScriptModuleError(error)) {
    const message = [
      `Cannot load ${configPath}: this Node.js cannot import TypeScript config files.`,
      "Use Node.js 22.18+ (native type-stripping) or keep `tsx` installed next to the Athena CLI.",
      error instanceof Error ? error.message : String(error),
    ].join("\n");
    return new AthenaConfigurationError(
      "ATHENA_CONFIG_IMPORT_FAILED",
      message,
      undefined,
      cause
    );
  }

  const detail = error instanceof Error ? error.message : String(error);
  return new AthenaConfigurationError(
    "ATHENA_CONFIG_IMPORT_FAILED",
    `Cannot load ${configPath}: ${detail}`,
    undefined,
    cause
  );
}

function createRuntimeImport(): (moduleSpecifier: string) => Promise<unknown> {
  // Keep this as an indirect import so bundlers do not try to statically resolve
  // runtime file-system config paths when athena-js is consumed in Next.js.
  return new Function("moduleSpecifier", "return import(moduleSpecifier)") as (
    moduleSpecifier: string
  ) => Promise<unknown>;
}

function importConfigModule(moduleSpecifier: string): Promise<unknown> {
  return createRuntimeImport()(moduleSpecifier);
}

let typeScriptConfigLoaderPromise: Promise<boolean> | undefined;

async function ensureTypeScriptConfigLoader(
  anchorPath: string
): Promise<boolean> {
  if (typeScriptConfigLoaderPromise) {
    return typeScriptConfigLoaderPromise;
  }
  typeScriptConfigLoaderPromise = (async () => {
    const runtimeImport = createRuntimeImport();
    const nodeModule = (await runtimeImport("node:module")) as {
      createRequire: (filename: string) => {
        resolve: (id: string) => string;
      };
    };
    const anchors = [anchorPath, fileURLToPath(import.meta.url)];
    for (const anchor of anchors) {
      try {
        const require = nodeModule.createRequire(anchor);
        const tsxLoader = require.resolve("tsx");
        await runtimeImport(pathToFileURL(tsxLoader).href);
        return true;
      } catch {
        /* tsx not resolvable from this anchor */
      }
    }
    try {
      await runtimeImport("tsx");
      return true;
    } catch {
      return false;
    }
  })();
  return typeScriptConfigLoaderPromise;
}

async function importConfigFile(resolvedPath: string): Promise<unknown> {
  const moduleUrl = pathToFileURL(resolvedPath);
  const load = () =>
    importConfigModule(`${moduleUrl.href}?cacheBust=${Date.now()}`);
  try {
    return await load();
  } catch (error) {
    if (
      isTypeScriptConfigPath(resolvedPath) &&
      isUnknownTypeScriptModuleError(error)
    ) {
      const registered = await ensureTypeScriptConfigLoader(resolvedPath);
      if (registered) {
        try {
          return await load();
        } catch (retryError) {
          throw explainGeneratorConfigLoadError(retryError, resolvedPath);
        }
      }
    }
    throw explainGeneratorConfigLoadError(error, resolvedPath);
  }
}

function buildEnvironmentOutputConfig(): GeneratorOutputConfig | undefined {
  const format = resolveOptionalOneOf(
    OUTPUT_FORMAT_ENV_KEYS,
    OUTPUT_FORMAT_VALUES
  );
  const preset = resolveOptionalOneOf(
    OUTPUT_PRESET_ENV_KEYS,
    OUTPUT_PRESET_VALUES
  );
  const modelTarget = resolveFallbackValue(MODEL_TARGET_ENV_KEYS);
  const schemaTarget = resolveFallbackValue(SCHEMA_TARGET_ENV_KEYS);
  const databaseTarget = resolveFallbackValue(DATABASE_TARGET_ENV_KEYS);
  const registryTarget = resolveFallbackValue(REGISTRY_TARGET_ENV_KEYS);
  const placeholderMap = resolveOptionalJson<Record<string, string>>(
    PLACEHOLDER_MAP_ENV_KEYS
  );

  if (
    format === undefined &&
    preset === undefined &&
    modelTarget === undefined &&
    schemaTarget === undefined &&
    databaseTarget === undefined &&
    registryTarget === undefined &&
    placeholderMap === undefined
  ) {
    return;
  }

  return {
    format,
    placeholderMap,
    preset,
    targets: {
      ...(modelTarget ? { model: modelTarget } : {}),
      ...(schemaTarget ? { schema: schemaTarget } : {}),
      ...(databaseTarget ? { database: databaseTarget } : {}),
      ...(registryTarget ? { registry: registryTarget } : {}),
    },
  };
}

function buildEnvironmentFilterConfig(): GeneratorFilterConfig | undefined {
  const includeTables = resolveFallbackValue(TABLES_ENV_KEYS);
  const excludeTables = resolveFallbackValue(EXCLUDE_TABLES_ENV_KEYS);

  if (includeTables === undefined && excludeTables === undefined) {
    return;
  }

  return {
    ...(includeTables === undefined ? {} : { includeTables }),
    ...(excludeTables === undefined ? {} : { excludeTables }),
  };
}

function buildEnvironmentNamingConfig():
  | Partial<GeneratorNamingConfig>
  | undefined {
  const modelType = resolveOptionalOneOf(
    MODEL_TYPE_ENV_KEYS,
    NAMING_STYLE_VALUES
  );
  const modelConst = resolveOptionalOneOf(
    MODEL_CONST_ENV_KEYS,
    NAMING_STYLE_VALUES
  );
  const schemaConst = resolveOptionalOneOf(
    SCHEMA_CONST_ENV_KEYS,
    NAMING_STYLE_VALUES
  );
  const databaseConst = resolveOptionalOneOf(
    DATABASE_CONST_ENV_KEYS,
    NAMING_STYLE_VALUES
  );
  const registryConst = resolveOptionalOneOf(
    REGISTRY_CONST_ENV_KEYS,
    NAMING_STYLE_VALUES
  );

  if (
    modelType === undefined &&
    modelConst === undefined &&
    schemaConst === undefined &&
    databaseConst === undefined &&
    registryConst === undefined
  ) {
    return;
  }

  return {
    ...(modelType ? { modelType } : {}),
    ...(modelConst ? { modelConst } : {}),
    ...(schemaConst ? { schemaConst } : {}),
    ...(databaseConst ? { databaseConst } : {}),
    ...(registryConst ? { registryConst } : {}),
  };
}

function buildEnvironmentFeatureFlags():
  | Partial<GeneratorFeatureFlags>
  | undefined {
  const emitRelations = resolveOptionalBoolean(EMIT_RELATIONS_ENV_KEYS);
  const emitRegistry = resolveOptionalBoolean(EMIT_REGISTRY_ENV_KEYS);

  if (emitRelations === undefined && emitRegistry === undefined) {
    return;
  }

  return {
    ...(emitRelations === undefined ? {} : { emitRelations }),
    ...(emitRegistry === undefined ? {} : { emitRegistry }),
  };
}

function buildEnvironmentExperimentalFlags():
  | Partial<GeneratorExperimentalFlags>
  | undefined {
  const postgresGatewayIntrospection = resolveOptionalBoolean(
    GATEWAY_EXPERIMENTAL_ENV_KEYS
  );
  const scyllaProviderContracts = resolveOptionalBoolean(
    SCYLLA_PROVIDER_CONTRACTS_ENV_KEYS
  );

  if (
    postgresGatewayIntrospection === undefined &&
    scyllaProviderContracts === undefined
  ) {
    return;
  }

  return {
    ...(postgresGatewayIntrospection === undefined
      ? {}
      : { postgresGatewayIntrospection }),
    ...(scyllaProviderContracts === undefined
      ? {}
      : { scyllaProviderContracts }),
  };
}

function buildEnvironmentProviderConfig():
  | GeneratorProviderInputConfig
  | undefined {
  const directConnectionString = resolveFallbackValue(
    DIRECT_CONNECTION_STRING_ENV_KEYS
  );
  if (directConnectionString) {
    return {
      connectionString: directConnectionString,
      database: normalizeOptionalString(undefined, POSTGRES_DATABASE_ENV_KEYS),
      kind: "postgres",
      mode: "direct",
      schemas: normalizeSchemaSelection(
        resolveFallbackValue(GENERATOR_SCHEMA_ENV_KEYS)
      ),
    };
  }

  const gatewayUrl = resolveFallbackValue(GATEWAY_URL_ENV_KEYS);
  const apiKey = resolveFallbackValue(GATEWAY_API_KEY_ENV_KEYS);
  if (gatewayUrl && apiKey) {
    const backend = resolveOptionalOneOf(
      GATEWAY_BACKEND_ENV_KEYS,
      BACKEND_TYPE_VALUES
    ) as BackendType | undefined;
    const client = resolveFallbackValue(GATEWAY_CLIENT_ENV_KEYS);
    return {
      apiKey,
      backend,
      database: normalizeOptionalString(undefined, POSTGRES_DATABASE_ENV_KEYS),
      gatewayUrl,
      kind: "postgres",
      mode: "gateway",
      schemas: normalizeSchemaSelection(
        resolveFallbackValue(GENERATOR_SCHEMA_ENV_KEYS)
      ),
      ...(client ? { client } : {}),
    };
  }
}

function createEnvironmentGeneratorConfig(): AthenaGeneratorConfig | undefined {
  const provider = buildEnvironmentProviderConfig();
  if (!provider) {
    return;
  }

  return {
    experimental: buildEnvironmentExperimentalFlags(),
    features: buildEnvironmentFeatureFlags(),
    filter: buildEnvironmentFilterConfig(),
    naming: buildEnvironmentNamingConfig(),
    output: buildEnvironmentOutputConfig(),
    provider,
  };
}

/**
 * Loads the static project SSOT from `athena.config.*`.
 * Retains `models`, `policies`, and `tooling` exactly. Does not instantiate
 * clients, open database connections, or import `tooling.*` paths.
 */
export async function loadAthenaConfig(
  options: LoadAthenaConfigOptions = {}
): Promise<LoadedAthenaConfig> {
  const cwd = options.cwd ?? process.cwd();
  const restoreProjectEnv = applyProjectEnv(cwd);
  try {
    const resolvedPath = options.configPath
      ? resolve(cwd, options.configPath)
      : findGeneratorConfigPath(cwd);

    if (!resolvedPath) {
      throw new Error(
        `No Athena config found in ${cwd}. Expected one of: ${DEFAULT_CONFIG_CANDIDATES.join(", ")}.`
      );
    }

    const module = await importConfigFile(resolvedPath);
    const rawConfig = extractAthenaConfigExport(module);
    return {
      config: retainAthenaConfig(rawConfig),
      configPath: resolvedPath,
    };
  } finally {
    restoreProjectEnv();
  }
}

/**
 * Loads and normalizes `athena.config.*` as a required-provider generator
 * projection. Extra project-only keys (`models`, `policies`, `tooling`) are
 * dropped. Env-only fallback still requires a resolvable provider.
 */
export async function loadGeneratorConfig(
  options: LoadGeneratorConfigOptions = {}
): Promise<LoadedGeneratorConfig> {
  const cwd = options.cwd ?? process.cwd();
  const restoreAppliedEnv =
    options.applyProjectEnv === false ? () => { } : applyProjectEnv(cwd);
  try {
    const resolvedPath = options.configPath
      ? resolve(cwd, options.configPath)
      : findGeneratorConfigPath(cwd);

    if (!resolvedPath) {
      const environmentConfig = createEnvironmentGeneratorConfig();
      if (environmentConfig) {
        return {
          config: normalizeGeneratorConfig(
            options.providerOverride
              ? applyProviderOverride(
                environmentConfig,
                options.providerOverride
              )
              : environmentConfig
          ),
          configPath: ENV_ONLY_CONFIG_PATH,
        };
      }
      throw new Error(
        `No generator config found in ${cwd}. Expected one of: ${DEFAULT_CONFIG_CANDIDATES.join(", ")}. To run without a config file, set DATABASE_URL (direct mode) or ATHENA_URL + ATHENA_API_KEY (gateway mode).`
      );
    }

    const module = await importConfigFile(resolvedPath);
    const rawConfig = extractGeneratorConfigExport(module);

    return {
      config: normalizeGeneratorConfig(
        options.providerOverride
          ? applyProviderOverride(rawConfig, options.providerOverride)
          : rawConfig
      ),
      configPath: resolvedPath,
    };
  } finally {
    if (options.restoreProjectEnv !== false) {
      restoreAppliedEnv();
    }
  }
}
