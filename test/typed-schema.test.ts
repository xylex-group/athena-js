import { strict as assert } from 'assert'
import { test } from 'node:test'
import {
  createTypedClient,
  defineDatabase,
  defineModel,
  defineRegistry,
  defineSchema,
  identifier,
} from '../src/index.ts'

type Capture = { url: string; init?: RequestInit }

function mockFetch() {
  const calls: Capture[] = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify({ data: [], status: 200 }), { status: 200 })
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

interface UserRow {
  id: string
  email: string
}

const registry = defineRegistry({
  app_db: defineDatabase({
    public: defineSchema({
      users: defineModel<UserRow, Pick<UserRow, 'id' | 'email'>, Partial<UserRow>>({
        meta: {
          database: 'app_db',
          schema: 'public',
          model: 'users',
          primaryKey: ['id'],
          nullable: { email: false, id: false },
          relations: {
            profile: {
              kind: 'one-to-one',
              sourceColumns: ['id'],
              targetSchema: 'public',
              targetModel: 'profiles',
              targetColumns: ['user_id'],
            },
          },
        },
      }),
      users_custom_table: defineModel<UserRow, Pick<UserRow, 'id' | 'email'>, Partial<UserRow>>({
        meta: {
          database: 'app_db',
          schema: 'public',
          model: 'users_custom_table',
          tableName: 'legacy.user_records',
          primaryKey: ['id'],
        },
      }),
    }),
  }),
})

test('typed client routes fromModel() to schema-qualified table names', async () => {
  const { calls, restore } = mockFetch()
  try {
    const client = createTypedClient(registry, 'https://athena-db.com', 'secret')
    await client.fromModel('app_db', 'public', 'users').eq('id', 'u1').select('*')
    assert.equal(calls.length, 1)
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.table_name, 'public.users')
  } finally {
    restore()
  }
})

test('typed client fromModel() supports findMany object selects', async () => {
  const { calls, restore } = mockFetch()
  try {
    const client = createTypedClient(registry, 'https://athena-db.com', 'secret')
    await client.fromModel('app_db', 'public', 'users').findMany({
      select: {
        id: true,
        profile: {
          select: {
            id: true,
          },
        },
      },
      where: {
        id: 'u1',
      },
      orderBy: {
        id: 'desc',
      },
      limit: 1,
    })

    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.table_name, 'public.users')
    assert.equal(payload.columns, 'id,profile(id)')
    assert.equal(payload.limit, 1)
    assert.deepEqual(payload.sort_by, {
      field: 'id',
      direction: 'descending',
    })
    assert.deepEqual(payload.conditions, [
      { operator: 'eq', column: 'id', value: 'u1', eq_column: 'id', eq_value: 'u1' },
    ])
  } finally {
    restore()
  }
})

test('typed client forwards mapped tenant context headers', async () => {
  const { calls, restore } = mockFetch()
  try {
    const client = createTypedClient(registry, 'https://athena-db.com', 'secret', {
      tenantKeyMap: {
        organizationId: 'X-Organization-Id',
        workspaceId: 'X-Workspace-Id',
      },
    })
    await client
      .withTenantContext({
        organizationId: 'org-1',
        workspaceId: 'workspace-1',
      })
      .fromModel('app_db', 'public', 'users')
      .select('*')
    const headers = calls[0].init?.headers as Record<string, string>
    assert.equal(headers['X-Organization-Id'], 'org-1')
    assert.equal(headers['X-Workspace-Id'], 'workspace-1')
  } finally {
    restore()
  }
})

test('typed client preserves existing tenant context and applies incremental context updates', async () => {
  const { calls, restore } = mockFetch()
  try {
    const client = createTypedClient(registry, 'https://athena-db.com', 'secret', {
      tenantKeyMap: {
        organizationId: 'X-Organization-Id',
        workspaceId: 'X-Workspace-Id',
      },
      tenantContext: {
        organizationId: 'org-default',
      },
    })
    await client
      .withTenantContext({
        workspaceId: 'workspace-2',
      })
      .fromModel('app_db', 'public', 'users')
      .select('*')

    const headers = calls[0].init?.headers as Record<string, string>
    assert.equal(headers['X-Organization-Id'], 'org-default')
    assert.equal(headers['X-Workspace-Id'], 'workspace-2')
  } finally {
    restore()
  }
})

test('typed client uses explicit tableName override when provided', async () => {
  const { calls, restore } = mockFetch()
  try {
    const client = createTypedClient(registry, 'https://athena-db.com', 'secret')
    await client.fromModel('app_db', 'public', 'users_custom_table').select('*')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.table_name, 'legacy.user_records')
  } finally {
    restore()
  }
})

test('typed client still supports regular from() calls', async () => {
  const { calls, restore } = mockFetch()
  try {
    const client = createTypedClient(registry, 'https://athena-db.com', 'secret')
    await client.from<UserRow>('public.users').eq('id', 'u2').select('*')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.table_name, 'public.users')
  } finally {
    restore()
  }
})

test('typed client throws precise errors for unknown database/schema/model', () => {
  const client = createTypedClient(registry, 'https://athena-db.com', 'secret')
  assert.throws(
    () => client.fromModel('missing_db' as 'app_db', 'public', 'users'),
    /Unknown database "missing_db"/,
  )
  assert.throws(
    () => client.fromModel('app_db', 'missing_schema' as 'public', 'users'),
    /Unknown schema "missing_schema" in database "app_db"/,
  )
  assert.throws(
    () => client.fromModel('app_db', 'public', 'missing_model' as 'users'),
    /Unknown model "missing_model" in schema "public"/,
  )
})

test('identifier helper returns a safely quoted SQL identifier', () => {
  const sql = identifier('analytics', 'Order Items').toSql()
  assert.equal(sql, '"analytics"."Order Items"')
})
