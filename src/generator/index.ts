export {
  mergeProtectedArtifact,
  resolveArtifactWritePlan,
} from "./artifact-merge.ts";
export {
  ATHENA_GENERATED_ROOT,
  applyGeneratorProjectEnv,
  DEFAULT_MIGRATIONS_DIRECTORY,
  defineAthenaConfig,
  defineGeneratorConfig,
  findGeneratorConfigPath,
  GENERATED_MANIFEST_REL,
  loadGeneratorConfig,
  normalizeGeneratorConfig,
} from "./config.ts";
export type {
  GeneratorDatabaseAuthorityMode,
  GeneratorDatabaseAuthoritySource,
  GeneratorSchemaProvenance,
  ResolveGeneratorDatabaseAuthorityOptions,
  ResolvedGeneratorDatabaseAuthority,
} from "./database-authority.ts";
export {
  detectAuthorityMode,
  formatSchemaFallbackMessages,
  resolveGeneratorDatabaseAuthority,
} from "./database-authority.ts";
export type {
  RenderGeneratedFileHeaderOptions,
  RenderObjectPropertyOptions,
} from "./render-shared.ts";
export {
  GENERATED_FILE_BANNER,
  renderGeneratedFileHeader,
  renderObjectKey,
  renderObjectLiteral,
  renderObjectProperty,
  stripGeneratedFileHeader,
  withGeneratedFileBanner,
} from "./render-shared.ts";
export type {
  EnsureGeneratorConfigFileOptions,
  EnsureGeneratorConfigFileResult,
  GeneratorConfigFileAction,
  GeneratorConfigProviderMode,
} from "./config-file.ts";
export {
  detectGeneratorProviderMode,
  ensureGeneratorConfigFile,
  patchSchemasInConfigSource,
  renderGeneratorConfigFile,
} from "./config-file.ts";
export type {
  GeneratorEnvBooleanOptions,
  GeneratorEnvJsonOptions,
  GeneratorEnvListOptions,
  GeneratorEnvOneOfOptions,
  GeneratorEnvStringOptions,
} from "./env.ts";
export { generatorEnv } from "./env.ts";
export { runSchemaGenerator } from "./pipeline.ts";
export { resolvePostgresColumnType } from "./postgres-type-mapping.ts";
export { resolveGeneratorProvider } from "./providers.ts";
export { generateArtifactsFromSnapshot } from "./renderer.ts";
export {
  DISCOVER_POSTGRES_SCHEMAS_SQL,
  discoverPostgresSchemas,
  mergeSchemaSelections,
  normalizeDiscoveredSchemas,
  schemasEqual,
} from "./schema-discovery.ts";
export {
  DEFAULT_POSTGRES_SCHEMAS,
  normalizeSchemaSelection,
  resolveProviderSchemas,
} from "./schema-selection.ts";
export {
  filterIntrospectionSnapshot,
  normalizeTableSelection,
} from "./table-selection.ts";
export type {
  AthenaGeneratorConfig,
  AthenaMigrationsConfig,
  GeneratedArtifact,
  GeneratedArtifacts,
  GeneratedManifest,
  GeneratorArtifactKind,
  GeneratorArtifactWriteConfig,
  GeneratorArtifactWritePolicy,
  GeneratorConfigEnsureSummary,
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
  GeneratorSchemaSelection,
  GeneratorTableSelection,
  LoadedGeneratorConfig,
  LoadGeneratorConfigOptions,
  NamingStyle,
  NormalizedAthenaGeneratorConfig,
  NormalizedAthenaMigrationsConfig,
  NormalizedGeneratorFilterConfig,
  NormalizedGeneratorOutputConfig,
  RunGeneratorOptions,
  RunGeneratorResult,
  SkippedGeneratedArtifact,
  SkippedGeneratedArtifactReason,
  WrittenGeneratedArtifact,
  WrittenGeneratedArtifactReason,
} from "./types.ts";
