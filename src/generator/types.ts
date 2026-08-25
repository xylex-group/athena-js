import type { BackendType } from "../gateway/types.ts";
import type {
  AthenaClientModelsInput,
  IntrospectionSnapshot,
  SchemaIntrospectionProvider,
} from "../schema/types.ts";

/**
 * Supported case transformations for generated symbols and path token variants.
 */
export type NamingStyle = "preserve" | "camel" | "pascal" | "snake" | "kebab";

/**
 * Naming configuration for generated TypeScript identifiers.
 */
export interface GeneratorNamingConfig {
  databaseConst: NamingStyle;
  modelConst: NamingStyle;
  modelType: NamingStyle;
  registryConst: NamingStyle;
  schemaConst: NamingStyle;
}

/**
 * Stable feature flags for generator output behavior.
 */
export interface GeneratorFeatureFlags {
  emitRegistry: boolean;
  emitRelations: boolean;
}

/**
 * Experimental toggles for optional/forward-compatible generator behavior.
 */
export interface GeneratorExperimentalFlags {
  /**
   * Legacy compatibility toggle from the initial scaffold.
   * Gateway introspection is now implemented; this flag is retained for additive config compatibility.
   */
  postgresGatewayIntrospection: boolean;
  /**
   * Enables contract placeholders for future Scylla provider work.
   */
  scyllaProviderContracts: boolean;
}

/**
 * Internal generator metadata carried on normalized configs and generated
 * registry artifacts so downstream tooling can detect contract revisions.
 */
export interface GeneratorInternalConfig {
  schemaVersion: number;
}

/**
 * Path templates for each generated artifact category.
 */
export interface GeneratorOutputTargets {
  database: string;
  model: string;
  registry: string;
  schema: string;
}

export type GeneratorOutputPreset = "legacy" | "athena-direct";
export type GeneratorOutputFormat = "define-model" | "table-builder";

/**
 * How existing database/registry artifacts are handled on regenerate.
 *
 * - `merge` (default): additive smart merge — append missing imports/keys, preserve custom code
 * - `skip`: never rewrite existing files (legacy protect behavior)
 * - `overwrite`: always replace with pure generated content
 */
export type GeneratorArtifactWritePolicy = "merge" | "skip" | "overwrite";

/**
 * Per-kind write policy for protected generator artifacts.
 */
export interface GeneratorArtifactWriteConfig {
  database?: GeneratorArtifactWritePolicy;
  registry?: GeneratorArtifactWritePolicy;
}

/**
 * Output configuration including dynamic placeholder aliases.
 */
export interface GeneratorOutputConfig {
  artifactWrite?: GeneratorArtifactWriteConfig;
  format?: GeneratorOutputFormat;
  placeholderMap?: Record<string, string>;
  preset?: GeneratorOutputPreset;
  targets?: Partial<GeneratorOutputTargets>;
}

/**
 * Normalized output configuration with defaults applied.
 */
export interface NormalizedGeneratorOutputConfig {
  artifactWrite: {
    database: GeneratorArtifactWritePolicy;
    registry: GeneratorArtifactWritePolicy;
  };
  format: GeneratorOutputFormat;
  placeholderMap: Record<string, string>;
  preset: GeneratorOutputPreset;
  targets: GeneratorOutputTargets;
}

/**
 * Schemas selected for PostgreSQL introspection. Strings may be comma-separated
 * to support env-driven configs such as `process.env.GENERATOR_SCHEMAS`.
 */
export type GeneratorSchemaSelection = string | readonly string[];
export type GeneratorTableSelection = string | readonly string[];

/**
 * Optional generator-side table filters used to keep the emitted surface small.
 */
export interface GeneratorFilterConfig {
  excludeTables?: GeneratorTableSelection;
  includeTables?: GeneratorTableSelection;
}

export interface NormalizedGeneratorFilterConfig {
  excludeTables: string[];
  includeTables: string[];
}

/**
 * Direct PostgreSQL introspection mode (implemented).
 */
export interface PostgresDirectProviderConfig {
  connectionString: string;
  database?: string;
  kind: "postgres";
  mode: "direct";
  schemas?: GeneratorSchemaSelection;
}

export interface PostgresDirectProviderInputConfig {
  connectionString?: string;
  database?: string;
  kind: "postgres";
  mode: "direct";
  schemas?: GeneratorSchemaSelection;
}

/**
 * Athena gateway-backed PostgreSQL introspection mode using `/gateway/query`.
 */
export interface PostgresGatewayProviderConfig {
  apiKey: string;
  backend?: BackendType;
  /**
   * Tenant / registry client name sent as `X-Athena-Client`.
   * Required on multi-tenant gateways (defaults to env `ATHENA_CLIENT` /
   * `ATHENA_GATEWAY_CLIENT` when omitted).
   */
  client?: string;
  database: string;
  gatewayUrl: string;
  kind: "postgres";
  mode: "gateway";
  schemas?: GeneratorSchemaSelection;
}

export interface PostgresGatewayProviderInputConfig {
  apiKey?: string;
  backend?: BackendType;
  /**
   * Tenant / registry client name sent as `X-Athena-Client`.
   * Prefer `generatorEnv("ATHENA_CLIENT")` or set `ATHENA_CLIENT` /
   * `ATHENA_GATEWAY_CLIENT` in `.env.local`.
   */
  client?: string;
  database?: string;
  gatewayUrl?: string;
  kind: "postgres";
  mode: "gateway";
  schemas?: GeneratorSchemaSelection;
}

/**
 * Scylla introspection provider contract placeholder (phase-two scaffold).
 */
export interface ScyllaDirectProviderConfig {
  contactPoints: string[];
  datacenter?: string;
  keyspace: string;
  kind: "scylla";
  mode: "direct";
}

export interface ScyllaDirectProviderInputConfig {
  contactPoints?: string[];
  datacenter?: string;
  keyspace?: string;
  kind: "scylla";
  mode: "direct";
}

export type GeneratorProviderConfig =
  | PostgresDirectProviderConfig
  | PostgresGatewayProviderConfig
  | ScyllaDirectProviderConfig;

export type GeneratorProviderInputConfig =
  | PostgresDirectProviderInputConfig
  | PostgresGatewayProviderInputConfig
  | ScyllaDirectProviderInputConfig;

/**
 * Application SQL migration tooling config (CLI / Node only).
 * Default directory is `athena/migrations` relative to project cwd.
 */
export interface AthenaMigrationsConfig {
  /**
   * Directory containing ordered `NNNN_name.sql` files.
   * Relative paths resolve from project cwd.
   */
  directory?: string;
}

/**
 * Normalized migrations config with defaults applied.
 */
export interface NormalizedAthenaMigrationsConfig {
  directory: string;
}

/**
 * Bootstrap-safe path entrypoints for CLI/tooling. Paths are metadata;
 * `generate` must not import them. Policy CLI may lazy-resolve `policies`.
 * `createClient` never reads these paths.
 */
export interface AthenaToolingEntrypoints {
  models?: string;
  policies?: string;
}

/**
 * Static policy bag on `athena.config.ts`. Applications still pass
 * `policies` explicitly into `createClient` — this is not a spread bag.
 */
export interface AthenaPolicyProjectConfig {
  definitions?: unknown;
  enforce?: boolean;
  mode?: "disabled" | "observe" | "enforce";
}

/**
 * Static project SSOT loaded from `athena.config.ts`.
 *
 * `provider` is optional so policy-only / generate-less apps can author
 * a config without a fake database. Generator commands still require
 * {@link AthenaGeneratorConfig.provider}.
 */
export interface AthenaConfig {
  experimental?: Partial<GeneratorExperimentalFlags>;
  features?: Partial<GeneratorFeatureFlags>;
  filter?: GeneratorFilterConfig;
  /** Optional SQL migration tooling settings. */
  migrations?: AthenaMigrationsConfig;
  /**
   * Tooling enablement for packaged domain migrations.
   * `athena-js migrate` applies Embedded Chat iff `modules.chat === true`.
   * Runtime `createClient({ chat: true })` is the same capability, not the migrate signal.
   */
  modules?: {
    auth?: boolean;
    chat?: boolean;
  };
  models?: AthenaClientModelsInput;
  naming?: Partial<GeneratorNamingConfig>;
  output?: GeneratorOutputConfig;
  policies?: AthenaPolicyProjectConfig;
  provider?: GeneratorProviderInputConfig;
  tooling?: AthenaToolingEntrypoints;
}

/**
 * Generator compile-time SSOT: same project fields as {@link AthenaConfig}
 * but `provider` is required. Used by `defineGeneratorConfig` and
 * `loadGeneratorConfig` / `athena-js generate`.
 */
export interface AthenaGeneratorConfig
  extends Omit<AthenaConfig, "provider"> {
  provider: GeneratorProviderInputConfig;
}

/**
 * Normalized generator config with defaults applied.
 */
export interface NormalizedAthenaGeneratorConfig {
  experimental: GeneratorExperimentalFlags;
  features: GeneratorFeatureFlags;
  filter: NormalizedGeneratorFilterConfig;
  internal: GeneratorInternalConfig;
  migrations: NormalizedAthenaMigrationsConfig;
  modules?: {
    auth?: boolean;
    chat?: boolean;
  };
  naming: GeneratorNamingConfig;
  output: NormalizedGeneratorOutputConfig;
  provider: GeneratorProviderConfig;
}

/**
 * Config loader options for CLI/programmatic usage.
 */
export interface LoadGeneratorConfigOptions {
  configPath?: string;
  cwd?: string;
}

/**
 * Options for {@link loadAthenaConfig} — same discovery as the generator loader.
 */
export type LoadAthenaConfigOptions = LoadGeneratorConfigOptions;

/**
 * Fully loaded config result including resolved file path.
 */
export interface LoadedGeneratorConfig {
  config: NormalizedAthenaGeneratorConfig;
  configPath: string;
}

/**
 * Full static project load. Retains `models`, `policies`, and `tooling`
 * exactly; does not project through {@link NormalizedAthenaGeneratorConfig}.
 */
export interface LoadedAthenaConfig {
  config: AthenaConfig;
  configPath: string;
}

export type GeneratorArtifactKind =
  | "model"
  | "schema"
  | "database"
  | "registry";

/**
 * One generated output file.
 */
export interface GeneratedArtifact {
  content: string;
  kind: GeneratorArtifactKind;
  path: string;
}

/**
 * In-memory generator output payload.
 */
export interface GeneratedArtifacts {
  files: GeneratedArtifact[];
  snapshot: IntrospectionSnapshot;
}

/**
 * Runtime options for executing the generator pipeline.
 */
export interface RunGeneratorOptions {
  configPath?: string;
  cwd?: string;
  /**
   * Discover live PostgreSQL schemas and expand the effective schema list
   * used for introspection. Defaults to true.
   */
  discoverSchemas?: boolean;
  dryRun?: boolean;
  provider?: SchemaIntrospectionProvider;
  /**
   * When true (default), ensure/update `athena.config.ts` intelligently:
   * create when missing, auto-fill schemas when discovery finds more,
   * skip writes when nothing changed.
   *
   * Pass false for pure env-only CI runs that must not touch the config file.
   */
  writeConfig?: boolean;
}

/**
 * Summary of intelligent config-file ensure work performed during generate.
 */
export interface GeneratorConfigEnsureSummary {
  action: "created" | "updated" | "unchanged" | "skipped";
  changes: string[];
  discoveryError?: string;
  path: string;
  reason?: string;
  /**
   * How schemas were chosen: live discovery, existing config, explicit input,
   * or fallback defaults (not a successful catalog read).
   */
  schemaProvenance?:
    | "discovered"
    | "configured"
    | "explicit"
    | "fallback";
  schemas: string[];
}

/**
 * `.athena/generated-manifest.json` payload written by the generator.
 */
export interface GeneratedManifest {
  config: string;
  generatorVersion: string;
  outputs: string[];
}

/**
 * Generator execution result including files written to disk.
 */
export interface RunGeneratorResult extends GeneratedArtifacts {
  config: NormalizedAthenaGeneratorConfig;
  /**
   * Present when generate ran config ensure/sync (even if action is unchanged).
   */
  configEnsure?: GeneratorConfigEnsureSummary;
  configPath: string;
  /** Architecture 4.0 ownership manifest for generated outputs. */
  generatedManifest: GeneratedManifest;
  /** Relative path of the written (or dry-run) generated manifest. */
  generatedManifestPath: string;
  skippedFiles: SkippedGeneratedArtifact[];
  writtenDetails: WrittenGeneratedArtifact[];
  writtenFiles: string[];
}

export type SkippedGeneratedArtifactReason =
  | "protected-existing-file"
  | "merge-conflict"
  | "merge-lint-failed"
  | "merge-unparseable"
  | "already-current";

export type WrittenGeneratedArtifactReason =
  | "created"
  | "overwritten"
  | "merged";

export interface SkippedGeneratedArtifact {
  conflicts?: string[];
  detail?: string;
  kind: GeneratorArtifactKind;
  lintErrors?: string[];
  path: string;
  preservedCustom?: string[];
  reason: SkippedGeneratedArtifactReason;
}

export interface WrittenGeneratedArtifact {
  added?: string[];
  kind: GeneratorArtifactKind;
  path: string;
  preservedCustom?: string[];
  reason: WrittenGeneratedArtifactReason;
}
