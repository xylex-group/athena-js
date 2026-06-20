import { runSchemaGenerator } from '../generator/pipeline.ts'

interface GenerateCommand {
  command: 'generate'
  configPath?: string
  dryRun: boolean
}

interface HelpCommand {
  command: 'help'
  topic: 'root' | 'generate'
}

type CliCommand = GenerateCommand | HelpCommand

export interface CliRuntime {
  runGenerator?: typeof runSchemaGenerator
  log?: (message: string) => void
}

type ErrorWithCode = {
  code?: unknown
  message?: unknown
}

function rootUsage(): string {
  return [
    'athena-js CLI',
    '',
    'Usage:',
    '  athena-js generate [--config <path>] [--dry-run]',
    '',
    'Examples:',
    '  athena-js generate',
    '  DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/app_db athena-js generate --dry-run',
    '  athena-js generate --config ./athena.config.ts --dry-run',
    '  athena-js generate --help',
  ].join('\n')
}

function generateUsage(): string {
  return [
    'athena-js generate',
    '',
    'Usage:',
    '  athena-js generate [--config <path>] [--dry-run]',
    '',
    'Options:',
    '  --config <path>  Explicit path to athena.config.ts or athena-js.config.ts',
    '  --dry-run        Build generated files in memory without writing them to disk and print mode/target hints',
    '  -h, --help       Show help for generate',
    '',
    'Config resolution:',
    '  - uses athena.config.* discovery first',
    '  - falls back to env-only direct mode when DATABASE_URL/PG_URL is present',
    '  - falls back to env-only gateway mode when ATHENA_URL + ATHENA_API_KEY are present',
    '',
    'Examples:',
    '  athena-js generate',
    '  DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/app_db athena-js generate --dry-run',
    '  athena-js generate --config ./athena.config.ts --dry-run',
  ].join('\n')
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/')
}

function isLegacyConfigRegistryTarget(target: string): boolean {
  return normalizePath(target) === 'athena/config.ts'
}

function isFlatSchemaTarget(target: string): boolean {
  return normalizePath(target) === 'athena/schema.ts'
}

function formatProviderLine(
  result: Awaited<ReturnType<typeof runSchemaGenerator>>,
): string {
  const { provider } = result.config
  if (provider.kind === 'postgres') {
    const schemaList = Array.isArray(provider.schemas)
      ? provider.schemas.join(',')
      : typeof provider.schemas === 'string'
        ? provider.schemas
        : 'public'
    const database = provider.database ? ` database=${provider.database}` : ''
    const backend = provider.mode === 'gateway' && provider.backend ? ` backend=${provider.backend}` : ''
    return `[provider] kind=${provider.kind} mode=${provider.mode}${database}${backend} schemas=${schemaList}`
  }

  const datacenter = provider.datacenter ? ` datacenter=${provider.datacenter}` : ''
  return `[provider] kind=${provider.kind} mode=${provider.mode} keyspace=${provider.keyspace} contactPoints=${provider.contactPoints.join(',')}${datacenter}`
}

function formatFilterLine(
  result: Awaited<ReturnType<typeof runSchemaGenerator>>,
): string | undefined {
  const { includeTables, excludeTables } = result.config.filter
  if (includeTables.length === 0 && excludeTables.length === 0) {
    return undefined
  }

  return `[filter] include=${includeTables.length > 0 ? includeTables.join(',') : '-'} exclude=${excludeTables.length > 0 ? excludeTables.join(',') : '-'}`
}

function formatGeneratorModeLines(
  result: Awaited<ReturnType<typeof runSchemaGenerator>>,
): string[] {
  const lines = [
    `[mode] preset=${result.config.output.preset} format=${result.config.output.format} modelTarget=${result.config.output.targets.model}`,
    formatProviderLine(result),
    `[targets] schema=${result.config.output.targets.schema} database=${result.config.output.targets.database} registry=${result.config.output.targets.registry}`,
  ]
  const filterLine = formatFilterLine(result)
  if (filterLine) {
    lines.push(filterLine)
  }

  if (result.config.output.format === 'define-model') {
    lines.push(
      '[note] Legacy define-model compatibility output is active. Set output.format="table-builder" or ATHENA_GENERATOR_OUTPUT_FORMAT=table-builder to emit table(...).schema(...).columns(...).primaryKey(...).',
    )
  }

  if (result.config.output.preset === 'legacy') {
    lines.push(
      '[note] Legacy preset is active. It keeps registry output on athena/config.ts for compatibility; prefer output.preset="athena-direct" for the default safe direct layout.',
    )
  }

  lines.push(
    '[note] Default generator mode is preset=athena-direct + format=table-builder. experimental.findManyAst only affects runtime findMany(...) transport and does not enable generator table output.',
  )

  if (isLegacyConfigRegistryTarget(result.config.output.targets.registry)) {
    lines.push(
      '[warn] Registry target points at athena/config.ts. That file is often a handwritten runtime seam; prefer output.preset="athena-direct" or output.targets.registry="athena/registry.generated.ts" unless you intentionally need legacy compatibility.',
    )
  }

  if (isFlatSchemaTarget(result.config.output.targets.schema)) {
    lines.push(
      '[warn] Schema target points at athena/schema.ts. Prefer schema-scoped output such as athena/schemas/{schema_kebab}.ts.',
    )
  }

  return lines
}

export function usage(topic: HelpCommand['topic'] = 'root'): string {
  return topic === 'generate' ? generateUsage() : rootUsage()
}

export function parseCommand(argv: string[]): CliCommand {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    return { command: 'help', topic: 'root' }
  }

  if (argv[0] === 'help') {
    if (argv.length === 1) {
      return { command: 'help', topic: 'root' }
    }

    if (argv[1] === 'generate') {
      return { command: 'help', topic: 'generate' }
    }

    throw new Error(`Unknown command "${argv[1]}".`)
  }

  const [command, ...rest] = argv
  if (command !== 'generate') {
    throw new Error(`Unknown command "${command}".`)
  }

  let configPath: string | undefined
  let dryRun = false

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (token === '--help' || token === '-h') {
      return { command: 'help', topic: 'generate' }
    }

    if (token === '--dry-run') {
      dryRun = true
      continue
    }

    if (token === '--config') {
      const nextValue = rest[index + 1]
      if (!nextValue || nextValue.startsWith('-')) {
        throw new Error('Missing value for --config option.')
      }
      configPath = nextValue
      index += 1
      continue
    }

    throw new Error(`Unknown option "${token}".`)
  }

  return {
    command: 'generate',
    configPath,
    dryRun,
  }
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'Unknown generator error.'
}

function extractMissingDatabaseName(message: string): string | undefined {
  const match = message.match(/database "([^"]+)" does not exist/i)
  return match?.[1]
}

function isErrorWithCode(error: unknown): error is ErrorWithCode {
  return typeof error === 'object' && error !== null && 'code' in error
}

function formatGeneratorError(error: unknown, configPath?: string): Error {
  if (isErrorWithCode(error) && error.code === '3D000') {
    const message = normalizeErrorMessage(error)
    const databaseName = extractMissingDatabaseName(message)
    const databaseLabel = databaseName
      ? `PostgreSQL database "${databaseName}" does not exist`
      : 'The target PostgreSQL database does not exist'
    const configLabel = configPath
      ? `config "${configPath}"`
      : 'the resolved athena config'

    return new Error(
      [
        `${databaseLabel} (code 3D000).`,
        `Update provider.connectionString (and provider.database, if set) in ${configLabel}, or create that database before running generate.`,
      ].join('\n'),
    )
  }

  if (error instanceof Error) {
    return error
  }

  return new Error(normalizeErrorMessage(error))
}

function formatSkippedArtifactLine(
  artifact: Awaited<ReturnType<typeof runSchemaGenerator>>['skippedFiles'][number],
): string {
  if (artifact.reason === 'protected-existing-file') {
    return ` [skip] ${artifact.path} (existing ${artifact.kind} artifacts are protected from overwrite; delete or retarget the file to regenerate it)`
  }

  return ` [skip] ${artifact.path}`
}

/**
 * CLI entrypoint used by `bin/athena-js.js`.
 */
export async function runCLI(argv: string[], runtime: CliRuntime = {}): Promise<void> {
  const log = runtime.log ?? console.log
  const runGenerator = runtime.runGenerator ?? runSchemaGenerator
  const parsed = parseCommand(argv)
  if (parsed.command === 'help') {
    log(usage(parsed.topic))
    return
  }

  let result: Awaited<ReturnType<typeof runSchemaGenerator>>
  try {
    result = await runGenerator({
      configPath: parsed.configPath,
      dryRun: parsed.dryRun,
    })
  } catch (error) {
    throw formatGeneratorError(error, parsed.configPath)
  }

  if (parsed.dryRun) {
    log(`[dry-run] Generated ${result.files.length} files from ${result.configPath}`)
    for (const line of formatGeneratorModeLines(result)) {
      log(line)
    }
    for (const file of result.files) {
      log(` - ${file.path}`)
    }
    return
  }

  log(`Generated ${result.writtenFiles.length} files from ${result.configPath}`)
  for (const line of formatGeneratorModeLines(result)) {
    log(line)
  }
  for (const filePath of result.writtenFiles) {
    log(` - ${filePath}`)
  }
  for (const artifact of result.skippedFiles) {
    log(formatSkippedArtifactLine(artifact))
  }
}
