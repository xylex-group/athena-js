import { strict as assert } from 'assert'
import { test } from 'node:test'
import { createClient, AthenaClient } from '../src/client.ts'
import { normalizeAthenaError } from '../src/auxiliaries.ts'

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

test('createClient throws early for malformed gateway URLs', () => {
  assert.throws(
    () => createClient('not-a-url', 'secret'),
    /valid absolute http\(s\) URL/,
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
    assert.equal(response.baseUrl, 'https://athena-db.com')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://athena-db.com/')
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
