import { strict as assert } from 'assert'
import { test } from 'node:test'
import { parseCommand, runCLI, usage, type CliRuntime } from '../src/cli/index.ts'

test('parseCommand supports generate subcommand help flag', () => {
  const parsed = parseCommand(['generate', '--help'])
  assert.deepEqual(parsed, { command: 'help', topic: 'generate' })
})

test('parseCommand supports help generate alias', () => {
  const parsed = parseCommand(['help', 'generate'])
  assert.deepEqual(parsed, { command: 'help', topic: 'generate' })
})

test('usage returns generate help text for topic generate', () => {
  const text = usage('generate')
  assert.equal(text.includes('athena-js generate'), true)
  assert.equal(text.includes('-h, --help'), true)
})

test('runCLI prints generate help output', async () => {
  const logs: string[] = []
  await runCLI(['generate', '--help'], {
    log: message => {
      logs.push(message)
    },
  })

  assert.equal(logs.length, 1)
  assert.equal(logs[0].includes('athena-js generate'), true)
  assert.equal(logs[0].includes('--config <path>'), true)
})

test('runCLI normalizes postgres missing database errors with actionable guidance', async () => {
  const failingGenerator = async () => {
    const error = new Error('database "app_db" does not exist') as Error & { code: string }
    error.code = '3D000'
    throw error
  }

  await assert.rejects(
    runCLI(['generate', '--config', './athena.config.ts', '--dry-run'], {
      runGenerator: failingGenerator as NonNullable<CliRuntime['runGenerator']>,
    }),
    (error: unknown) => {
      if (!(error instanceof Error)) {
        return false
      }
      assert.equal(error.message.includes('PostgreSQL database "app_db" does not exist'), true)
      assert.equal(error.message.includes('provider.connectionString'), true)
      return true
    },
  )
})
