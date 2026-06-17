import { strict as assert } from 'assert'
import { test } from 'node:test'
import { createClient, AthenaClient } from '../src/client.ts'
import { normalizeAthenaError } from '../src/auxiliaries.ts'
import {
  AthenaStorageError,
  AthenaStorageErrorCode,
  createAthenaStorageError,
} from '../src/storage/module.ts'

function createMockResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

test('AthenaClient.builder() builds client with url and key', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify([{ id: 1 }]), { status: 200 })
  }

  try {
    const client = AthenaClient.builder()
      .backend({ type: 'athena' })
      .url('https://athena-db.com')
      .key('secret')
      .client('test_client')
      .build()

    const result = await client.from('users').select('id').limit(1)
    assert.equal(result.status, 200)
    assert.equal(calls.length, 1)
    const headers = calls[0].init?.headers as Record<string, string>
    assert.equal(headers['X-Athena-Client'], 'test_client')
    assert.equal(headers['X-Backend-Type'], 'athena')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('createClient(url, key, { client }) still works', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify([]), { status: 200 })
  }

  try {
    const client = createClient('https://athena-db.com', 'secret', {
      client: 'athena_logging',
    })
    await client.from('users').select()
    assert.equal(calls.length, 1)
    const headers = calls[0].init?.headers as Record<string, string>
    assert.equal(headers['X-Athena-Client'], 'athena_logging')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('createClient({ url, key }) routes db, auth, and storage through the unified public base URL', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const requestUrl = String(url)
    calls.push({ url: requestUrl, init })
    if (requestUrl.endsWith('/auth/get-session')) {
      return createMockResponse({
        session: { id: 's_1' },
        user: { id: 'u_1', email: 'user@example.com' },
      }, 200)
    }
    if (requestUrl.endsWith('/storage/catalogs')) {
      return createMockResponse({
        data: [
          {
            id: 's3_1',
            name: 'documents',
            bucket: 'documents',
            provider: 'aws',
            force_path_style: false,
            is_active: true,
            metadata: {},
            created_at: '2026-06-15T00:00:00Z',
            updated_at: '2026-06-15T00:00:00Z',
          },
        ],
      }, 200)
    }
    return createMockResponse([{ id: 1 }], 200)
  }

  try {
    const client = createClient({
      url: 'https://acme.v3.athena-db.com',
      key: 'secret',
      experimental: { athenaStorageBackend: true },
    })

    await client.from('users').select('id').limit(1)
    const session = await client.auth.getSession()
    const catalogs = await client.storage.listStorageCatalogs()

    assert.equal(session.ok, true)
    assert.equal(catalogs.data[0].id, 's3_1')
    assert.equal(calls.length, 3)
    assert.equal(calls[0].url, 'https://acme.v3.athena-db.com/db/gateway/fetch')
    assert.equal(calls[1].url, 'https://acme.v3.athena-db.com/auth/get-session')
    assert.equal(calls[2].url, 'https://acme.v3.athena-db.com/storage/catalogs')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('createClient({ key, db/auth/storage overrides }) honors explicit per-service URLs without a unified root', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const requestUrl = String(url)
    calls.push({ url: requestUrl, init })
    if (requestUrl.endsWith('/auth/v1/get-session')) {
      return createMockResponse({
        session: { id: 's_2' },
        user: { id: 'u_2', email: 'operator@example.com' },
      }, 200)
    }
    if (requestUrl.endsWith('/storage/v1/catalogs')) {
      return createMockResponse({ data: [] }, 200)
    }
    return createMockResponse([{ id: 2 }], 200)
  }

  try {
    const client = createClient({
      key: 'secret',
      db: {
        url: 'https://gateway.internal.local/rest/v1',
      },
      auth: {
        url: 'https://auth.internal.local/auth/v1',
      },
      storage: {
        url: 'https://storage.internal.local/storage/v1',
      },
      experimental: { athenaStorageBackend: true },
    })

    await client.from('users').select('id').limit(1)
    const session = await client.auth.getSession()
    await client.storage.listStorageCatalogs()

    assert.equal(session.ok, true)
    assert.equal(calls.length, 3)
    assert.equal(calls[0].url, 'https://gateway.internal.local/rest/v1/gateway/fetch')
    assert.equal(calls[1].url, 'https://auth.internal.local/auth/v1/get-session')
    assert.equal(calls[2].url, 'https://storage.internal.local/storage/v1/catalogs')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('createClient({ gatewayUrl, authUrl, storageUrl, key }) honors top-level legacy service aliases', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const requestUrl = String(url)
    calls.push({ url: requestUrl, init })
    if (requestUrl.endsWith('/auth/v1/get-session')) {
      return createMockResponse({
        session: { id: 's_3' },
        user: { id: 'u_3', email: 'legacy@example.com' },
      }, 200)
    }
    if (requestUrl.endsWith('/storage/v1/catalogs')) {
      return createMockResponse({ data: [] }, 200)
    }
    return createMockResponse([{ id: 3 }], 200)
  }

  try {
    const client = createClient({
      key: 'secret',
      gatewayUrl: 'https://gateway.athena-db.com',
      authUrl: 'https://auth.athena-db.com/auth/v1',
      storageUrl: 'https://storage.athena-db.com/storage/v1',
      experimental: { athenaStorageBackend: true },
    })

    await client.from('users').select('id').limit(1)
    const session = await client.auth.getSession()
    await client.storage.listStorageCatalogs()

    assert.equal(session.ok, true)
    assert.equal(calls.length, 3)
    assert.equal(calls[0].url, 'https://gateway.athena-db.com/gateway/fetch')
    assert.equal(calls[1].url, 'https://auth.athena-db.com/auth/v1/get-session')
    assert.equal(calls[2].url, 'https://storage.athena-db.com/storage/v1/catalogs')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('createClient throws early for malformed gateway URLs', () => {
  assert.throws(
    () => createClient('not-a-url', 'secret'),
    /valid absolute http\(s\) URL/,
  )
})

test('createClient throws early for missing API keys even when env-shaped inputs are passed through directly', () => {
  assert.throws(
    () => createClient('https://athena-db.com', undefined),
    /Athena API key is required/,
  )
  assert.throws(
    () => createClient({
      url: 'https://athena-db.com',
      key: undefined,
    }),
    /Athena API key is required/,
  )
  assert.throws(
    () => AthenaClient.builder().url('https://athena-db.com').key(undefined).build(),
    /AthenaClient requires key plus either \.url\(\) or a db\/gateway override before \.build\(\)/,
  )
})

test('client.verifyConnection probes the configured gateway root', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return createMockResponse({ ok: true }, 200)
  }

  try {
    const client = createClient('https://athena-db.com/', 'secret')
    const response = await client.verifyConnection()
    assert.equal(response.ok, true)
    assert.equal(response.reachable, true)
    assert.equal(response.baseUrl, 'https://athena-db.com/db')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://athena-db.com/db/')
    assert.equal(calls[0].init?.method, 'GET')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('select builder honors filters, range, and options', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return createMockResponse([{ id: 1, score: 100 }], 200)
  }

  try {
    const athena = createClient('https://athena-db.com', 'secret')
    const result = await athena
      .from('users')
      .gt('score', 90)
      .contains('tags', ['elite'])
      .range(5, 14)
      .select('id, score', { count: 'estimated', head: true, stripNulls: false })

    assert.equal(result.status, 200)
    assert.equal(calls.length, 1)
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.columns, 'id, score')
    assert.equal(payload.limit, 10)
    assert.equal(payload.offset, 5)
    assert.equal(payload.count, 'estimated')
    assert.equal(payload.head, true)
    assert.equal(payload.strip_nulls, false)
    const operators = payload.conditions.map((condition: Record<string, unknown>) => condition.operator)
    assert.deepEqual(operators, ['gt', 'contains'])
    assert.equal(payload.conditions[0].column, 'score')
    assert.deepEqual(payload.conditions[1].value, ['elite'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('mutations support chaining and option propagation', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    const status = calls.length === 1 ? 201 : 200
    return createMockResponse([{ id: 1, name: 'Mordor' }], status)
  }

  try {
    const athena = createClient('https://athena-db.com', 'secret')
    const insertResult = await athena
      .from('countries')
      .insert({ id: 1, name: 'Mordor' })
      .select('id, name', { count: 'exact', defaultToNull: true })

    assert.equal(insertResult.data?.[0]?.name, 'Mordor')
    assert.equal(calls.length, 1)
    const insertPayload = JSON.parse(calls[0].init?.body as string)
    assert.equal(insertPayload.columns, 'id, name')
    assert.equal(insertPayload.count, 'exact')
    assert.equal(insertPayload.default_to_null, true)

    const upsertResult = await athena
      .from('countries')
      .upsert(
        { id: 2, name: 'Rohan' },
        { updateBody: { name: 'Rohan' }, onConflict: 'id' },
      )
      .single('id', { head: false })

    const upsertRow = upsertResult.data as { id: number } | null
    assert.equal(upsertRow?.id, 1)
    assert.equal(calls.length, 2)
    const upsertPayload = JSON.parse(calls[1].init?.body as string)
    assert.equal(upsertPayload.on_conflict, 'id')
    assert.deepEqual(upsertPayload.update_body, { name: 'Rohan' })
    assert.equal(upsertPayload.insert_body.id, 2)

    const deleteResult = await athena
      .from('countries')
      .eq('resource_id', 'r-123')
      .delete()
      .select('id')

    assert.equal(calls.length, 3)
    const deletePayload = JSON.parse(calls[2].init?.body as string)
    assert.equal(deletePayload.resource_id, 'r-123')
    assert.equal(deletePayload.columns, 'id')
    assert.equal(deleteResult.status, 200)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('select chain supports filters after select (flexible ordering)', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return createMockResponse([{ id: 1, name: 'Alice' }], 200)
  }

  try {
    const athena = createClient('https://athena-db.com', 'secret')
    const result = await athena
      .from('users')
      .select('id, name')
      .eq('id', 1)
      .limit(10)

    assert.equal(result.status, 200)
    assert.equal(calls.length, 1)
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.columns, 'id, name')
    assert.equal(payload.limit, 10)
    assert.deepEqual(
      payload.conditions,
      [
        {
          operator: 'eq',
          column: 'id',
          value: 1,
          eq_column: 'id',
          eq_value: 1,
        },
      ],
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('select chain supports single() after filters', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return createMockResponse([{ id: 1, name: 'Alice' }], 200)
  }

  try {
    const athena = createClient('https://athena-db.com', 'secret')
    const result = await athena
      .from('users')
      .select('*')
      .eq('id', 1)
      .single()

    assert.equal(result.status, 200)
    assert.deepEqual(result.data, { id: 1, name: 'Alice' })
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(
      payload.conditions,
      [
        {
          operator: 'eq',
          column: 'id',
          value: 1,
          eq_column: 'id',
          eq_value: 1,
        },
      ],
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('select chain supports .order() after .select() (user example)', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return createMockResponse([{ id: 1, room_id: '31', body: 'hi' }], 200)
  }

  try {
    const athena = createClient('https://athena-db.com', 'secret')
    const roomId = '31'
    const result = await athena
      .from('rsf_messages')
      .eq('room_id', roomId)
      .select('*', { stripNulls: false })
      .order('created_at', { ascending: false })
      .limit(100)

    assert.equal(result.status, 200)
    assert.equal(calls.length, 1)
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.table_name, 'rsf_messages')
    assert.equal(payload.columns, '*')
    assert.equal(payload.strip_nulls, false)
    assert.equal(payload.limit, 100)
    assert.deepEqual(payload.sort_by, { field: 'created_at', direction: 'descending' })
    assert.deepEqual(payload.conditions, [
      {
        operator: 'eq',
        column: 'room_id',
        value: '31',
        eq_column: 'room_id',
        eq_value: '31',
      },
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('update chain supports filters after update (flexible ordering)', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return createMockResponse([{ id: 1, name: 'Updated' }], 200)
  }

  try {
    const athena = createClient('https://athena-db.com', 'secret')
    const result = await athena
      .from('users')
      .update({ name: 'Updated' })
      .eq('id', 1)
      .select()

    assert.equal(result.status, 200)
    assert.equal(calls.length, 1)
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.set, { name: 'Updated' })
    assert.deepEqual(
      payload.conditions,
      [
        {
          operator: 'eq',
          column: 'id',
          value: 1,
          eq_column: 'id',
          eq_value: 1,
        },
      ],
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('AthenaClient.builder() supports auth() for auth namespace routing', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return createMockResponse({
      session: { id: 's_1' },
      user: { id: 'u_1', email: 'user@example.com' },
    }, 200)
  }

  try {
    const client = AthenaClient.builder()
      .url('https://athena-db.com')
      .key('secret')
      .auth({
        baseUrl: 'https://auth.example.com/api/auth',
        apiKey: 'auth-key',
        headers: { 'X-Auth-From': 'builder' },
      })
      .build()

    const result = await client.auth.getSession()

    assert.equal(result.ok, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://auth.example.com/api/auth/get-session')
    const headers = calls[0].init?.headers as Record<string, string>
    assert.equal(headers.apikey, 'auth-key')
    assert.equal(headers['x-api-key'], 'auth-key')
    assert.equal(headers['X-Auth-From'], 'builder')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('AthenaClient.builder() supports options() and experimental tracing', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const traces: Array<{ operation: string }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const requestUrl = String(url)
    calls.push({ url: requestUrl, init })
    if (requestUrl.includes('/get-session')) {
      return createMockResponse({
        session: { id: 's_2' },
        user: { id: 'u_2', email: 'user2@example.com' },
      }, 200)
    }
    return createMockResponse([{ id: 1 }], 200)
  }

  try {
    const client = AthenaClient.builder()
      .url('https://athena-db.com')
      .key('secret')
      .options({
        client: 'builder_options_client',
        backend: 'athena',
        headers: { 'X-Builder-Options': '1' },
        auth: { baseUrl: 'https://auth-options.example.com/api/auth' },
        experimental: {
          traceQueries: {
            logger(event) {
              traces.push({ operation: event.operation })
            },
          },
        },
      })
      .build()

    await client.from('users').select('id').limit(1)
    const session = await client.auth.getSession()

    assert.equal(session.ok, true)
    assert.equal(calls.length, 2)
    assert.equal(calls[0].url.endsWith('/gateway/fetch'), true)
    assert.equal(calls[1].url, 'https://auth-options.example.com/api/auth/get-session')

    const gatewayHeaders = calls[0].init?.headers as Record<string, string>
    assert.equal(gatewayHeaders['X-Athena-Client'], 'builder_options_client')
    assert.equal(gatewayHeaders['X-Builder-Options'], '1')
    assert.equal(traces.some(trace => trace.operation === 'select'), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('AthenaClient.builder() can build from direct service overrides without a unified root URL', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const requestUrl = String(url)
    calls.push({ url: requestUrl, init })
    if (requestUrl.endsWith('/auth/v1/get-session')) {
      return createMockResponse({
        session: { id: 's_builder_1' },
        user: { id: 'u_builder_1', email: 'builder@example.com' },
      }, 200)
    }
    if (requestUrl.endsWith('/storage/v1/catalogs')) {
      return createMockResponse({ data: [] }, 200)
    }
    return createMockResponse([{ id: 1 }], 200)
  }

  try {
    const client = AthenaClient.builder()
      .key('secret')
      .options({
        gatewayUrl: 'https://gateway.builder.local/rest/v1',
        authUrl: 'https://auth.builder.local/auth/v1',
        storageUrl: 'https://storage.builder.local/storage/v1',
        experimental: { athenaStorageBackend: true },
      })
      .build()

    await client.from('users').select('id').limit(1)
    const session = await client.auth.getSession()
    await client.storage.listStorageCatalogs()

    assert.equal(session.ok, true)
    assert.equal(calls.length, 3)
    assert.equal(calls[0].url, 'https://gateway.builder.local/rest/v1/gateway/fetch')
    assert.equal(calls[1].url, 'https://auth.builder.local/auth/v1/get-session')
    assert.equal(calls[2].url, 'https://storage.builder.local/storage/v1/catalogs')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('createClient mirrors auth bearerToken onto gateway requests', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return createMockResponse([{ id: 1 }], 200)
  }

  try {
    const client = createClient('https://athena-db.com', 'secret', {
      auth: {
        bearerToken: 'gateway-auth-bearer',
      },
    })

    await client.from('users').select('id').limit(1)

    assert.equal(calls.length, 1)
    const headers = calls[0].init?.headers as Record<string, string>
    assert.equal(headers['X-Athena-Auth-Bearer-Token'], 'gateway-auth-bearer')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('AthenaClient.builder() composes auth/experimental/options without clobbering previous values', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const traces: Array<{ operation: string }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const requestUrl = String(url)
    calls.push({ url: requestUrl, init })
    if (requestUrl.includes('/get-session')) {
      return createMockResponse({
        session: { id: 's_3' },
        user: { id: 'u_3', email: 'user3@example.com' },
      }, 200)
    }
    return createMockResponse([{ id: 1 }], 200)
  }

  try {
    const client = AthenaClient.builder()
      .url('https://athena-db.com')
      .key('secret')
      .headers({ 'X-Base': 'base' })
      .auth({
        baseUrl: 'https://auth-a.example.com/api/auth',
        headers: { 'X-Auth-A': '1' },
      })
      .auth({
        baseUrl: 'https://auth-b.example.com/api/auth',
        apiKey: 'auth-merged-key',
        headers: { 'X-Auth-B': '1' },
      })
      .experimental({
        traceQueries: {
          logger(event) {
            traces.push({ operation: event.operation })
          },
        },
      })
      .options({
        headers: { 'X-Options': '1' },
        auth: {
          headers: { 'X-Auth-From-Options': '1' },
        },
        experimental: { enableErrorNormalization: true },
      })
      .build()

    await client.from('users').select('id').limit(1)
    const session = await client.auth.getSession()

    assert.equal(session.ok, true)
    assert.equal(calls.length, 2)
    assert.equal(calls[1].url, 'https://auth-b.example.com/api/auth/get-session')

    const gatewayHeaders = calls[0].init?.headers as Record<string, string>
    assert.equal(gatewayHeaders['X-Base'], 'base')
    assert.equal(gatewayHeaders['X-Options'], '1')
    assert.equal(traces.some(trace => trace.operation === 'select'), true)

    const authHeaders = calls[1].init?.headers as Record<string, string>
    assert.equal(authHeaders.apikey, 'auth-merged-key')
    assert.equal(authHeaders['x-api-key'], 'auth-merged-key')
    assert.equal(authHeaders['X-Auth-A'], '1')
    assert.equal(authHeaders['X-Auth-B'], '1')
    assert.equal(authHeaders['X-Auth-From-Options'], '1')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('failed AthenaResult values include structured error metadata by default', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    createMockResponse(
      { error: 'duplicate key value violates unique constraint "users_id_key"' },
      409,
    )

  try {
    const athena = createClient('https://athena-db.com', 'secret')
    const result = await athena.from('users').insert({ id: 1 }).select()

    assert.equal(result.status, 409)
    assert.equal(result.error?.message, 'duplicate key value violates unique constraint "users_id_key"')
    assert.equal(result.error?.kind, 'unique_violation')
    assert.equal(result.error?.operation, 'insert')
    assert.equal(result.error?.table, 'users')
    assert.equal(Object.keys(result).includes('__athenaNormalizedError'), false)

    const normalized = normalizeAthenaError(result)
    assert.equal(normalized.kind, 'unique_violation')
    assert.equal(normalized.operation, 'insert')
    assert.equal(normalized.table, 'users')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('db module exposes from/select/insert/query without changing root behavior', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    if (String(url).endsWith('/gateway/query')) {
      return createMockResponse([{ id: 42 }], 200)
    }
    return createMockResponse([{ id: 1, name: 'Alice' }], 200)
  }

  try {
    const athena = createClient('https://athena-db.com', 'secret')

    const dbSelect = await athena.db.select('users', 'id, name').eq('id', 1).limit(1)
    assert.equal(dbSelect.status, 200)

    const dbInsert = await athena.db.insert('users', { id: 2, name: 'Bob' }).select('id')
    assert.equal(dbInsert.status, 200)

    const dbFrom = await athena.db.from('users').select('id').limit(2)
    assert.equal(dbFrom.status, 200)

    const dbQuery = await athena.db.query('select id from users')
    assert.equal(dbQuery.status, 200)

    assert.equal(calls.length, 4)

    const selectPayload = JSON.parse(calls[0].init?.body as string)
    assert.equal(selectPayload.table_name, 'users')
    assert.equal(selectPayload.columns, 'id, name')

    const insertPayload = JSON.parse(calls[1].init?.body as string)
    assert.equal(insertPayload.table_name, 'users')
    assert.deepEqual(insertPayload.insert_body, { id: 2, name: 'Bob' })

    const fromPayload = JSON.parse(calls[2].init?.body as string)
    assert.equal(fromPayload.table_name, 'users')
    assert.equal(fromPayload.columns, 'id')

    const queryPayload = JSON.parse(calls[3].init?.body as string)
    assert.equal(queryPayload.query, 'select id from users')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('db.from supports base schema options', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return createMockResponse([{ id: 1 }], 200)
  }

  try {
    const athena = createClient('https://athena-db.com', 'secret')
    const result = await athena.db.from('users', { schema: 'auth' }).select('id').limit(1)

    assert.equal(result.status, 200)
    assert.equal(calls.length, 1)
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.table_name, 'auth.users')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('storage module is exposed only behind experimental athenaStorageBackend flag', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  const file = {
    id: 'file_1',
    name: 'report.pdf',
    bucket: 'documents',
    organization_id: 'org_1',
    metadata: {},
    created_at: '2026-06-13T00:00:00.000Z',
    updated_at: '2026-06-13T00:00:00.000Z',
    storage_key: 'reports/report.pdf',
    is_public: false,
    status: 'pending',
  }

  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    const requestUrl = String(url)
    if (requestUrl.endsWith('/storage/catalogs')) {
      return createMockResponse({
        data: [
          {
            id: 's3_1',
            name: 'documents',
            description: 'Document bucket',
            endpoint: 'https://s3.example.com',
            region: 'us-east-1',
            bucket: 'documents',
            provider: 's3',
            is_active: true,
            created_at: '2026-06-13T00:00:00.000Z',
            updated_at: '2026-06-13T00:00:00.000Z',
          },
        ],
      }, 200)
    }
    if (requestUrl.endsWith('/storage/files/upload-url')) {
      return createMockResponse({
        status: 'ok',
        message: 'created',
        data: {
          file,
          upload: {
            file_id: 'file_1',
            bucket: 'documents',
            storage_key: 'reports/report.pdf',
            purpose: 'upload',
            url: 'https://upload.example.com',
            expires_at: '2026-06-13T01:00:00.000Z',
            expires_at_epoch_seconds: 1781312400,
            expires_in: 3600,
            cache_hit: false,
            cache_layer: 'none',
          },
        },
      }, 200)
    }
    if (requestUrl.endsWith('/storage/files/file%201/url?purpose=download')) {
      return createMockResponse({
        status: 'ok',
        message: 'signed',
        data: {
          file_id: 'file 1',
          bucket: 'documents',
          storage_key: 'reports/report.pdf',
          purpose: 'download',
          url: 'https://download.example.com',
          expires_at: '2026-06-13T01:00:00.000Z',
          expires_at_epoch_seconds: 1781312400,
          expires_in: 3600,
          cache_hit: true,
          cache_layer: 'memory',
        },
      }, 200)
    }
    return createMockResponse({ error: 'unexpected endpoint' }, 404)
  }

  try {
    const defaultClient = createClient('https://athena-db.com', 'secret')
    assert.equal('storage' in defaultClient, false)

    const client = createClient('https://athena-db.com', 'secret', {
      client: 'storage_test',
      experimental: { athenaStorageBackend: true },
    })

    const catalogs = await client.storage.listStorageCatalogs()
    assert.equal(catalogs.data[0].id, 's3_1')

    const uploadUrl = await client.storage.createStorageUploadUrl({
      s3_id: 's3_1',
      storage_key: 'reports/report.pdf',
    })
    assert.equal(uploadUrl.file.id, 'file_1')
    assert.equal(uploadUrl.upload.url, 'https://upload.example.com')

    const downloadUrl = await client.storage.getStorageFileUrl('file 1', { purpose: 'download' })
    assert.equal(downloadUrl.cache_hit, true)
    assert.equal(downloadUrl.url, 'https://download.example.com')

    assert.equal(calls.length, 3)
    assert.equal(calls[0].url, 'https://athena-db.com/storage/catalogs')
    assert.equal(calls[0].init?.method, 'GET')

    assert.equal(calls[1].url, 'https://athena-db.com/storage/files/upload-url')
    assert.equal(calls[1].init?.method, 'POST')
    assert.deepEqual(JSON.parse(calls[1].init?.body as string), {
      s3_id: 's3_1',
      storage_key: 'reports/report.pdf',
    })
    const headers = calls[1].init?.headers as Record<string, string>
    assert.equal(headers['X-Athena-Client'], 'storage_test')

    assert.equal(calls[2].url, 'https://athena-db.com/storage/files/file%201/url?purpose=download')
    assert.equal(calls[2].init?.method, 'GET')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('storage module routes every storage method with expected envelopes and payloads', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  const file = {
    id: 'file_1',
    name: 'report.pdf',
    bucket: 'documents',
    organization_id: 'org_1',
    metadata: {},
    created_at: '2026-06-13T00:00:00.000Z',
    updated_at: '2026-06-13T00:00:00.000Z',
    storage_key: 'reports/report.pdf',
    is_public: false,
    status: 'ready',
  }
  const upload = {
    file_id: 'file_1',
    bucket: 'documents',
    storage_key: 'reports/report.pdf',
    purpose: 'upload',
    url: 'https://upload.example.com',
    expires_at: '2026-06-13T01:00:00.000Z',
    expires_at_epoch_seconds: 1781312400,
    expires_in: 3600,
    cache_hit: false,
    cache_layer: 'none',
  }
  const catalog = {
    id: 's3_1',
    name: 'documents',
    description: 'Document bucket',
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'documents',
    provider: 's3',
    is_active: true,
    created_at: '2026-06-13T00:00:00.000Z',
    updated_at: '2026-06-13T00:00:00.000Z',
  }
  const credential = {
    ...catalog,
    id: 'cred_1',
    s3_id: 's3_1',
    access_key: 'AKIA_TEST',
  }
  const athena = (data: unknown) => ({
    status: 'ok',
    message: 'ok',
    data,
  })

  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    const requestUrl = new URL(String(url))
    const method = init?.method
    if (requestUrl.pathname === '/storage/catalogs' && method === 'GET') {
      return createMockResponse({ data: [catalog] }, 200)
    }
    if (requestUrl.pathname === '/storage/catalogs' && method === 'POST') {
      return createMockResponse(catalog, 201)
    }
    if (requestUrl.pathname === '/storage/catalogs/s3%201' && method === 'PATCH') {
      return createMockResponse({ ...catalog, name: 'documents-v2' }, 200)
    }
    if (requestUrl.pathname === '/storage/catalogs/s3%201' && method === 'DELETE') {
      return createMockResponse({ id: 's3 1', deleted: true }, 200)
    }
    if (requestUrl.pathname === '/storage/credentials' && method === 'GET') {
      return createMockResponse({ data: [credential] }, 200)
    }
    if (requestUrl.pathname === '/storage/files/upload-url') {
      return createMockResponse(athena({ file, upload }), 200)
    }
    if (requestUrl.pathname === '/storage/files/upload-urls') {
      return createMockResponse(athena({ files: [{ file, upload }] }), 200)
    }
    if (requestUrl.pathname === '/storage/files/list') {
      return createMockResponse(athena({ files: [file], count: 1 }), 200)
    }
    if (requestUrl.pathname === '/storage/files/file%201/url') {
      return createMockResponse(athena({ ...upload, purpose: requestUrl.searchParams.get('purpose') }), 200)
    }
    if (requestUrl.pathname === '/storage/files/file%201/proxy') {
      return new Response('proxy-body', {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'inline',
          etag: '"file-etag"',
          'cache-control': 'private, no-store',
        },
      })
    }
    if (requestUrl.pathname.startsWith('/storage/files/file%201')) {
      return createMockResponse(athena({ file }), 200)
    }
    if (requestUrl.pathname === '/storage/folders/delete') {
      return createMockResponse(athena({ s3_id: 's3_1', prefix: 'folder/', processed_files: 2 }), 200)
    }
    if (requestUrl.pathname === '/storage/folders/move') {
      return createMockResponse(athena({ s3_id: 's3_1', prefix: 'new-folder/', processed_files: 2 }), 200)
    }
    return createMockResponse({ error: `unexpected ${method} ${requestUrl.pathname}` }, 404)
  }

  try {
    const client = AthenaClient.builder()
      .url('https://athena-db.com')
      .key('secret')
      .options({
        client: 'storage_matrix',
        experimental: { athenaStorageBackend: true },
      })
      .build()

    await client.storage.listStorageCatalogs()
    await client.storage.createStorageCatalog({
      name: 'documents',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      access_key_id: 'AKIA_TEST',
      secret_key: 'secret',
    })
    await client.storage.updateStorageCatalog('s3 1', { name: 'documents-v2' })
    await client.storage.deleteStorageCatalog('s3 1')
    await client.storage.listStorageCredentials()
    await client.storage.createStorageUploadUrl({ s3_id: 's3_1', storage_key: 'reports/report.pdf' })
    await client.storage.createStorageUploadUrls({
      files: [{ s3_id: 's3_1', storage_key: 'reports/report.pdf' }],
    })
    await client.storage.listStorageFiles({ s3_id: 's3_1', prefix: 'reports/' })
    await client.storage.getStorageFile('file 1')
    await client.storage.getStorageFileUrl('file 1', { purpose: 'download' })
    const proxyResponse = await client.storage.getStorageFileProxy('file 1', { purpose: 'stream' })
    assert.equal(proxyResponse.headers.get('content-type'), 'application/pdf')
    assert.equal(proxyResponse.headers.get('content-disposition'), 'inline')
    assert.equal(proxyResponse.headers.get('etag'), '"file-etag"')
    assert.equal(proxyResponse.headers.get('cache-control'), 'private, no-store')
    assert.equal(await proxyResponse.text(), 'proxy-body')
    await client.storage.updateStorageFile('file 1', { storage_key: 'reports/archive.pdf' })
    await client.storage.deleteStorageFile('file 1')
    await client.storage.setStorageFileVisibility('file 1', { public: true })
    await client.storage.deleteStorageFolder({ s3_id: 's3_1', prefix: 'folder/' })
    await client.storage.moveStorageFolder({
      s3_id: 's3_1',
      from_prefix: 'folder/',
      to_prefix: 'new-folder/',
    })

    const observed = calls.map(call => {
      const parsedUrl = new URL(call.url)
      return {
        method: call.init?.method,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        body: call.init?.body ? JSON.parse(call.init.body as string) : undefined,
      }
    })

    assert.deepEqual(observed, [
      { method: 'GET', path: '/storage/catalogs', body: undefined },
      {
        method: 'POST',
        path: '/storage/catalogs',
        body: {
          name: 'documents',
          endpoint: 'https://s3.example.com',
          region: 'us-east-1',
          access_key_id: 'AKIA_TEST',
          secret_key: 'secret',
        },
      },
      { method: 'PATCH', path: '/storage/catalogs/s3%201', body: { name: 'documents-v2' } },
      { method: 'DELETE', path: '/storage/catalogs/s3%201', body: undefined },
      { method: 'GET', path: '/storage/credentials', body: undefined },
      {
        method: 'POST',
        path: '/storage/files/upload-url',
        body: { s3_id: 's3_1', storage_key: 'reports/report.pdf' },
      },
      {
        method: 'POST',
        path: '/storage/files/upload-urls',
        body: { files: [{ s3_id: 's3_1', storage_key: 'reports/report.pdf' }] },
      },
      {
        method: 'POST',
        path: '/storage/files/list',
        body: { s3_id: 's3_1', prefix: 'reports/' },
      },
      { method: 'GET', path: '/storage/files/file%201', body: undefined },
      { method: 'GET', path: '/storage/files/file%201/url?purpose=download', body: undefined },
      { method: 'GET', path: '/storage/files/file%201/proxy?purpose=stream', body: undefined },
      {
        method: 'PATCH',
        path: '/storage/files/file%201',
        body: { storage_key: 'reports/archive.pdf' },
      },
      { method: 'DELETE', path: '/storage/files/file%201', body: undefined },
      {
        method: 'PATCH',
        path: '/storage/files/file%201/visibility',
        body: { public: true },
      },
      {
        method: 'POST',
        path: '/storage/folders/delete',
        body: { s3_id: 's3_1', prefix: 'folder/' },
      },
      {
        method: 'POST',
        path: '/storage/folders/move',
        body: { s3_id: 's3_1', from_prefix: 'folder/', to_prefix: 'new-folder/' },
      },
    ])
    for (const call of calls) {
      assert.equal((call.init?.headers as Record<string, string>)['X-Athena-Client'], 'storage_matrix')
    }
    const fileCalls = calls.filter(call => new URL(call.url).pathname.startsWith('/storage/files/'))
    assert.equal(fileCalls.length, 9)
    for (const call of fileCalls) {
      assert.equal((call.init?.headers as Record<string, string>)['X-Athena-Client'], 'storage_matrix')
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('storage proxy returns raw binary response and normalizes non-json errors', async () => {
  const originalFetch = globalThis.fetch
  const seen: AthenaStorageError[] = []
  let shouldFail = false
  globalThis.fetch = async () => {
    if (shouldFail) {
      return new Response('proxy forbidden', {
        status: 403,
        headers: {
          'content-type': 'text/plain',
          'x-request-id': 'req_proxy_403',
        },
      })
    }
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment',
        etag: '"binary-etag"',
      },
    })
  }

  try {
    const client = createClient('https://athena-db.com', 'secret', {
      experimental: {
        athenaStorageBackend: true,
        storage: {
          onError(error) {
            seen.push(error)
          },
        },
      },
    })

    const response = await client.storage.getStorageFileProxy('file_1', { purpose: 'download' })
    assert.equal(response.headers.get('content-type'), 'application/octet-stream')
    assert.equal(response.headers.get('content-disposition'), 'attachment')
    assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), [1, 2, 3])

    shouldFail = true
    let thrown: unknown
    try {
      await client.storage.getStorageFileProxy('file_1', { purpose: 'read' })
    } catch (error) {
      thrown = error
    }

    assert.ok(thrown instanceof AthenaStorageError)
    assert.equal(seen.length, 1)
    assert.equal(seen[0], thrown)
    assert.equal(thrown.code, 'HTTP_ERROR')
    assert.equal(thrown.athenaCode, 'AUTH_FORBIDDEN')
    assert.equal(thrown.kind, 'auth')
    assert.equal(thrown.retryable, false)
    assert.equal(thrown.status, 403)
    assert.equal(thrown.requestId, 'req_proxy_403')
    assert.equal(thrown.raw, 'proxy forbidden')
    assert.equal(thrown.normalized.operation, 'getStorageFileProxy')
    assert.equal(normalizeAthenaError(thrown).operation, 'getStorageFileProxy')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('grouped storage namespaces forward auth context and expose low-level upload helpers', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const file = {
    id: 'file_1',
    name: 'report.pdf',
    file_name: 'report.pdf',
    bucket: 'documents',
    organization_id: 'org_1',
    metadata: {},
    created_at: '2026-06-15T00:00:00Z',
    updated_at: '2026-06-15T00:00:00Z',
    storage_key: 'reports/report.pdf',
    is_public: false,
    visibility: 'private',
    status: 'pending',
  }

  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    const parsedUrl = new URL(String(url))
    if (parsedUrl.hostname === 'upload.example.com') {
      return new Response(null, { status: 200 })
    }
    if (parsedUrl.pathname === '/storage/files/upload-url') {
      return createMockResponse({
        status: 'success',
        message: 'ok',
        data: {
          file,
          upload: {
            file_id: 'file_1',
            bucket: 'documents',
            storage_key: 'reports/report.pdf',
            purpose: 'upload',
            url: 'https://upload.example.com/report.pdf',
            expires_at: '2026-06-15T00:10:00Z',
            expires_at_epoch_seconds: 1781482200,
            expires_in: 600,
            cache_hit: false,
            cache_layer: 'origin',
          },
        },
      })
    }
    if (parsedUrl.pathname === '/storage/files/file_1/confirm-upload') {
      return createMockResponse({ status: 'success', message: 'ok', data: { file: { ...file, status: 'uploaded' } } })
    }
    if (parsedUrl.pathname === '/storage/files/file_1/public-url') {
      return createMockResponse({
        status: 'success',
        message: 'ok',
        data: {
          file_id: 'file_1',
          bucket: 'documents',
          storage_key: 'reports/report.pdf',
          url: 'https://public.example.com/reports/report.pdf',
        },
      })
    }
    if (parsedUrl.pathname === '/storage/files/delete-many') {
      return createMockResponse({ status: 'success', message: 'ok', data: { files: [file], count: 1 } })
    }
    if (parsedUrl.pathname === '/storage/permissions/check') {
      return createMockResponse({ status: 'success', message: 'ok', data: { allowed: true, permission: 'read' } })
    }
    if (parsedUrl.pathname === '/storage/objects/exists') {
      return createMockResponse({ status: 'success', message: 'ok', data: { exists: true, key: 'reports/report.pdf' } })
    }
    if (parsedUrl.pathname === '/storage/buckets/cors') {
      return createMockResponse({ status: 'success', message: 'ok', data: { bucket: 'documents', cors_xml: '' } })
    }
    if (parsedUrl.pathname === '/storage/multipart/create') {
      return createMockResponse({ status: 'success', message: 'ok', data: { file_id: 'file_1', upload_id: 'mp_1' } })
    }
    if (parsedUrl.pathname === '/storage/audit/list') {
      return createMockResponse({ status: 'success', message: 'ok', data: { events: [], count: 0 } })
    }
    return createMockResponse({ error: `unexpected ${init?.method} ${parsedUrl.pathname}` }, 404)
  }

  try {
    const client = createClient('https://athena-db.com', 'secret', {
      client: 'storage_groups',
      headers: {
        Cookie: 'athena-auth.session-token=session_123',
        Authorization: 'Bearer bearer_456',
      },
      experimental: {
        athenaStorageBackend: true,
      },
    })

    const prepared = await client.storage.file.upload({
      s3Id: 's3_1',
      storageKey: 'reports/report.pdf',
      fileName: 'report.pdf',
      contentType: 'application/pdf',
      visibility: 'private',
    })
    assert.equal(prepared.upload.method, 'PUT')
    assert.equal(prepared.upload.expiresAt, '2026-06-15T00:10:00Z')

    const putResponse = await prepared.upload.put(new Blob(['pdf-body'], { type: 'application/pdf' }))
    assert.equal(putResponse.status, 200)

    await client.storage.file.confirmUpload('file_1')
    const publicUrl = await client.storage.file.publicUrl('file_1')
    assert.equal(publicUrl.url, 'https://public.example.com/reports/report.pdf')
    await client.storage.file.deleteMany({ file_ids: ['file_1'] })
    const permission = await client.storage.permission.check({ file_id: 'file_1', permission: 'read' })
    assert.equal(permission.allowed, true)
    const objectExists = await client.storage.object.exists({
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      access_key_id: 'AKIA_TEST',
      secret_key: 'secret',
      bucket: 'documents',
      key: 'reports/report.pdf',
    })
    assert.equal(objectExists.exists, true)
    await client.storage.bucket.cors.get({
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      access_key_id: 'AKIA_TEST',
      secret_key: 'secret',
      bucket: 'documents',
    })
    await client.storage.multipart.create({ file_id: 'file_1', content_type: 'application/pdf' })
    const audit = await client.storage.audit.list({ file_id: 'file_1' })
    assert.equal(audit.count, 0)

    const uploadRequestHeaders = calls[0].init?.headers as Record<string, string>
    assert.equal(uploadRequestHeaders['X-Athena-Client'], 'storage_groups')
    assert.equal(uploadRequestHeaders['Cookie'], 'athena-auth.session-token=session_123')
    assert.equal(uploadRequestHeaders['Authorization'], 'Bearer bearer_456')
    assert.equal(uploadRequestHeaders['X-Athena-Auth-Session-Token'], 'session_123')
    assert.equal(uploadRequestHeaders['X-Athena-Auth-Bearer-Token'], 'bearer_456')

    const observed = calls.map(call => {
      const parsedUrl = new URL(call.url)
      return {
        method: call.init?.method,
        host: parsedUrl.hostname,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        body: typeof call.init?.body === 'string' ? JSON.parse(call.init.body) : undefined,
        contentType: call.init?.headers instanceof Headers
          ? call.init.headers.get('content-type')
          : (call.init?.headers as Record<string, string> | undefined)?.['Content-Type'],
      }
    })

    assert.deepEqual(observed, [
      {
        method: 'POST',
        host: 'athena-db.com',
        path: '/storage/files/upload-url',
        body: {
          s3_id: 's3_1',
          storage_key: 'reports/report.pdf',
          name: 'report.pdf',
          original_name: 'report.pdf',
          content_type: 'application/pdf',
          visibility: 'private',
        },
        contentType: 'application/json',
      },
      {
        method: 'PUT',
        host: 'upload.example.com',
        path: '/report.pdf',
        body: undefined,
        contentType: 'application/pdf',
      },
      {
        method: 'POST',
        host: 'athena-db.com',
        path: '/storage/files/file_1/confirm-upload',
        body: {},
        contentType: 'application/json',
      },
      {
        method: 'GET',
        host: 'athena-db.com',
        path: '/storage/files/file_1/public-url',
        body: undefined,
        contentType: 'application/json',
      },
      {
        method: 'POST',
        host: 'athena-db.com',
        path: '/storage/files/delete-many',
        body: { file_ids: ['file_1'] },
        contentType: 'application/json',
      },
      {
        method: 'POST',
        host: 'athena-db.com',
        path: '/storage/permissions/check',
        body: { file_id: 'file_1', permission: 'read' },
        contentType: 'application/json',
      },
      {
        method: 'POST',
        host: 'athena-db.com',
        path: '/storage/objects/exists',
        body: {
          endpoint: 'https://s3.example.com',
          region: 'us-east-1',
          access_key_id: 'AKIA_TEST',
          secret_key: 'secret',
          bucket: 'documents',
          key: 'reports/report.pdf',
        },
        contentType: 'application/json',
      },
      {
        method: 'POST',
        host: 'athena-db.com',
        path: '/storage/buckets/cors',
        body: {
          endpoint: 'https://s3.example.com',
          region: 'us-east-1',
          access_key_id: 'AKIA_TEST',
          secret_key: 'secret',
          bucket: 'documents',
        },
        contentType: 'application/json',
      },
      {
        method: 'POST',
        host: 'athena-db.com',
        path: '/storage/multipart/create',
        body: { file_id: 'file_1', content_type: 'application/pdf' },
        contentType: 'application/json',
      },
      {
        method: 'POST',
        host: 'athena-db.com',
        path: '/storage/audit/list',
        body: { file_id: 'file_1' },
        contentType: 'application/json',
      },
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('storage file facade uploads with prefix templates and wraps list download delete', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const progress: number[] = []

  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    const parsedUrl = new URL(String(url))
    if (parsedUrl.hostname === 'upload.example.com') {
      return new Response(null, { status: 200 })
    }
    if (parsedUrl.pathname === '/storage/files/upload-url') {
      const body = JSON.parse(init?.body as string) as { storage_key: string; name: string }
      return createMockResponse({
        status: 'success',
        message: 'ok',
        data: {
          file: {
            id: 'file_1',
            name: body.name,
            bucket: 'documents',
            organization_id: 'org_1',
            metadata: {},
            created_at: '2026-06-15T00:00:00Z',
            updated_at: '2026-06-15T00:00:00Z',
            storage_key: body.storage_key,
            is_public: false,
            status: 'ready',
          },
          upload: {
            file_id: 'file_1',
            bucket: 'documents',
            storage_key: body.storage_key,
            purpose: 'upload',
            url: 'https://upload.example.com/report.txt',
            expires_at: '2026-06-15T00:10:00Z',
            expires_at_epoch_seconds: 1781482200,
            expires_in: 600,
            cache_hit: false,
            cache_layer: 'origin',
          },
        },
      })
    }
    if (parsedUrl.pathname === '/storage/files/list') {
      return createMockResponse({
        status: 'success',
        message: 'ok',
        data: { files: [], count: 0 },
      })
    }
    if (parsedUrl.pathname.endsWith('/proxy')) {
      return new Response('file-body', { status: 200 })
    }
    if (parsedUrl.pathname.startsWith('/storage/files/')) {
      return createMockResponse({
        status: 'success',
        message: 'ok',
        data: {
          file: {
            id: parsedUrl.pathname.split('/').at(-1) ?? 'file_1',
            name: 'deleted.pdf',
            bucket: 'documents',
            organization_id: 'org_1',
            metadata: {},
            created_at: '2026-06-15T00:00:00Z',
            updated_at: '2026-06-15T00:00:00Z',
            storage_key: 'reports/deleted.pdf',
            is_public: false,
            status: 'deleted',
          },
        },
      })
    }
    return createMockResponse({ status: 'success', message: 'ok', data: {} })
  }

  try {
    const client = createClient('https://athena-db.com', 'secret', {
      client: 'storage_facade',
      experimental: {
        athenaStorageBackend: true,
        storage: {
          prefixPath: 'orgs/{organization_id}/env/{env.STAGE}',
          env: { STAGE: 'test' },
        },
      },
    })

    await assert.rejects(
      () => client.storage.file.upload({
        s3_id: 's3_1',
        files: [new Blob(['a']), new Blob(['b'])],
      }),
      /at most 1 file/,
    )

    const uploaded = await client.storage.file.upload(
      {
        s3_id: 's3_1',
        bucket: 'documents',
        files: new Blob(['hello'], { type: 'text/plain' }),
        fileName: 'report.txt',
        extensions: ['txt'],
        maxFileSizeMb: 1,
        onProgress(event) {
          progress.push(event.aggregatePercent)
        },
      },
      { organizationId: 'org_1' },
    )
    assert.equal(uploaded.count, 1)
    assert.equal(uploaded.files[0].storage_key, 'orgs/org_1/env/test/report.txt')
    assert.equal(uploaded.files[0].file.storage_key, 'orgs/org_1/env/test/report.txt')
    assert.ok(progress.includes(100))

    const listed = await client.storage.file.list({
      s3_id: 's3_1',
      prefix: 'reports',
      prefixPath: 'tenants/{organization_id}',
      vars: { organization_id: 'org_2' },
    })
    assert.equal(listed.count, 0)

    const downloads = await client.storage.file.download(['file 1', 'file 2'], { purpose: 'download' })
    assert.deepEqual(await Promise.all(downloads.map(response => response.text())), ['file-body', 'file-body'])

    const deleted = await client.storage.delete(['file 1', 'file 2'])
    assert.equal(deleted.length, 2)

    const observed = calls.map(call => {
      const parsedUrl = new URL(call.url)
      return {
        method: call.init?.method,
        host: parsedUrl.hostname,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        body: call.init?.body && typeof call.init.body === 'string'
          ? JSON.parse(call.init.body)
          : undefined,
        contentType: call.init?.headers instanceof Headers
          ? call.init.headers.get('content-type')
          : undefined,
      }
    })
    assert.deepEqual(observed, [
      {
        method: 'POST',
        host: 'athena-db.com',
        path: '/storage/files/upload-url',
        body: {
          s3_id: 's3_1',
          bucket: 'documents',
          storage_key: 'orgs/org_1/env/test/report.txt',
          name: 'report.txt',
          original_name: 'report.txt',
          mime_type: 'text/plain',
          content_type: 'text/plain',
          size_bytes: 5,
        },
        contentType: undefined,
      },
      {
        method: 'PUT',
        host: 'upload.example.com',
        path: '/report.txt',
        body: undefined,
        contentType: 'text/plain',
      },
      {
        method: 'POST',
        host: 'athena-db.com',
        path: '/storage/files/list',
        body: { s3_id: 's3_1', prefix: 'tenants/org_2/reports' },
        contentType: undefined,
      },
      {
        method: 'GET',
        host: 'athena-db.com',
        path: '/storage/files/file%201/proxy?purpose=download',
        body: undefined,
        contentType: undefined,
      },
      {
        method: 'GET',
        host: 'athena-db.com',
        path: '/storage/files/file%202/proxy?purpose=download',
        body: undefined,
        contentType: undefined,
      },
      {
        method: 'DELETE',
        host: 'athena-db.com',
        path: '/storage/files/file%201',
        body: undefined,
        contentType: undefined,
      },
      {
        method: 'DELETE',
        host: 'athena-db.com',
        path: '/storage/files/file%202',
        body: undefined,
        contentType: undefined,
      },
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('createAthenaStorageError produces normalized storage error metadata', () => {
  const error = createAthenaStorageError({
    code: AthenaStorageErrorCode.InvalidAthenaEnvelope,
    message: 'Athena storage GET /storage/files/file_1 returned an invalid Athena envelope',
    status: 200,
    endpoint: '/storage/files/file_1',
    method: 'GET',
    raw: { status: 'ok', message: 'ok' },
  })

  assert.ok(error instanceof AthenaStorageError)
  assert.equal(error.code, 'INVALID_ATHENA_ENVELOPE')
  assert.equal(error.athenaCode, 'VALIDATION_FAILED')
  assert.equal(error.kind, 'validation')
  assert.equal(error.category, 'client')
  assert.equal(error.retryable, false)
  assert.equal(error.normalized.operation, 'getStorageFile')
  assert.equal(normalizeAthenaError(error).operation, 'getStorageFile')
  assert.deepEqual(error.toDetails(), {
    code: 'INVALID_ATHENA_ENVELOPE',
    athenaCode: 'VALIDATION_FAILED',
    kind: 'validation',
    category: 'client',
    retryable: false,
    message: 'Athena storage GET /storage/files/file_1 returned an invalid Athena envelope',
    status: 200,
    endpoint: '/storage/files/file_1',
    method: 'GET',
    requestId: undefined,
    hint: undefined,
    cause: undefined,
    raw: { status: 'ok', message: 'ok' },
  })
})

test('storage failures invoke global and per-call error callbacks with normalized errors', async () => {
  const originalFetch = globalThis.fetch
  const seen: AthenaStorageError[] = []
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        message: 'rate limit exceeded',
        hint: 'wait and retry',
        cause: 'storage quota exceeded',
      }),
      {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'x-athena-request-id': 'req_storage_1',
        },
      },
    )

  try {
    const client = createClient('https://athena-db.com', 'secret', {
      experimental: {
        athenaStorageBackend: true,
        storage: {
          onError(error) {
            seen.push(error)
            throw new Error('observer failure should not mask storage error')
          },
        },
      },
    })

    let thrown: unknown
    try {
      await client.storage.listStorageCatalogs({
        onError(error) {
          seen.push(error)
        },
      })
    } catch (error) {
      thrown = error
    }

    assert.ok(thrown instanceof AthenaStorageError)
    assert.equal(seen.length, 2)
    assert.equal(seen[0], thrown)
    assert.equal(seen[1], thrown)
    assert.equal(thrown.code, 'HTTP_ERROR')
    assert.equal(thrown.athenaCode, 'RATE_LIMITED')
    assert.equal(thrown.kind, 'rate_limit')
    assert.equal(thrown.category, 'server')
    assert.equal(thrown.retryable, true)
    assert.equal(thrown.status, 429)
    assert.equal(thrown.endpoint, '/storage/catalogs')
    assert.equal(thrown.method, 'GET')
    assert.equal(thrown.requestId, 'req_storage_1')
    assert.equal(thrown.hint, 'wait and retry')
    assert.equal(thrown.causeDetail, 'storage quota exceeded')
    assert.equal(thrown.normalized.operation, 'listStorageCatalogs')
    assert.equal(normalizeAthenaError(thrown).code, 'RATE_LIMITED')
  } finally {
    globalThis.fetch = originalFetch
  }
})
