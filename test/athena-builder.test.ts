import { strict as assert } from 'assert'
import { test } from 'node:test'
import { createClient, AthenaClient } from '../src/supabase.ts'

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
    assert.deepEqual(payload.update_body, { name: 'Updated' })
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
