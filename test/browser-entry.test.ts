import { strict as assert } from 'assert'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import * as browserEntry from '../src/browser.ts'

const NODE_ONLY_ERROR_FRAGMENT = 'is not available in browser bundles'

test('browser entry keeps core client exports available', () => {
  assert.equal(typeof browserEntry.createClient, 'function')
  assert.equal(typeof browserEntry.AthenaClient, 'function')
  assert.equal(typeof browserEntry.normalizeAthenaError, 'function')
  assert.equal(typeof browserEntry.defineModel, 'function')
  assert.equal(typeof browserEntry.createTypedClient, 'function')
})

test('browser entry keeps generator config identity helper', () => {
  assert.equal(typeof browserEntry.generatorEnv, 'function')
  assert.equal(typeof browserEntry.athenaAuth, 'function')
  assert.equal(typeof browserEntry.ATHENA_AUTH_BASE_ERROR_CODES, 'object')

  const config = browserEntry.defineGeneratorConfig({
    provider: {
      kind: 'postgres',
      mode: 'gateway',
      gatewayUrl: 'https://example.com',
      apiKey: 'test-key',
      database: 'postgres',
    },
    output: {
      model: 'athena/models/{schema_kebab}/{model_kebab}.ts',
      schema: 'athena/schemas/{schema_kebab}.ts',
      database: 'athena/relations.ts',
      registry: 'athena/config.ts',
    },
  })

  assert.equal(config.provider.kind, 'postgres')
  assert.equal(config.output.database, 'athena/relations.ts')
})

test('browser entry node-only exports throw explicit errors', async () => {
  assert.throws(
    () =>
      browserEntry.createPostgresIntrospectionProvider({
        connectionString: 'postgres://localhost/db',
      }),
    new RegExp(NODE_ONLY_ERROR_FRAGMENT),
  )

  await assert.rejects(
    () => browserEntry.loadGeneratorConfig(),
    new RegExp(NODE_ONLY_ERROR_FRAGMENT),
  )

  await assert.rejects(
    () => browserEntry.runSchemaGenerator(),
    new RegExp(NODE_ONLY_ERROR_FRAGMENT),
  )
})

test('package root export maps browser condition to browser bundle', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    exports: {
      '.': {
        browser?: {
          import?: {
            types?: string
            default?: string
          }
          require?: {
            types?: string
            default?: string
          }
        }
      }
    }
  }

  assert.equal(pkg.exports['.'].browser?.import?.default, './dist/browser.js')
  assert.equal(pkg.exports['.'].browser?.import?.types, './dist/browser.d.ts')
  assert.equal(pkg.exports['.'].browser?.require?.default, './dist/browser.cjs')
  assert.equal(pkg.exports['.'].browser?.require?.types, './dist/browser.d.cts')
})
