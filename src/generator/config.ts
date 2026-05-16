import { existsSync } from 'fs'
import { resolve } from 'path'
import { pathToFileURL } from 'url'
import type {
  AthenaGeneratorConfig,
  GeneratorExperimentalFlags,
  GeneratorFeatureFlags,
  GeneratorNamingConfig,
  GeneratorOutputConfig,
  GeneratorOutputTargets,
  LoadGeneratorConfigOptions,
  LoadedGeneratorConfig,
  NormalizedAthenaGeneratorConfig,
} from './types.ts'

const DEFAULT_CONFIG_CANDIDATES = [
  'athena.config.ts',
  'athena.config.js',
  'athena-js.config.ts',
  'athena-js.config.js',
  '.athena.config.ts',
  '.athena.config.js',
]

const DEFAULT_TARGETS: GeneratorOutputTargets = {
  model: 'src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts',
  schema: 'src/generated/{database_kebab}/{schema_kebab}/index.ts',
  database: 'src/generated/{database_kebab}/index.ts',
  registry: 'src/generated/index.ts',
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
    provider: input.provider,
    output: normalizeOutputConfig(input.output),
    naming: {
      ...DEFAULT_NAMING,
      ...(input.naming ?? {}),
    },
    features: {
      ...DEFAULT_FEATURES,
      ...(input.features ?? {}),
    },
    experimental: {
      ...DEFAULT_EXPERIMENTAL_FLAGS,
      ...(input.experimental ?? {}),
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
  const resolvedPath = options.configPath
    ? resolve(cwd, options.configPath)
    : findGeneratorConfigPath(cwd)

  if (!resolvedPath) {
    throw new Error(
      `No generator config found in ${cwd}. Expected one of: ${DEFAULT_CONFIG_CANDIDATES.join(', ')}`,
    )
  }

  const moduleUrl = pathToFileURL(resolvedPath)
  const module = await importConfigModule(`${moduleUrl.href}?cacheBust=${Date.now()}`)
  const rawConfig = extractConfigExport(module)

  return {
    configPath: resolvedPath,
    config: normalizeGeneratorConfig(rawConfig),
  }
}
