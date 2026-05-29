import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { pathToFileURL } from 'url'
import type {
  AthenaGeneratorConfig,
  GeneratorExperimentalFlags,
  GeneratorFeatureFlags,
  GeneratorNamingConfig,
  GeneratorOutputConfig,
  GeneratorOutputTargets,
  GeneratorProviderConfig,
  LoadGeneratorConfigOptions,
  LoadedGeneratorConfig,
  NormalizedAthenaGeneratorConfig,
} from './types.ts'
import { parseBooleanFlag } from '../auxiliaries.ts'
import { normalizeSchemaSelection } from './schema-selection.ts'

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

function normalizeOutputConfig(output: GeneratorOutputConfig): GeneratorOutputConfig {
  return {
    targets: {
      ...DEFAULT_TARGETS,
      ...(output.targets ?? {}),
    },
    placeholderMap: {
      ...(output.placeholderMap ?? {}),
    },
  }
}

function normalizeProviderConfig(provider: GeneratorProviderConfig): GeneratorProviderConfig {
  if (provider.kind === 'postgres' && provider.mode === 'direct') {
    const connectionString = normalizeRequiredString(
      provider.connectionString,
      'provider.connectionString',
      DIRECT_CONNECTION_STRING_ENV_KEYS,
    )
    const database = normalizeOptionalString(provider.database, POSTGRES_DATABASE_ENV_KEYS)

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
    const database = normalizeRequiredString(
      provider.database,
      'provider.database',
      POSTGRES_DATABASE_ENV_KEYS,
    )

    return {
      ...provider,
      gatewayUrl,
      apiKey,
      database,
      schemas: normalizeSchemaSelection(provider.schemas),
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
    Boolean(record.output && typeof record.output === 'object')
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

/**
 * Loads and normalizes `athena.config.*` from disk.
 */
export async function loadGeneratorConfig(
  options: LoadGeneratorConfigOptions = {},
): Promise<LoadedGeneratorConfig> {
  const cwd = options.cwd ?? process.cwd()
  const restoreProjectEnv = applyProjectEnv(cwd)
  const resolvedPath = options.configPath
    ? resolve(cwd, options.configPath)
    : findGeneratorConfigPath(cwd)

  if (!resolvedPath) {
    throw new Error(
      `No generator config found in ${cwd}. Expected one of: ${DEFAULT_CONFIG_CANDIDATES.join(', ')}`,
    )
  }

  try {
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
