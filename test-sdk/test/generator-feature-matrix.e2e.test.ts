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
  ensureWorkspace,
  loadResolvedExampleConfig,
  renderArtifactsFromExampleSnapshot,
  runDirectProviderInspect,
  runGatewayProviderInspect,
  runGeneratorDryRunWithSnapshot,
  runGeneratorWriteWithSnapshot,
  writeGeneratorConfigFile,
  type ExampleWorkspace,
} from '../examples/generator/full-utilization.ts'

type QueryResultRow = Record<string, unknown>

type GatewayCall = {
  url: string
  method: string
  query: string
  headers: Record<string, string>
}

type GatewayMockOptions = {
  failOnPattern?: string
  failureMessage?: string
  failureStatus?: number
}

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

    throw new Error(`Unexpected SQL in direct provider matrix test: ${sqlText.slice(0, 80)}...`)
  }
}

function withMockedPoolQuery(mockImpl: (sql: string) => Promise<{ rows: QueryResultRow[] }>) {
  const originalQuery = Pool.prototype.query
  const originalEnd = Pool.prototype.end

  ;(Pool.prototype.query as unknown as (sql: string) => Promise<{ rows: QueryResultRow[] }>) = mockImpl
  ;(Pool.prototype.end as unknown as () => Promise<void>) = async () => undefined

  return {
    restore() {
      Pool.prototype.query = originalQuery
      Pool.prototype.end = originalEnd
    },
  }
}

function normalizeHeaders(headers: RequestInit['headers']): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) {
    const out: Record<string, string> = {}
    headers.forEach((value, key) => {
      out[key] = value
    })
    return out
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers)
  }
  return headers as Record<string, string>
}

function createGatewayFetchMock(options: GatewayMockOptions = {}) {
  const calls: GatewayCall[] = []
  const original = globalThis.fetch

  globalThis.fetch = async (url, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as { query: string }
    calls.push({
      url: String(url),
      method: String(init?.method ?? 'GET'),
      query: payload.query,
      headers: normalizeHeaders(init?.headers),
    })

    if (options.failOnPattern && payload.query.includes(options.failOnPattern)) {
      return new Response(
        JSON.stringify({ error: options.failureMessage ?? 'Gateway query failed' }),
        { status: options.failureStatus ?? 500 },
      )
    }

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

test('generator matrix: direct config builder uses postgres direct mode', () => {
  const config = createDirectGeneratorConfig('postgres://postgres:postgres@127.0.0.1:5432/app_db')
  assert.equal(config.provider.kind, 'postgres')
  assert.equal(config.provider.mode, 'direct')
  assert.equal(config.provider.schemas?.includes('public'), true)
})

test('generator matrix: gateway config builder uses postgres gateway mode', () => {
  const config = createGatewayOnlyGeneratorConfig('https://athena-db.com', 'secret')
  assert.equal(config.provider.kind, 'postgres')
  assert.equal(config.provider.mode, 'gateway')
  assert.equal(config.provider.backend, 'postgresql')
})

test('generator matrix: full snapshot includes multi-schema and reserved identifiers', () => {
  const snapshot = createFullFeatureSnapshot()
  assert.equal(snapshot.schemas.public.tables.users.columns.table.name, 'table')
  assert.equal(snapshot.schemas.public.tables.profiles.columns.mood.typeKind, 'enum')
  assert.equal(Boolean(snapshot.schemas.athena.tables.users), true)
})

test('generator matrix: writeGeneratorConfigFile writes athena.config.ts at workspace root', async () => {
  const workspace = createWorkspace('athena-generator-matrix-write-config-')
  try {
    const config = createDirectGeneratorConfig('postgres://postgres:postgres@127.0.0.1:5432/app_db')
    const configPath = await writeGeneratorConfigFile(workspace, config)
    const fileText = readFileSync(configPath, 'utf8')
    assert.equal(fileText.includes('provider'), true)
    assert.equal(fileText.includes('connectionString'), true)
  } finally {
    rmSync(workspace.cwd, { recursive: true, force: true })
  }
})

test('generator matrix: ensureWorkspace is idempotent and does not throw', async () => {
  const workspace = createWorkspace('athena-generator-matrix-ensure-workspace-')
  try {
    await ensureWorkspace(workspace)
    await ensureWorkspace(workspace)
    assert.equal(true, true)
  } finally {
    rmSync(workspace.cwd, { recursive: true, force: true })
  }
})

test('generator matrix: loadResolvedExampleConfig throws when config file is missing', async () => {
  const workspace = createWorkspace('athena-generator-matrix-missing-config-')
  try {
    await assert.rejects(async () => loadResolvedExampleConfig(workspace), /was not found/)
  } finally {
    rmSync(workspace.cwd, { recursive: true, force: true })
  }
})

test('generator matrix: renderArtifactsFromExampleSnapshot emits expected artifact count', () => {
  const snapshot = createFullFeatureSnapshot()
  const config = createDirectGeneratorConfig('postgres://postgres:postgres@127.0.0.1:5432/app_db')
  const artifacts = renderArtifactsFromExampleSnapshot(config, snapshot)
  assert.equal(artifacts.files.length, 7)
})

test('generator matrix: renderArtifactsFromExampleSnapshot includes expected model path', () => {
  const snapshot = createFullFeatureSnapshot()
  const config = createDirectGeneratorConfig('postgres://postgres:postgres@127.0.0.1:5432/app_db')
  const artifacts = renderArtifactsFromExampleSnapshot(config, snapshot)
  assert.equal(artifacts.files.some(file => file.path === 'src/generated/app-db/public/users.model.ts'), true)
})

test('generator matrix: rendered model content keeps reserved column keys', () => {
  const snapshot = createFullFeatureSnapshot()
  const config = createDirectGeneratorConfig('postgres://postgres:postgres@127.0.0.1:5432/app_db')
  const artifacts = renderArtifactsFromExampleSnapshot(config, snapshot)
  const modelFile = artifacts.files.find(file => file.path === 'src/generated/app-db/public/users.model.ts')
  assert(modelFile)
  assert.equal(modelFile.content.includes('table: string'), true)
})

test('generator matrix: emitRegistry=false removes registry artifact', () => {
  const snapshot = createFullFeatureSnapshot()
  const config = createDirectGeneratorConfig('postgres://postgres:postgres@127.0.0.1:5432/app_db')
  config.features = {
    emitRelations: true,
    emitRegistry: false,
  }
  const artifacts = renderArtifactsFromExampleSnapshot(config, snapshot)
  assert.equal(artifacts.files.some(file => file.kind === 'registry'), false)
})

test('generator matrix: emitRelations=false removes relations metadata blocks', () => {
  const snapshot = createFullFeatureSnapshot()
  const config = createDirectGeneratorConfig('postgres://postgres:postgres@127.0.0.1:5432/app_db')
  config.features = {
    emitRelations: false,
    emitRegistry: true,
  }
  const artifacts = renderArtifactsFromExampleSnapshot(config, snapshot)
  const modelFile = artifacts.files.find(file => file.path === 'src/generated/app-db/public/users.model.ts')
  assert(modelFile)
  assert.equal(modelFile.content.includes('relations:'), false)
})

test('generator matrix: custom placeholder namespace path mapping is supported', () => {
  const snapshot = createFullFeatureSnapshot()
  const config = createDirectGeneratorConfig('postgres://postgres:postgres@127.0.0.1:5432/app_db')
  config.output.targets.model = 'src/generated/{namespace}/{model_kebab}.model.ts'
  config.output.placeholderMap.namespace = '{database_kebab}/{schema_kebab}'
  const artifacts = renderArtifactsFromExampleSnapshot(config, snapshot)
  assert.equal(artifacts.files.some(file => file.path === 'src/generated/app-db/public/users.model.ts'), true)
})

test('generator matrix: unknown placeholder tokens raise explicit errors', () => {
  const snapshot = createFullFeatureSnapshot()
  const config = createDirectGeneratorConfig('postgres://postgres:postgres@127.0.0.1:5432/app_db')
  config.output.targets.model = 'src/generated/{missing_token}/{model_kebab}.model.ts'
  assert.throws(() => renderArtifactsFromExampleSnapshot(config, snapshot), /Unknown placeholder token/)
})

test('generator matrix: output path collisions are rejected', () => {
  const snapshot = createFullFeatureSnapshot()
  const config = createDirectGeneratorConfig('postgres://postgres:postgres@127.0.0.1:5432/app_db')
  config.output.targets.model = 'src/generated/shared/model.ts'
  config.output.targets.schema = 'src/generated/shared/schema.ts'
  config.output.targets.database = 'src/generated/shared/db.ts'
  config.output.targets.registry = 'src/generated/shared/model.ts'
  assert.throws(() => renderArtifactsFromExampleSnapshot(config, snapshot), /collision/i)
})

test('generator matrix: collectTypeMappingShowcase includes expected mapped primitives', () => {
  const showcase = collectTypeMappingShowcase()
  assert.equal(showcase.length >= 4, true)
  assert.equal(showcase.some(entry => entry.mappedType === 'string'), true)
})

test('generator matrix: collectTypeMappingShowcase maps enum unions', () => {
  const showcase = collectTypeMappingShowcase()
  const enumCase = showcase.find(entry => entry.source.typeKind === 'enum')
  assert.equal(enumCase?.mappedType, "'happy' | 'sad'")
})

test('generator matrix: collectTypeMappingShowcase maps array dimensions', () => {
  const showcase = collectTypeMappingShowcase()
  const arrayCase = showcase.find(entry => entry.source.arrayDimensions === 1)
  assert.equal(arrayCase?.mappedType, 'Array<string>')
})

test('generator matrix: runGeneratorDryRunWithSnapshot does not write files', async () => {
  const workspace = createWorkspace('athena-generator-matrix-dry-run-')
  try {
    const snapshot = createFullFeatureSnapshot()
    const config = createDirectGeneratorConfig('postgres://postgres:postgres@127.0.0.1:5432/app_db')
    const result = await runGeneratorDryRunWithSnapshot(workspace, config, snapshot)
    assert.equal(result.files.length > 0, true)
    assert.equal(result.writtenFiles.length, 0)
  } finally {
    rmSync(workspace.cwd, { recursive: true, force: true })
  }
})

test('generator matrix: runGeneratorWriteWithSnapshot writes registry and model files', async () => {
  const workspace = createWorkspace('athena-generator-matrix-write-run-')
  try {
    const snapshot = createFullFeatureSnapshot()
    const config = createDirectGeneratorConfig('postgres://postgres:postgres@127.0.0.1:5432/app_db')
    const result = await runGeneratorWriteWithSnapshot(workspace, config, snapshot)
    assert.equal(result.writtenFiles.length, 7)
    const registryFile = join(workspace.cwd, 'src', 'generated', 'index.ts')
    const registryText = readFileSync(registryFile, 'utf8')
    assert.equal(registryText.includes('defineRegistry'), true)
  } finally {
    rmSync(workspace.cwd, { recursive: true, force: true })
  }
})

test('generator matrix: direct provider inspect works from pg_url with mocked pg catalog', async () => {
  const mock = withMockedPoolQuery(createMinimalPgCatalogMock())
  try {
    const snapshot = await runDirectProviderInspect('postgres://postgres:postgres@127.0.0.1:5432/app_db')
    assert.equal(snapshot.backend, 'postgresql')
    assert.deepEqual(snapshot.schemas.public.tables.users.primaryKey, ['id'])
  } finally {
    mock.restore()
  }
})

test('generator matrix: gateway provider inspect executes catalog queries over /gateway/query', async () => {
  const gatewayMock = createGatewayFetchMock()
  try {
    const snapshot = await runGatewayProviderInspect('https://athena-db.com', 'secret')
    assert.equal(snapshot.backend, 'postgresql')
    assert.equal(gatewayMock.calls.length, 4)
    assert.equal(gatewayMock.calls.every(call => call.url.endsWith('/gateway/query')), true)
    assert.equal(gatewayMock.calls.every(call => call.method === 'POST'), true)
  } finally {
    gatewayMock.restore()
  }
})

test('generator matrix: gateway provider queries include schema array literal filters', async () => {
  const gatewayMock = createGatewayFetchMock()
  try {
    await runGatewayProviderInspect('https://athena-db.com', 'secret')
    assert.equal(gatewayMock.calls.some(call => call.query.includes("ARRAY['public', 'athena']::text[]")), true)
  } finally {
    gatewayMock.restore()
  }
})

test('generator matrix: gateway provider sends backend routing header for postgresql', async () => {
  const gatewayMock = createGatewayFetchMock()
  try {
    await runGatewayProviderInspect('https://athena-db.com', 'secret')
    assert.equal(gatewayMock.calls.some(call => call.headers['X-Backend-Type'] === 'postgresql'), true)
  } finally {
    gatewayMock.restore()
  }
})

test('generator matrix: gateway provider bubbles query failures', async () => {
  const gatewayMock = createGatewayFetchMock({
    failOnPattern: "WHERE con.contype = 'p'",
    failureMessage: 'Primary key query failed',
    failureStatus: 500,
  })
  try {
    await assert.rejects(
      async () => runGatewayProviderInspect('https://athena-db.com', 'secret'),
      /Primary key query failed/,
    )
  } finally {
    gatewayMock.restore()
  }
})
