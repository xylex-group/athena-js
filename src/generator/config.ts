import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { pathToFileURL } from 'url'
import type {
  AthenaGeneratorConfig,
  GeneratorExperimentalFlags,
  GeneratorFeatureFlags,
  GeneratorInternalConfig,
  GeneratorNamingConfig,
  GeneratorOutputConfig,
  GeneratorOutputFormat,
  GeneratorOutputTargets,
  GeneratorProviderConfig,
  GeneratorProviderInputConfig,
  LoadGeneratorConfigOptions,
  LoadedGeneratorConfig,
  NormalizedGeneratorOutputConfig,
  NormalizedAthenaGeneratorConfig,
} from './types.ts'
import { parseBooleanFlag } from '../auxiliaries.ts'
import { normalizeSchemaSelection } from './schema-selection.ts'
import type { BackendType } from '../gateway/types.ts'

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:'])

const DEFAULT_CONFIG_CANDIDATES = [
  'athena.config.ts',
  'athena.config.js',
  'athena-js.config.ts',
  'athena-js.config.js',
  '.athena.config.ts',
  '.athena.config.js',
]

const DEFAULT_TARGETS: GeneratorOutputTargets = {
  model: 'athena/models/{schema_kebab}/{model_kebab}.ts',
  schema: 'athena/schemas/{schema_kebab}.ts',
  database: 'athena/relations.ts',
  registry: 'athena/config.ts',
}

const DEFAULT_OUTPUT_FORMAT: GeneratorOutputFormat = 'define-model'

const DEFAULT_NAMING: GeneratorNamingConfig = {
  modelType: 'pascal',
  modelConst: 'camel',
  schemaConst: 'camel',
  databaseConst: 'camel',
  registryConst: 'camel',
}

const DEFAULT_FEATURES: GeneratorFeatureFlags = {
  emitRelations: true,
  emitRegistry: true,
}

const DEFAULT_EXPERIMENTAL_FLAGS: GeneratorExperimentalFlags = {
  postgresGatewayIntrospection: false,
  scyllaProviderContracts: true,
}

const DEFAULT_INTERNAL_CONFIG: GeneratorInternalConfig = {
  schemaVersion: 1,
}

const PROJECT_ENV_FILENAMES = ['.env', '.env.local'] as const

const DIRECT_CONNECTION_STRING_ENV_KEYS = [
  'ATHENA_GENERATOR_PG_URL',
  'DATABASE_URL',
  'PG_URL',
  'POSTGRES_URL',
  'POSTGRESQL_URL',
] as const

const POSTGRES_DATABASE_ENV_KEYS = ['ATHENA_GENERATOR_DB', 'ATHENA_DATABASE', 'PGDATABASE'] as const

const POSTGRES_PASSWORD_ENV_KEYS = ['ATHENA_GENERATOR_PG_PASSWORD', 'PGPASSWORD'] as const

const GATEWAY_URL_ENV_KEYS = ['ATHENA_URL', 'ATHENA_GATEWAY_URL', 'ATHENA_GENERATOR_URL'] as const

const GATEWAY_API_KEY_ENV_KEYS = [
  'ATHENA_API_KEY',
  'ATHENA_GATEWAY_API_KEY',
  'ATHENA_GENERATOR_API_KEY',
] as const

const GENERATOR_SCHEMA_ENV_KEYS = ['ATHENA_GENERATOR_SCHEMAS'] as const
const OUTPUT_FORMAT_ENV_KEYS = ['ATHENA_GENERATOR_OUTPUT_FORMAT'] as const
const MODEL_TARGET_ENV_KEYS = ['ATHENA_GENERATOR_MODEL_TARGET'] as const
const SCHEMA_TARGET_ENV_KEYS = ['ATHENA_GENERATOR_SCHEMA_TARGET'] as const
const DATABASE_TARGET_ENV_KEYS = ['ATHENA_GENERATOR_DATABASE_TARGET'] as const
const REGISTRY_TARGET_ENV_KEYS = ['ATHENA_GENERATOR_REGISTRY_TARGET'] as const
const PLACEHOLDER_MAP_ENV_KEYS = ['ATHENA_GENERATOR_PLACEHOLDER_MAP'] as const
const MODEL_TYPE_ENV_KEYS = ['ATHENA_GENERATOR_MODEL_TYPE', 'ATHENA_GENERATOR_MODEL_STYLE'] as const
const MODEL_CONST_ENV_KEYS = ['ATHENA_GENERATOR_MODEL_CONST'] as const
const SCHEMA_CONST_ENV_KEYS = ['ATHENA_GENERATOR_SCHEMA_CONST'] as const
const DATABASE_CONST_ENV_KEYS = ['ATHENA_GENERATOR_DATABASE_CONST'] as const
const REGISTRY_CONST_ENV_KEYS = ['ATHENA_GENERATOR_REGISTRY_CONST'] as const
const EMIT_RELATIONS_ENV_KEYS = ['ATHENA_GENERATOR_EMIT_RELATIONS'] as const
const EMIT_REGISTRY_ENV_KEYS = ['ATHENA_GENERATOR_EMIT_REGISTRY'] as const
const GATEWAY_BACKEND_ENV_KEYS = ['ATHENA_GENERATOR_BACKEND'] as const
const GATEWAY_EXPERIMENTAL_ENV_KEYS = ['ATHENA_GENERATOR_GATEWAY_EXPERIMENTAL'] as const
const SCYLLA_PROVIDER_CONTRACTS_ENV_KEYS = ['ATHENA_GENERATOR_SCYLLA_PROVIDER_CONTRACTS'] as const
const ENV_ONLY_CONFIG_PATH = '[environment defaults]'

const NAMING_STYLE_VALUES = ['preserve', 'camel', 'pascal', 'snake', 'kebab'] as const
const OUTPUT_FORMAT_VALUES = ['define-model', 'table-builder'] as const
const BACKEND_TYPE_VALUES = ['athena', 'postgrest', 'postgresql', 'scylladb'] as const

function normalizeRawEnvValue(rawValue: string): string {
  if (rawValue.startsWith('"') && rawValue.endsWith('"') && rawValue.length >= 2) {
    const inner = rawValue.slice(1, -1)
    return inner
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }

  if (rawValue.startsWith("'") && rawValue.endsWith("'") && rawValue.length >= 2) {
    return rawValue.slice(1, -1)
  }

  const commentIndex = rawValue.search(/\s+#/)
  const withoutComment = commentIndex >= 0 ? rawValue.slice(0, commentIndex) : rawValue
  return withoutComment.trim()
}

function parseEnvLine(line: string): [key: string, value: string] | undefined {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) {
    return undefined
  }

  const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
  if (!match) {
    return undefined
  }

  const [, key, rawValue] = match
  return [key, normalizeRawEnvValue(rawValue.trim())]
}

function readProjectEnvEntries(cwd: string): Map<string, string> {
  const nodeEnv = process.env.NODE_ENV?.trim()
  const filenames = [
    ...PROJECT_ENV_FILENAMES,
    ...(nodeEnv ? [`.env.${nodeEnv}`, `.env.${nodeEnv}.local`] : []),
  ]

  const entries = new Map<string, string>()

  for (const filename of filenames) {
    const absolutePath = resolve(cwd, filename)
    if (!existsSync(absolutePath)) {
      continue
    }

    const content = readFileSync(absolutePath, 'utf8')
    const lines = content.split(/\r?\n/g)
    for (const line of lines) {
      const parsed = parseEnvLine(line)
      if (!parsed) {
        continue
      }
      const [key, value] = parsed
      entries.set(key, value)
    }
  }

  return entries
}

function applyProjectEnv(cwd: string): () => void {
  const envEntries = readProjectEnvEntries(cwd)
  if (envEntries.size === 0) {
    return () => {}
  }

  const initialKeys = new Set<string>(
    Object.keys(process.env).filter(key => process.env[key] !== undefined),
  )
  const staged = new Map<string, string>()

  for (const [key, value] of envEntries.entries()) {
    if (initialKeys.has(key)) {
      continue
    }
    staged.set(key, value)
  }

  for (const [key, value] of staged.entries()) {
    process.env[key] = value
  }

  return () => {
    for (const key of staged.keys()) {
      delete process.env[key]
    }
  }
}

function readEnvStringValue(key: string): string | undefined {
  const value = process.env[key]
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function resolveFallbackValue(
  fallbackKeys: readonly string[],
): string | undefined {
  for (const key of fallbackKeys) {
    const value = readEnvStringValue(key)
    if (value) {
      return value
    }
  }
  return undefined
}

function normalizeOneOfValue<const T extends string>(
  rawValue: string | undefined,
  allowedValues: readonly T[],
  envKeys: readonly string[],
): T | undefined {
  if (!rawValue) {
    return undefined
  }
  if (allowedValues.includes(rawValue as T)) {
    return rawValue as T
  }
  throw new Error(
    `Generator config env vars ${envKeys.join(', ')} must resolve to one of: ${allowedValues.join(', ')}. Received: ${rawValue}.`,
  )
}

function resolveOptionalOneOf<const T extends string>(
  envKeys: readonly string[],
  allowedValues: readonly T[],
): T | undefined {
  return normalizeOneOfValue(resolveFallbackValue(envKeys), allowedValues, envKeys)
}

function resolveOptionalBoolean(envKeys: readonly string[]): boolean | undefined {
  const rawValue = resolveFallbackValue(envKeys)
  return rawValue === undefined ? undefined : parseBooleanFlag(rawValue, false)
}

function resolveOptionalJson<T>(envKeys: readonly string[]): T | undefined {
  const rawValue = resolveFallbackValue(envKeys)
  if (rawValue === undefined) {
    return undefined
  }
  try {
    return JSON.parse(rawValue) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Generator config env vars ${envKeys.join(', ')} must contain valid JSON. ${message}`,
    )
  }
}

function deriveDatabaseNameFromConnectionString(connectionString: string): string | undefined {
  try {
    const parsedUrl = new URL(connectionString)
    if (!POSTGRES_PROTOCOLS.has(parsedUrl.protocol)) {
      return undefined
    }
    const pathname = parsedUrl.pathname.replace(/^\/+/, '').trim()
    return pathname.length > 0 ? decodeURIComponent(pathname) : undefined
  } catch {
    return undefined
  }
}

function normalizeOptionalString(
  value: unknown,
  fallbackKeys: readonly string[],
): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 0) {
      return trimmed
    }
  }

  return resolveFallbackValue(fallbackKeys)
}

function normalizeRequiredString(
  value: unknown,
  fieldLabel: string,
  fallbackKeys: readonly string[],
): string {
  const resolved = normalizeOptionalString(value, fallbackKeys)
  if (resolved) {
    return resolved
  }

  throw new Error(
    `Generator config is missing ${fieldLabel}. Set ${fieldLabel} directly or provide one of: ${fallbackKeys.join(', ')}.`,
  )
}

function applyPostgresPasswordFallback(connectionString: string): string {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(connectionString)
  } catch {
    return connectionString
  }

  if (!POSTGRES_PROTOCOLS.has(parsedUrl.protocol)) {
    return connectionString
  }

  if (!parsedUrl.username || parsedUrl.password) {
    return connectionString
  }

  const fallbackPassword = resolveFallbackValue(POSTGRES_PASSWORD_ENV_KEYS)
  if (!fallbackPassword) {
    return connectionString
  }

  parsedUrl.password = fallbackPassword
  return parsedUrl.toString()
}

function normalizeBooleanFlag(rawValue: unknown, fallback: boolean): boolean {
  if (typeof rawValue === 'boolean') {
    return rawValue
  }
  if (typeof rawValue === 'string') {
    return parseBooleanFlag(rawValue, fallback)
  }
  return fallback
}

function normalizeFeatureFlags(
  input: Partial<GeneratorFeatureFlags> | undefined,
): GeneratorFeatureFlags {
  return {
    emitRelations: normalizeBooleanFlag(
      input?.emitRelations,
      DEFAULT_FEATURES.emitRelations,
    ),
    emitRegistry: normalizeBooleanFlag(
      input?.emitRegistry,
      DEFAULT_FEATURES.emitRegistry,
    ),
  }
}

function normalizeExperimentalFlags(
  input: Partial<GeneratorExperimentalFlags> | undefined,
): GeneratorExperimentalFlags {
  return {
    postgresGatewayIntrospection: normalizeBooleanFlag(
      input?.postgresGatewayIntrospection,
      DEFAULT_EXPERIMENTAL_FLAGS.postgresGatewayIntrospection,
    ),
    scyllaProviderContracts: normalizeBooleanFlag(
      input?.scyllaProviderContracts,
      DEFAULT_EXPERIMENTAL_FLAGS.scyllaProviderContracts,
    ),
  }
}

function normalizeOutputConfig(output: GeneratorOutputConfig | undefined): NormalizedGeneratorOutputConfig {
  return {
    format: output?.format ?? DEFAULT_OUTPUT_FORMAT,
    targets: {
      ...DEFAULT_TARGETS,
      ...(output?.targets ?? {}),
    },
    placeholderMap: {
      ...(output?.placeholderMap ?? {}),
    },
  }
}

function normalizeProviderConfig(provider: GeneratorProviderInputConfig): GeneratorProviderConfig {
  if (provider.kind === 'postgres' && provider.mode === 'direct') {
    const connectionString = normalizeRequiredString(
      provider.connectionString,
      'provider.connectionString',
      DIRECT_CONNECTION_STRING_ENV_KEYS,
    )
    const database = normalizeOptionalString(provider.database, POSTGRES_DATABASE_ENV_KEYS)
      ?? deriveDatabaseNameFromConnectionString(connectionString)

    return {
      ...provider,
      connectionString: applyPostgresPasswordFallback(connectionString),
      database,
      schemas: normalizeSchemaSelection(provider.schemas),
    }
  }

  if (provider.kind === 'postgres' && provider.mode === 'gateway') {
    const gatewayUrl = normalizeRequiredString(
      provider.gatewayUrl,
      'provider.gatewayUrl',
      GATEWAY_URL_ENV_KEYS,
    )
    const apiKey = normalizeRequiredString(
      provider.apiKey,
      'provider.apiKey',
      GATEWAY_API_KEY_ENV_KEYS,
    )
    const database = normalizeOptionalString(provider.database, POSTGRES_DATABASE_ENV_KEYS) ?? 'postgres'

    return {
      ...provider,
      gatewayUrl,
      apiKey,
      database,
      schemas: normalizeSchemaSelection(provider.schemas),
    }
  }

  if (provider.kind === 'scylla' && provider.mode === 'direct') {
    if (!provider.contactPoints?.length) {
      throw new Error(
        'Generator config is missing provider.contactPoints for scylla direct mode.',
      )
    }
    const keyspace = normalizeOptionalString(provider.keyspace, [])
    if (!keyspace) {
      throw new Error(
        'Generator config is missing provider.keyspace for scylla direct mode.',
      )
    }

    return {
      kind: 'scylla',
      mode: 'direct',
      contactPoints: provider.contactPoints.slice(),
      keyspace,
      datacenter: normalizeOptionalString(provider.datacenter, []),
    }
  }

  return provider
}

function isAthenaGeneratorConfig(value: unknown): value is AthenaGeneratorConfig {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  return Boolean(record.provider && typeof record.provider === 'object') &&
    (record.output === undefined || typeof record.output === 'object')
}

export function normalizeGeneratorConfig(input: AthenaGeneratorConfig): NormalizedAthenaGeneratorConfig {
  return {
    provider: normalizeProviderConfig(input.provider),
    output: normalizeOutputConfig(input.output),
    naming: {
      ...DEFAULT_NAMING,
      ...(input.naming ?? {}),
    },
    features: normalizeFeatureFlags(input.features),
    experimental: normalizeExperimentalFlags(input.experimental),
    internal: {
      ...DEFAULT_INTERNAL_CONFIG,
    },
  }
}

/**
 * Typed identity helper for authoring generator configs.
 */
export function defineGeneratorConfig<TConfig extends AthenaGeneratorConfig>(
  config: TConfig,
): TConfig {
  return config
}

/**
 * Finds a supported generator config filename in the provided directory.
 */
export function findGeneratorConfigPath(cwd: string = process.cwd()): string | undefined {
  for (const candidate of DEFAULT_CONFIG_CANDIDATES) {
    const absolutePath = resolve(cwd, candidate)
    if (existsSync(absolutePath)) {
      return absolutePath
    }
  }
  return undefined
}

function extractConfigExport(module: unknown): AthenaGeneratorConfig {
  const visited = new Set<unknown>()
  const queue: unknown[] = [module]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || typeof current !== 'object' || visited.has(current)) {
      continue
    }
    visited.add(current)

    const record = current as Record<string, unknown>
    if (isAthenaGeneratorConfig(record)) {
      return record
    }

    const defaultExport = record.default
    if (defaultExport && typeof defaultExport === 'object') {
      queue.push(defaultExport)
    }

    const namedConfigExport = record.config
    if (namedConfigExport && typeof namedConfigExport === 'object') {
      queue.push(namedConfigExport)
    }

    const moduleExports = record['module.exports']
    if (moduleExports && typeof moduleExports === 'object') {
      queue.push(moduleExports)
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') {
        queue.push(value)
      }
    }
  }

  throw new Error(
    'Generator config file must export a config object as default export or `config`.',
  )
}

function importConfigModule(moduleSpecifier: string): Promise<unknown> {
  // Keep this as an indirect import so bundlers do not try to statically resolve
  // runtime file-system config paths when athena-js is consumed in Next.js.
  const runtimeImport = new Function(
    'moduleSpecifier',
    'return import(moduleSpecifier)',
  ) as (moduleSpecifier: string) => Promise<unknown>
  return runtimeImport(moduleSpecifier)
}

function buildEnvironmentOutputConfig(): GeneratorOutputConfig | undefined {
  const format = resolveOptionalOneOf(OUTPUT_FORMAT_ENV_KEYS, OUTPUT_FORMAT_VALUES)
  const modelTarget = resolveFallbackValue(MODEL_TARGET_ENV_KEYS)
  const schemaTarget = resolveFallbackValue(SCHEMA_TARGET_ENV_KEYS)
  const databaseTarget = resolveFallbackValue(DATABASE_TARGET_ENV_KEYS)
  const registryTarget = resolveFallbackValue(REGISTRY_TARGET_ENV_KEYS)
  const placeholderMap = resolveOptionalJson<Record<string, string>>(PLACEHOLDER_MAP_ENV_KEYS)

  if (
    format === undefined &&
    modelTarget === undefined &&
    schemaTarget === undefined &&
    databaseTarget === undefined &&
    registryTarget === undefined &&
    placeholderMap === undefined
  ) {
    return undefined
  }

  return {
    format,
    targets: {
      ...(modelTarget ? { model: modelTarget } : {}),
      ...(schemaTarget ? { schema: schemaTarget } : {}),
      ...(databaseTarget ? { database: databaseTarget } : {}),
      ...(registryTarget ? { registry: registryTarget } : {}),
    },
    placeholderMap,
  }
}

function buildEnvironmentNamingConfig(): Partial<GeneratorNamingConfig> | undefined {
  const modelType = resolveOptionalOneOf(MODEL_TYPE_ENV_KEYS, NAMING_STYLE_VALUES)
  const modelConst = resolveOptionalOneOf(MODEL_CONST_ENV_KEYS, NAMING_STYLE_VALUES)
  const schemaConst = resolveOptionalOneOf(SCHEMA_CONST_ENV_KEYS, NAMING_STYLE_VALUES)
  const databaseConst = resolveOptionalOneOf(DATABASE_CONST_ENV_KEYS, NAMING_STYLE_VALUES)
  const registryConst = resolveOptionalOneOf(REGISTRY_CONST_ENV_KEYS, NAMING_STYLE_VALUES)

  if (
    modelType === undefined &&
    modelConst === undefined &&
    schemaConst === undefined &&
    databaseConst === undefined &&
    registryConst === undefined
  ) {
    return undefined
  }

  return {
    ...(modelType ? { modelType } : {}),
    ...(modelConst ? { modelConst } : {}),
    ...(schemaConst ? { schemaConst } : {}),
    ...(databaseConst ? { databaseConst } : {}),
    ...(registryConst ? { registryConst } : {}),
  }
}

function buildEnvironmentFeatureFlags(): Partial<GeneratorFeatureFlags> | undefined {
  const emitRelations = resolveOptionalBoolean(EMIT_RELATIONS_ENV_KEYS)
  const emitRegistry = resolveOptionalBoolean(EMIT_REGISTRY_ENV_KEYS)

  if (emitRelations === undefined && emitRegistry === undefined) {
    return undefined
  }

  return {
    ...(emitRelations !== undefined ? { emitRelations } : {}),
    ...(emitRegistry !== undefined ? { emitRegistry } : {}),
  }
}

function buildEnvironmentExperimentalFlags(): Partial<GeneratorExperimentalFlags> | undefined {
  const postgresGatewayIntrospection = resolveOptionalBoolean(GATEWAY_EXPERIMENTAL_ENV_KEYS)
  const scyllaProviderContracts = resolveOptionalBoolean(SCYLLA_PROVIDER_CONTRACTS_ENV_KEYS)

  if (postgresGatewayIntrospection === undefined && scyllaProviderContracts === undefined) {
    return undefined
  }

  return {
    ...(postgresGatewayIntrospection !== undefined ? { postgresGatewayIntrospection } : {}),
    ...(scyllaProviderContracts !== undefined ? { scyllaProviderContracts } : {}),
  }
}

function buildEnvironmentProviderConfig(): GeneratorProviderInputConfig | undefined {
  const directConnectionString = resolveFallbackValue(DIRECT_CONNECTION_STRING_ENV_KEYS)
  if (directConnectionString) {
    return {
      kind: 'postgres',
      mode: 'direct',
      connectionString: directConnectionString,
      database: normalizeOptionalString(undefined, POSTGRES_DATABASE_ENV_KEYS),
      schemas: normalizeSchemaSelection(resolveFallbackValue(GENERATOR_SCHEMA_ENV_KEYS)),
    }
  }

  const gatewayUrl = resolveFallbackValue(GATEWAY_URL_ENV_KEYS)
  const apiKey = resolveFallbackValue(GATEWAY_API_KEY_ENV_KEYS)
  if (gatewayUrl && apiKey) {
    const backend = resolveOptionalOneOf(GATEWAY_BACKEND_ENV_KEYS, BACKEND_TYPE_VALUES) as BackendType | undefined
    return {
      kind: 'postgres',
      mode: 'gateway',
      gatewayUrl,
      apiKey,
      database: normalizeOptionalString(undefined, POSTGRES_DATABASE_ENV_KEYS),
      schemas: normalizeSchemaSelection(resolveFallbackValue(GENERATOR_SCHEMA_ENV_KEYS)),
      backend,
    }
  }

  return undefined
}

function createEnvironmentGeneratorConfig(): AthenaGeneratorConfig | undefined {
  const provider = buildEnvironmentProviderConfig()
  if (!provider) {
    return undefined
  }

  return {
    provider,
    output: buildEnvironmentOutputConfig(),
    naming: buildEnvironmentNamingConfig(),
    features: buildEnvironmentFeatureFlags(),
    experimental: buildEnvironmentExperimentalFlags(),
  }
}

/**
 * Loads and normalizes `athena.config.*` from disk.
 */
export async function loadGeneratorConfig(
  options: LoadGeneratorConfigOptions = {},
): Promise<LoadedGeneratorConfig> {
  const cwd = options.cwd ?? process.cwd()
  const restoreProjectEnv = applyProjectEnv(cwd)
  try {
    const resolvedPath = options.configPath
      ? resolve(cwd, options.configPath)
      : findGeneratorConfigPath(cwd)

    if (!resolvedPath) {
      const environmentConfig = createEnvironmentGeneratorConfig()
      if (environmentConfig) {
        return {
          configPath: ENV_ONLY_CONFIG_PATH,
          config: normalizeGeneratorConfig(environmentConfig),
        }
      }
      throw new Error(
        `No generator config found in ${cwd}. Expected one of: ${DEFAULT_CONFIG_CANDIDATES.join(', ')}. To run without a config file, set DATABASE_URL (direct mode) or ATHENA_URL + ATHENA_API_KEY (gateway mode).`,
      )
    }

    const moduleUrl = pathToFileURL(resolvedPath)
    const module = await importConfigModule(`${moduleUrl.href}?cacheBust=${Date.now()}`)
    const rawConfig = extractConfigExport(module)

    return {
      configPath: resolvedPath,
      config: normalizeGeneratorConfig(rawConfig),
    }
  } finally {
    restoreProjectEnv()
  }
}
