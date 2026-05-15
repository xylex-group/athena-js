import { strict as assert } from 'assert'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { test } from 'node:test'
import { Pool } from 'pg'
import {
  collectTypeMappingShowcase,
  createDirectGeneratorConfig,
  createFullFeatureSnapshot,
  createGatewayOnlyGeneratorConfig,
  loadResolvedExampleConfig,
  renderArtifactsFromExampleSnapshot,
  runDirectProviderInspect,
  runGatewayProviderInspect,
  runGeneratorDryRunWithSnapshot,
  runGeneratorWriteWithSnapshot,
  type ExampleWorkspace,
} from '../examples/generator/full-utilization.ts'

type QueryResultRow = Record<string, unknown>

function createWorkspace(prefix: string): ExampleWorkspace {
  const cwd = mkdtempSync(join(tmpdir(), prefix))
  return { cwd }
}

function createMinimalPgCatalogMock() {
  return async (sqlText: string) => {
    if (sqlText.includes('FROM pg_attribute')) {
      const rows: QueryResultRow[] = [
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
      ]
      return { rows }
    }

    if (sqlText.includes('FROM pg_type t') && sqlText.includes('JOIN pg_enum')) {
      return { rows: [] }
    }

    if (sqlText.includes("WHERE con.contype = 'p'")) {
      return {
        rows: [{ schema_name: 'public', table_name: 'users', columns: ['id'] }],
      }
    }

    if (sqlText.includes("WHERE con.contype = 'f'")) {
      return { rows: [] }
    }

    throw new Error(`Unexpected SQL in direct provider example test: ${sqlText.slice(0, 80)}...`)
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

test('generator full-utilization example: dry-run and write mode cover placeholders, naming, and metadata', async () => {
  const workspace = createWorkspace('athena-generator-full-example-')
  const snapshot = createFullFeatureSnapshot()
  const config = createDirectGeneratorConfig('postgres://postgres:postgres@127.0.0.1:5432/app_db')

  try {
    const dryRun = await runGeneratorDryRunWithSnapshot(workspace, config, snapshot)
    assert.equal(dryRun.files.length > 0, true)
    assert.equal(dryRun.writtenFiles.length, 0)

    const writeRun = await runGeneratorWriteWithSnapshot(workspace, config, snapshot)
    assert.equal(writeRun.writtenFiles.length, writeRun.files.length)

    const modelFilePath = join(workspace.cwd, 'src', 'generated', 'app-db', 'public', 'users.model.ts')
    const modelFile = readFileSync(modelFilePath, 'utf8')
    assert.equal(modelFile.includes("table: string"), true)
    assert.equal(modelFile.includes('relations:'), true)

    const analyticsModelPath = join(workspace.cwd, 'src', 'generated', 'app-db', 'analytics', 'users.model.ts')
    const analyticsModel = readFileSync(analyticsModelPath, 'utf8')
    assert.equal(analyticsModel.includes('metrics?: Record<string, unknown> | null'), true)
  } finally {
    rmSync(workspace.cwd, { recursive: true, force: true })
  }
})

test('generator full-utilization example: config discovery + loading resolves athena.config.ts', async () => {
  const workspace = createWorkspace('athena-generator-config-example-')
  const snapshot = createFullFeatureSnapshot()
  const config = createDirectGeneratorConfig('postgres://postgres:postgres@127.0.0.1:5432/app_db')

  try {
    await runGeneratorDryRunWithSnapshot(workspace, config, snapshot)
    const loaded = await loadResolvedExampleConfig(workspace)

    assert.equal(loaded.config.provider.kind, 'postgres')
    assert.equal(loaded.config.output.targets.registry, 'src/generated/index.ts')
    assert.deepEqual(loaded.config.features.emitRegistry, true)
  } finally {
    rmSync(workspace.cwd, { recursive: true, force: true })
  }
})

test('generator full-utilization example: programmatic rendering handles feature toggles', () => {
  const snapshot = createFullFeatureSnapshot()
  const config = createDirectGeneratorConfig('postgres://postgres:postgres@127.0.0.1:5432/app_db')
  config.features = {
    emitRelations: false,
    emitRegistry: false,
  }

  const artifacts = renderArtifactsFromExampleSnapshot(config, snapshot)
  assert.equal(artifacts.files.some(file => file.kind === 'registry'), false)

  const usersModel = artifacts.files.find(file =>
    file.path.endsWith('/public/users.model.ts') || file.path.endsWith('\\public\\users.model.ts'),
  )
  assert(usersModel)
  assert.equal(usersModel.content.includes('relations:'), false)
})

test('generator full-utilization example: type mapping showcase documents advanced postgres mapping', () => {
  const showcase = collectTypeMappingShowcase()

  const bigintCase = showcase.find(entry => entry.source.udtName === 'int8')
  const enumCase = showcase.find(entry => entry.source.typeKind === 'enum')
  const arrayCase = showcase.find(entry => entry.source.arrayDimensions === 1)

  assert.equal(bigintCase?.mappedType, 'string')
  assert.equal(enumCase?.mappedType, "'happy' | 'sad'")
  assert.equal(arrayCase?.mappedType, 'Array<string>')
})

test('generator full-utilization example: direct provider path works from pg_url', async () => {
  const originalQuery = Pool.prototype.query
  const originalEnd = Pool.prototype.end

  ;(Pool.prototype.query as unknown as (sql: string) => Promise<{ rows: QueryResultRow[] }>) =
    createMinimalPgCatalogMock()
  ;(Pool.prototype.end as unknown as () => Promise<void>) = async () => undefined

  try {
    const snapshot = await runDirectProviderInspect('postgres://postgres:postgres@127.0.0.1:5432/app_db')
    assert.equal(snapshot.backend, 'postgresql')
    assert.deepEqual(snapshot.schemas.public.tables.users.primaryKey, ['id'])
  } finally {
    Pool.prototype.query = originalQuery
    Pool.prototype.end = originalEnd
  }
})

test('generator full-utilization example: gateway-only provider path runs through /gateway/query', async () => {
  const { calls, restore } = createGatewayFetchMock()

  try {
    const gatewayConfig = createGatewayOnlyGeneratorConfig('https://athena-db.com', 'secret')
    const snapshot = await runGatewayProviderInspect(
      gatewayConfig.provider.gatewayUrl,
      gatewayConfig.provider.apiKey,
    )

    assert.equal(snapshot.backend, 'postgresql')
    assert.deepEqual(snapshot.schemas.public.tables.users.primaryKey, ['id'])
    assert.equal(calls.length, 4)
    assert.equal(calls.every(call => call.url.endsWith('/gateway/query')), true)
    assert.equal(calls.some(call => call.query.includes("ARRAY['public']::text[]")), true)
  } finally {
    restore()
  }
})
