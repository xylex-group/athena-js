import { strict as assert } from 'assert'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
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

test('runSchemaGenerator supports table-builder output format', async () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-generator-table-builder-run-'))
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
          format: 'table-builder',
          targets: {
            model: 'src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.ts',
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
      dryRun: true,
    })

    assert.equal(result.files.length, 4)
    const modelFile = result.files.find(file => file.kind === 'model')
    const registryFile = result.files.find(file => file.kind === 'registry')
    assert.ok(modelFile)
    assert.ok(registryFile)
    assert.equal(modelFile.path, 'src/generated/phase-two/public/users.ts')
    assert.equal(modelFile.content.includes("export const users = table('users')"), true)
    assert.equal(modelFile.content.includes(".schema('public')"), true)
    assert.equal(modelFile.content.includes("export const users_insert_schema = users.schemas.insert"), true)
    assert.equal(registryFile.content.includes('schemaVersion: 1'), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('runSchemaGenerator works without a config file when environment defaults are present', async () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-generator-env-only-run-'))
  const previousValues = new Map<string, string | undefined>([
    ['DATABASE_URL', process.env.DATABASE_URL],
    ['ATHENA_GENERATOR_OUTPUT_FORMAT', process.env.ATHENA_GENERATOR_OUTPUT_FORMAT],
  ])

  delete process.env.DATABASE_URL
  delete process.env.ATHENA_GENERATOR_OUTPUT_FORMAT

  try {
    writeFileSync(
      join(root, '.env.local'),
      [
        'DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/phase_two',
        'ATHENA_GENERATOR_OUTPUT_FORMAT=table-builder',
      ].join('\n'),
      'utf8',
    )

    const result = await runSchemaGenerator({
      cwd: root,
      provider: createSnapshotProvider(),
      dryRun: true,
    })

    assert.equal(result.configPath, '[environment defaults]')
    assert.equal(result.files.length, 4)
    const modelFile = result.files.find(file => file.kind === 'model')
    assert.ok(modelFile)
    assert.equal(modelFile.path, 'athena/models/public/users.ts')
    assert.equal(modelFile.content.includes("export const users = table('users')"), true)
    assert.equal(modelFile.content.includes(".schema('public')"), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
    for (const [key, value] of previousValues.entries()) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
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

test('runSchemaGenerator does not overwrite existing database/registry files but can overwrite model/schema files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'athena-generator-overwrite-guard-'))
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

    const modelPath = join(root, 'src', 'generated', 'phase-two', 'public', 'users.model.ts')
    const schemaPath = join(root, 'src', 'generated', 'phase-two', 'public', 'index.ts')
    const databasePath = join(root, 'src', 'generated', 'phase-two', 'index.ts')
    const registryPath = join(root, 'src', 'generated', 'index.ts')

    mkdirSync(join(root, 'src', 'generated', 'phase-two', 'public'), { recursive: true })
    mkdirSync(join(root, 'src', 'generated', 'phase-two'), { recursive: true })
    mkdirSync(join(root, 'src', 'generated'), { recursive: true })

    writeFileSync(modelPath, '// existing model that may be overwritten\n', 'utf8')
    writeFileSync(schemaPath, '// existing schema that may be overwritten\n', 'utf8')
    writeFileSync(databasePath, '// keep custom database content\n', 'utf8')
    writeFileSync(registryPath, '// keep custom registry content\n', 'utf8')

    const result = await runSchemaGenerator({
      cwd: root,
      provider: createSnapshotProvider(),
    })

    const modelContent = readFileSync(modelPath, 'utf8')
    const schemaContent = readFileSync(schemaPath, 'utf8')
    const databaseContent = readFileSync(databasePath, 'utf8')
    const registryContent = readFileSync(registryPath, 'utf8')

    assert.equal(modelContent.includes('export interface PublicUsersRow'), true)
    assert.equal(schemaContent.includes('defineSchema({'), true)
    assert.equal(databaseContent, '// keep custom database content\n')
    assert.equal(registryContent, '// keep custom registry content\n')

    assert.deepEqual(
      result.writtenFiles.sort(),
      [
        'src/generated/phase-two/public/index.ts',
        'src/generated/phase-two/public/users.model.ts',
      ],
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
