import { strict as assert } from 'assert'
import { test } from 'node:test'
import { Pool } from 'pg'
import { resolveGeneratorProvider } from '../src/generator/index.ts'

type QueryResultRow = Record<string, unknown>

type GatewayCall = {
  url: string
  method: string
  body: { query: string }
}

type GatewayFetchMockOptions = {
  foreignKeysAsStringLiterals?: boolean
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
        rows: [
          {
            schema_name: 'public',
            table_name: 'users',
            columns: ['id'],
          },
        ],
      }
    }

    if (sqlText.includes("WHERE con.contype = 'f'")) {
      return { rows: [] }
    }

    throw new Error(`Unexpected SQL in pg_url provider test: ${sqlText.slice(0, 80)}...`)
  }
}

function createGatewayFetchMock(options: GatewayFetchMockOptions = {}) {
  const calls: GatewayCall[] = []
  const original = globalThis.fetch

  globalThis.fetch = async (url, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as { query: string }
    calls.push({
      url: String(url),
      method: String(init?.method ?? 'GET'),
      body: payload,
    })

    const sqlText = payload.query
    if (sqlText.includes('FROM pg_attribute')) {
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

    if (sqlText.includes('FROM pg_type t') && sqlText.includes('JOIN pg_enum')) {
      return new Response(
        JSON.stringify({
          data: [],
          error: null,
          status: 200,
        }),
        { status: 200 },
      )
    }

    if (sqlText.includes("WHERE con.contype = 'p'")) {
      return new Response(
        JSON.stringify({
          data: [{ schema_name: 'public', table_name: 'users', columns: ['id'] }],
          error: null,
          status: 200,
        }),
        { status: 200 },
      )
    }

    if (sqlText.includes("WHERE con.contype = 'f'")) {
      const foreignKeyRows = options.foreignKeysAsStringLiterals
        ? [
            {
              source_schema: 'public',
              source_table: 'profiles',
              constraint_name: 'profile_user_fk',
              source_columns: '{user_id}',
              target_schema: 'public',
              target_table: 'users',
              target_columns: '{id}',
              source_is_unique: true,
            },
          ]
        : []

      return new Response(
        JSON.stringify({
          data: foreignKeyRows,
          error: null,
          status: 200,
        }),
        { status: 200 },
      )
    }

    return new Response(
      JSON.stringify({
        error: `Unexpected SQL in gateway provider test: ${sqlText.slice(0, 80)}...`,
      }),
      { status: 400 },
    )
  }

  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

test('resolveGeneratorProvider supports direct postgres provider from pg_url connection strings', async () => {
  const originalQuery = Pool.prototype.query
  const originalEnd = Pool.prototype.end
  ;(Pool.prototype.query as unknown as (sql: string) => Promise<{ rows: QueryResultRow[] }>) =
    createMinimalPgCatalogMock()
  ;(Pool.prototype.end as unknown as () => Promise<void>) = async () => undefined

  try {
    const provider = resolveGeneratorProvider(
      {
        kind: 'postgres',
        mode: 'direct',
        connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/app_db',
        database: 'app_db',
      },
      {
        postgresGatewayIntrospection: false,
        scyllaProviderContracts: true,
      },
    )

    const snapshot = await provider.inspect({ schemas: ['public'] })
    assert.equal(snapshot.backend, 'postgresql')
    assert.equal(snapshot.database, 'app_db')
    assert.deepEqual(snapshot.schemas.public.tables.users.primaryKey, ['id'])
  } finally {
    Pool.prototype.query = originalQuery
    Pool.prototype.end = originalEnd
  }
})

test('resolveGeneratorProvider supports gateway-only postgres introspection over /gateway/query', async () => {
  const { calls, restore } = createGatewayFetchMock()

  try {
    const provider = resolveGeneratorProvider(
      {
        kind: 'postgres',
        mode: 'gateway',
        gatewayUrl: 'https://athena-db.com',
        apiKey: 'secret',
        database: 'app_db',
      },
      {
        postgresGatewayIntrospection: true,
        scyllaProviderContracts: true,
      },
    )

    const snapshot = await provider.inspect({ schemas: ['public'] })

    assert.equal(snapshot.backend, 'postgresql')
    assert.equal(snapshot.database, 'app_db')
    assert.deepEqual(snapshot.schemas.public.tables.users.primaryKey, ['id'])
    assert.equal(calls.length, 4)
    assert.equal(calls.every(call => call.url.endsWith('/gateway/query')), true)
    assert.equal(calls.every(call => call.method === 'POST'), true)
    assert.equal(calls.some(call => call.body.query.includes('pg_attribute')), true)
    assert.equal(calls.some(call => call.body.query.includes("ARRAY['public']::text[]")), true)
  } finally {
    restore()
  }
})

test('resolveGeneratorProvider gateway mode normalizes string-literal foreign key arrays', async () => {
  const { restore } = createGatewayFetchMock({ foreignKeysAsStringLiterals: true })

  try {
    const provider = resolveGeneratorProvider(
      {
        kind: 'postgres',
        mode: 'gateway',
        gatewayUrl: 'https://athena-db.com',
        apiKey: 'secret',
        database: 'app_db',
      },
      {
        postgresGatewayIntrospection: true,
        scyllaProviderContracts: true,
      },
    )

    const snapshot = await provider.inspect({ schemas: ['public'] })
    const profilesRelation = Object.values(snapshot.schemas.public.tables.profiles.relations).find(
      relation => relation.targetModel === 'users',
    )
    const usersRelation = Object.values(snapshot.schemas.public.tables.users.relations).find(
      relation => relation.targetModel === 'profiles',
    )

    assert.ok(profilesRelation)
    assert.ok(usersRelation)

    assert.deepEqual(profilesRelation.sourceColumns, ['user_id'])
    assert.deepEqual(profilesRelation.targetColumns, ['id'])
    assert.deepEqual(usersRelation.sourceColumns, ['id'])
    assert.deepEqual(usersRelation.targetColumns, ['user_id'])
  } finally {
    restore()
  }
})

test('resolveGeneratorProvider gateway mode works without experimental postgres flag', async () => {
  const { restore } = createGatewayFetchMock()

  try {
    const provider = resolveGeneratorProvider(
      {
        kind: 'postgres',
        mode: 'gateway',
        gatewayUrl: 'https://athena-db.com',
        apiKey: 'secret',
        database: 'app_db',
      },
      {
        postgresGatewayIntrospection: false,
        scyllaProviderContracts: true,
      },
    )

    const snapshot = await provider.inspect({ schemas: ['public'] })
    assert.equal(snapshot.backend, 'postgresql')
    assert.equal(snapshot.database, 'app_db')
  } finally {
    restore()
  }
})
