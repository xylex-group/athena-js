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

test('identifier helper returns a safely quoted SQL identifier', () => {
  const sql = identifier('analytics', 'Order Items').toSql()
  assert.equal(sql, '"analytics"."Order Items"')
})

