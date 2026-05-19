import { strict as assert } from 'assert'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { test } from 'node:test'
import type { IntrospectionInspectOptions, SchemaIntrospectionProvider } from '../src/schema/index.ts'
import { runSchemaGenerator } from '../src/generator/index.ts'

function createSnapshotProvider(): SchemaIntrospectionProvider {
  return {
    backend: 'postgresql',
    async inspect() {
      return {
        backend: 'postgresql',
        database: 'phase_two',
        generatedAt: new Date('2026-05-15T00:00:00.000Z').toISOString(),
        schemas: {
          public: {
            name: 'public',
            tables: {
              users: {
                schema: 'public',
                name: 'users',
                primaryKey: ['id'],
                relations: {},
                columns: {
                  id: {
                    name: 'id',
                    dataType: 'uuid',
                    udtName: 'uuid',
                    typeKind: 'scalar',
                    isNullable: false,
                    isPrimaryKey: true,
                    hasDefault: false,
                    isGenerated: false,
                    arrayDimensions: 0,
                  },
                  email: {
                    name: 'email',
                    dataType: 'text',
                    udtName: 'text',
                    typeKind: 'scalar',
                    isNullable: false,
                    isPrimaryKey: false,
                    hasDefault: false,
                    isGenerated: false,
                    arrayDimensions: 0,
                  },
                },
              },
            },
          },
        },
      }
    },
  }
}

function createGatewayFetchMock() {
  const calls: Array<{ url: string; method: string; query: string }> = []
  const original = globalThis.fetch

  globalThis.fetch = async (url, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as { query: string }
    calls.push({
      url: String(url),
      method: String(init?.method ?? 'GET'),
      query: payload.query,
    })

    if (payload.query.includes('FROM pg_attribute')) {
      return new Response(
        JSON.stringify({
          data: [
            {
              schema_name: 'public',
              table_name: 'users',
              column_name: 'id',
              data_type: 'uuid',
              udt_name: 'uuid',
              type_kind_code: 'b',
              type_oid: 1,
              is_nullable: false,
              has_default: false,
              is_generated: false,
              array_dimensions: 0,
            },
            {
              schema_name: 'public',
              table_name: 'users',
              column_name: 'email',
              data_type: 'text',
              udt_name: 'text',
              type_kind_code: 'b',
              type_oid: 2,
              is_nullable: false,
              has_default: false,
              is_generated: false,
              array_dimensions: 0,
            },
          ],
          error: null,
          status: 200,
        }),
        { status: 200 },
      )
    }

    if (payload.query.includes('FROM pg_type t') && payload.query.includes('JOIN pg_enum')) {
      return new Response(JSON.stringify({ data: [], error: null, status: 200 }), { status: 200 })
    }

    if (payload.query.includes("WHERE con.contype = 'p'")) {
      return new Response(
        JSON.stringify({
          data: [{ schema_name: 'public', table_name: 'users', columns: ['id'] }],
          error: null,
          status: 200,
        }),
        { status: 200 },
      )
    }

    if (payload.query.includes("WHERE con.contype = 'f'")) {
      return new Response(JSON.stringify({ data: [], error: null, status: 200 }), { status: 200 })
    }

    return new Response(JSON.stringify({ error: 'Unexpected SQL' }), { status: 400 })
  }

  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

test('runSchemaGenerator loads athena.config.ts and writes generated artifacts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-generator-run-'))
  try {
    writeFileSync(
      join(root, 'athena.config.ts'),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/phase_two',
          database: 'phase_two',
          schemas: ['public'],
        },
        output: {
          targets: {
            model: 'src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts',
            schema: 'src/generated/{database_kebab}/{schema_kebab}/index.ts',
            database: 'src/generated/{database_kebab}/index.ts',
            registry: 'src/generated/index.ts',
          },
        },
      }
      `,
      'utf8',
    )

    const result = await runSchemaGenerator({
      cwd: root,
      provider: createSnapshotProvider(),
    })

    assert.equal(result.files.length, 4)
    assert.equal(result.writtenFiles.length, 4)

    const modelPath = join(root, 'src', 'generated', 'phase-two', 'public', 'users.model.ts')
    const content = readFileSync(modelPath, 'utf8')
    assert.equal(content.includes('export interface PublicUsersRow'), true)
    assert.equal(content.includes('email: string'), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('runSchemaGenerator passes normalized multi-schema selection to custom providers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-generator-schema-selection-'))
  const inspectedOptions: IntrospectionInspectOptions[] = []
  const provider = createSnapshotProvider()
  const recordingProvider: SchemaIntrospectionProvider = {
    backend: provider.backend,
    inspect(options) {
      inspectedOptions.push(options ?? {})
      return provider.inspect(options)
    },
  }

  try {
    writeFileSync(
      join(root, 'athena.config.ts'),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'direct',
          connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/phase_two',
          database: 'phase_two',
          schemas: ' public, athena, public ',
        },
        output: {
          targets: {
            model: 'src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts',
            schema: 'src/generated/{database_kebab}/{schema_kebab}/index.ts',
            database: 'src/generated/{database_kebab}/index.ts',
            registry: 'src/generated/index.ts',
          },
        },
      }
      `,
      'utf8',
    )

    await runSchemaGenerator({
      cwd: root,
      dryRun: true,
      provider: recordingProvider,
    })

    assert.deepEqual(inspectedOptions[0]?.schemas, ['public', 'athena'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('runSchemaGenerator can operate in gateway-only mode without direct pg_url access', async () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-generator-gateway-run-'))
  const { calls, restore } = createGatewayFetchMock()

  try {
    writeFileSync(
      join(root, 'athena.config.ts'),
      `
      export default {
        provider: {
          kind: 'postgres',
          mode: 'gateway',
          gatewayUrl: 'https://athena-db.com',
          apiKey: 'secret',
          database: 'phase_two',
          schemas: ['public'],
        },
        experimental: {
          postgresGatewayIntrospection: true,
        },
        output: {
          targets: {
            model: 'src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts',
            schema: 'src/generated/{database_kebab}/{schema_kebab}/index.ts',
            database: 'src/generated/{database_kebab}/index.ts',
            registry: 'src/generated/index.ts',
          },
        },
      }
      `,
      'utf8',
    )

    const result = await runSchemaGenerator({ cwd: root })
    assert.equal(result.files.length, 4)
    assert.equal(result.writtenFiles.length, 4)
    assert.equal(calls.length, 4)
    assert.equal(calls.every(call => call.url.endsWith('/gateway/query')), true)
    assert.equal(calls.every(call => call.method === 'POST'), true)

    const modelPath = join(root, 'src', 'generated', 'phase-two', 'public', 'users.model.ts')
    const content = readFileSync(modelPath, 'utf8')
    assert.equal(content.includes('export interface PublicUsersRow'), true)
  } finally {
    restore()
    rmSync(root, { recursive: true, force: true })
  }
})
