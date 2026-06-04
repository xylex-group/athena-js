import { strict as assert } from 'assert'
import { test } from 'node:test'
import { createClient, type AthenaQueryTraceEvent } from '../src/client.ts'

function createMockResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

test('experimental.traceQueries=true logs select traces with sql, outcome, and callsite', async () => {
  const captured: AthenaQueryTraceEvent[] = []
  const originalFetch = globalThis.fetch
  const originalInfo = console.info

  console.info = (...args: unknown[]) => {
    const event = args[1]
    if (event && typeof event === 'object') {
      captured.push(event as AthenaQueryTraceEvent)
    }
  }
  globalThis.fetch = async () => createMockResponse([{ id: 1 }], 200)

  try {
    const client = createClient('https://athena-db.com', 'secret', {
      experimental: { traceQueries: true },
    })

    const result = await client.from('users').eq('id', 1).select('id')

    assert.equal(result.status, 200)
    assert.equal(captured.length, 1)
    const trace = captured[0]
    assert.equal(trace.operation, 'select')
    assert.equal(trace.endpoint, '/gateway/fetch')
    assert.ok(trace.sql.includes('SELECT'))
    assert.ok(trace.sql.includes('FROM "users"'))
    assert.equal(trace.outcome?.status, 200)
    assert.equal(trace.outcome?.error, null)
    assert.ok(trace.callsite)
    assert.ok((trace.callsite?.fileName?.length ?? 0) > 0)
    assert.ok((trace.callsite?.filePath?.length ?? 0) > 0)
    assert.ok((trace.callsite?.line ?? 0) > 0)
    assert.ok((trace.callsite?.column ?? 0) > 0)
  } finally {
    globalThis.fetch = originalFetch
    console.info = originalInfo
  }
})

test('traceQueries custom logger receives upsert/rpc/query events', async () => {
  const captured: AthenaQueryTraceEvent[] = []
  const originalFetch = globalThis.fetch

  globalThis.fetch = async (url: string | URL) => {
    const normalizedUrl = String(url)
    if (normalizedUrl.endsWith('/gateway/insert')) {
      return createMockResponse([{ id: 11 }], 201)
    }
    if (normalizedUrl.endsWith('/gateway/rpc')) {
      return createMockResponse([{ id: 9 }], 200)
    }
    if (normalizedUrl.endsWith('/gateway/query')) {
      return createMockResponse([{ id: 7 }], 200)
    }
    return createMockResponse([], 200)
  }

  try {
    const client = createClient('https://athena-db.com', 'secret', {
      experimental: {
        traceQueries: {
          logger(event) {
            captured.push(event)
          },
        },
      },
    })

    await client
      .from('users')
      .upsert({ id: 1, name: 'Frodo' }, { onConflict: 'id', updateBody: { name: 'Frodo' } })
      .select('id')
    await client.rpc('list_users', { active: true }).eq('active', true).select('id')
    await client.query('select id from users')

    assert.equal(captured.length, 3)

    const upsertTrace = captured[0]
    assert.equal(upsertTrace.operation, 'upsert')
    assert.equal(upsertTrace.endpoint, '/gateway/insert')
    assert.ok(upsertTrace.sql.startsWith('INSERT INTO'))
    assert.ok(upsertTrace.sql.includes('ON CONFLICT'))

    const rpcTrace = captured[1]
    assert.equal(rpcTrace.operation, 'rpc')
    assert.equal(rpcTrace.endpoint, '/gateway/rpc')
    assert.ok(rpcTrace.sql.includes('FROM "list_users"'))

    const queryTrace = captured[2]
    assert.equal(queryTrace.operation, 'query')
    assert.equal(queryTrace.endpoint, '/gateway/query')
    assert.equal(queryTrace.sql, 'select id from users')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('traceQueries logs thrown rpc get validation failures', async () => {
  const captured: AthenaQueryTraceEvent[] = []
  const client = createClient('https://athena-db.com', 'secret', {
    experimental: {
      traceQueries: {
        logger(event) {
          captured.push(event)
        },
      },
    },
  })

  await assert.rejects(
    async () => {
      await client
        .rpc('list_users', { active: true }, { get: true })
        .eq('active', false)
        .select('id')
    },
    /conflicts with RPC argument "active"/,
  )

  assert.equal(captured.length, 1)
  const trace = captured[0]
  assert.equal(trace.operation, 'rpc')
  assert.ok(trace.thrownError)
  assert.equal(trace.outcome, undefined)
})
