import type { BackendType } from '../gateway/types.ts'
import type {
  IntrospectionSnapshot,
  SchemaIntrospectionProvider,
} from '../schema/types.ts'

/**
 * Supported case transformations for generated symbols and path token variants.
 */
export type NamingStyle = 'preserve' | 'camel' | 'pascal' | 'snake' | 'kebab'

/**
 * Naming configuration for generated TypeScript identifiers.
 */
export interface GeneratorNamingConfig {
  modelType: NamingStyle
  modelConst: NamingStyle
  schemaConst: NamingStyle
  databaseConst: NamingStyle
  registryConst: NamingStyle
}

/**
 * Stable feature flags for generator output behavior.
 */
export interface GeneratorFeatureFlags {
  emitRelations: boolean
  emitRegistry: boolean
}

/**
 * Experimental toggles for optional/forward-compatible generator behavior.
 */
export interface GeneratorExperimentalFlags {
  /**
   * Legacy compatibility toggle from the initial scaffold.
   * Gateway introspection is now implemented; this flag is retained for additive config compatibility.
   */
  postgresGatewayIntrospection: boolean
  /**
   * Enables contract placeholders for future Scylla provider work.
   */
  scyllaProviderContracts: boolean
}

/**
 * Internal generator metadata carried on normalized configs and generated
 * registry artifacts so downstream tooling can detect contract revisions.
 */
export interface GeneratorInternalConfig {
  schemaVersion: number
}

/**
 * Path templates for each generated artifact category.
 */
export interface GeneratorOutputTargets {
  model: string
  schema: string
  database: string
  registry: string
}

export type GeneratorOutputFormat = 'define-model' | 'table-builder'

/**
 * Output configuration including dynamic placeholder aliases.
 */
export interface GeneratorOutputConfig {
  format?: GeneratorOutputFormat
  targets?: Partial<GeneratorOutputTargets>
  placeholderMap?: Record<string, string>
}

/**
 * Normalized output configuration with defaults applied.
 */
export interface NormalizedGeneratorOutputConfig {
  format: GeneratorOutputFormat
  targets: GeneratorOutputTargets
  placeholderMap: Record<string, string>
}

/**
 * Schemas selected for PostgreSQL introspection. Strings may be comma-separated
 * to support env-driven configs such as `process.env.GENERATOR_SCHEMAS`.
 */
export type GeneratorSchemaSelection = string | readonly string[]

/**
 * Direct PostgreSQL introspection mode (implemented).
 */
export interface PostgresDirectProviderConfig {
  kind: 'postgres'
  mode: 'direct'
  connectionString: string
  database?: string
  schemas?: GeneratorSchemaSelection
}

export interface PostgresDirectProviderInputConfig {
  kind: 'postgres'
  mode: 'direct'
  connectionString?: string
  database?: string
  schemas?: GeneratorSchemaSelection
}

/**
 * Athena gateway-backed PostgreSQL introspection mode using `/gateway/query`.
 */
export interface PostgresGatewayProviderConfig {
  kind: 'postgres'
  mode: 'gateway'
  gatewayUrl: string
  apiKey: string
  database: string
  schemas?: GeneratorSchemaSelection
  backend?: BackendType
}

export interface PostgresGatewayProviderInputConfig {
  kind: 'postgres'
  mode: 'gateway'
  gatewayUrl?: string
  apiKey?: string
  database?: string
  schemas?: GeneratorSchemaSelection
  backend?: BackendType
}

/**
 * Scylla introspection provider contract placeholder (phase-two scaffold).
 */
export interface ScyllaDirectProviderConfig {
  kind: 'scylla'
  mode: 'direct'
  contactPoints: string[]
  keyspace: string
  datacenter?: string
}

export interface ScyllaDirectProviderInputConfig {
  kind: 'scylla'
  mode: 'direct'
  contactPoints?: string[]
  keyspace?: string
  datacenter?: string
}

export type GeneratorProviderConfig =
  | PostgresDirectProviderConfig
  | PostgresGatewayProviderConfig
  | ScyllaDirectProviderConfig

export type GeneratorProviderInputConfig =
  | PostgresDirectProviderInputConfig
  | PostgresGatewayProviderInputConfig
  | ScyllaDirectProviderInputConfig

/**
 * Root config contract loaded from `athena.config.ts`.
 */
export interface AthenaGeneratorConfig {
  provider: GeneratorProviderInputConfig
  output?: GeneratorOutputConfig
  naming?: Partial<GeneratorNamingConfig>
  features?: Partial<GeneratorFeatureFlags>
  experimental?: Partial<GeneratorExperimentalFlags>
}

/**
 * Normalized generator config with defaults applied.
 */
export interface NormalizedAthenaGeneratorConfig {
  provider: GeneratorProviderConfig
  output: NormalizedGeneratorOutputConfig
  naming: GeneratorNamingConfig
  features: GeneratorFeatureFlags
  experimental: GeneratorExperimentalFlags
  internal: GeneratorInternalConfig
}

/**
 * Config loader options for CLI/programmatic usage.
 */
export interface LoadGeneratorConfigOptions {
  cwd?: string
  configPath?: string
}

/**
 * Fully loaded config result including resolved file path.
 */
export interface LoadedGeneratorConfig {
  configPath: string
  config: NormalizedAthenaGeneratorConfig
}

export type GeneratorArtifactKind = 'model' | 'schema' | 'database' | 'registry'

/**
 * One generated output file.
 */
export interface GeneratedArtifact {
  kind: GeneratorArtifactKind
  path: string
  content: string
}

/**
 * In-memory generator output payload.
 */
export interface GeneratedArtifacts {
  snapshot: IntrospectionSnapshot
  files: GeneratedArtifact[]
}

/**
 * Runtime options for executing the generator pipeline.
 */
export interface RunGeneratorOptions {
  cwd?: string
  configPath?: string
  dryRun?: boolean
  provider?: SchemaIntrospectionProvider
}

/**
 * Generator execution result including files written to disk.
 */
export interface RunGeneratorResult extends GeneratedArtifacts {
  configPath: string
  writtenFiles: string[]
}
