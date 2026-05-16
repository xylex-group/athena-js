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
    '  --dry-run        Build generated files in memory without writing them to disk',
    '  -h, --help       Show help for generate',
    '',
    'Examples:',
    '  athena-js generate',
    '  athena-js generate --config ./athena.config.ts --dry-run',
  ].join('\n')
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
    for (const file of result.files) {
      log(` - ${file.path}`)
    }
    return
  }

  log(`Generated ${result.writtenFiles.length} files from ${result.configPath}`)
  for (const filePath of result.writtenFiles) {
    log(` - ${filePath}`)
  }
}
