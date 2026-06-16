import { strict as assert } from 'assert'
import { test } from 'node:test'
import { createClient, type AthenaQueryTraceEvent } from '../src/client.ts'

function createMockResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

function getCurrentLine(): number {
  const frame = new Error().stack?.split('\n')[2]?.trim()
  assert.ok(frame, 'expected stack frame for line capture')
  const match = frame.match(/:(\d+):\d+\)?$/)
  assert.ok(match, `expected line info in stack frame: ${frame}`)
  return Number(match[1])
}

function assertUserCallsite(trace: AthenaQueryTraceEvent, expectedLine: number) {
  assert.ok(trace.callsite)
  assert.equal(trace.callsite?.fileName, 'query-trace.test.ts')
  assert.match(trace.callsite?.filePath?.replace(/\\/g, '/') ?? '', /\/test\/query-trace\.test\.ts$/)
  assert.equal(trace.callsite?.line, expectedLine)
  assert.ok((trace.callsite?.column ?? 0) > 0)
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

    const selectLine = getCurrentLine() + 1
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
    assertUserCallsite(trace, selectLine)
  } finally {
    globalThis.fetch = originalFetch
    console.info = originalInfo
  }
})

test('traceQueries captures direct single and findMany callsites at the public API seam', async () => {
  const captured: AthenaQueryTraceEvent[] = []
  const originalFetch = globalThis.fetch

  globalThis.fetch = async () => createMockResponse([{ id: 1 }], 200)

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

    const singleLine = getCurrentLine() + 1
    await client.from('users').eq('id', 1).single('id')
    const findManyLine = getCurrentLine() + 1
    await client.from('users').findMany({
      select: {
        id: true,
      },
      limit: 1,
    })

    assert.equal(captured.length, 2)
    assert.equal(captured[0].operation, 'select')
    assert.equal(captured[1].operation, 'select')
    assertUserCallsite(captured[0], singleLine)
    assertUserCallsite(captured[1], findManyLine)
  } finally {
    globalThis.fetch = originalFetch
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

    const upsertMutation = client
      .from('users')
      .upsert({ id: 1, name: 'Frodo' }, { onConflict: 'id', updateBody: { name: 'Frodo' } })
    const upsertLine = getCurrentLine() + 1
    await upsertMutation.select('id')

    const rpcQuery = client.rpc('list_users', { active: true }).eq('active', true)
    const rpcLine = getCurrentLine() + 1
    await rpcQuery.select('id')

    const queryLine = getCurrentLine() + 1
    await client.query('select id from users')

    assert.equal(captured.length, 3)

    const upsertTrace = captured[0]
    assert.equal(upsertTrace.operation, 'upsert')
    assert.equal(upsertTrace.endpoint, '/gateway/insert')
    assert.ok(upsertTrace.sql.startsWith('INSERT INTO'))
    assert.ok(upsertTrace.sql.includes('ON CONFLICT'))
    assertUserCallsite(upsertTrace, upsertLine)

    const rpcTrace = captured[1]
    assert.equal(rpcTrace.operation, 'rpc')
    assert.equal(rpcTrace.endpoint, '/gateway/rpc')
    assert.ok(rpcTrace.sql.includes('FROM "list_users"'))
    assertUserCallsite(rpcTrace, rpcLine)

    const queryTrace = captured[2]
    assert.equal(queryTrace.operation, 'query')
    assert.equal(queryTrace.endpoint, '/gateway/query')
    assert.equal(queryTrace.sql, 'select id from users')
    assertUserCallsite(queryTrace, queryLine)
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

  const invalidRpcQuery = client.rpc('list_users', { active: true }, { get: true }).eq('active', false)
  let invalidRpcLine = 0

  await assert.rejects(
    async () => {
      invalidRpcLine = getCurrentLine() + 1
      await invalidRpcQuery.select('id')
    },
    /conflicts with RPC argument "active"/,
  )

  assert.equal(captured.length, 1)
  const trace = captured[0]
  assert.equal(trace.operation, 'rpc')
  assert.ok(trace.thrownError)
  assert.equal(trace.outcome, undefined)
  assertUserCallsite(trace, invalidRpcLine)
})

test('traceQueries includes debug ASTs when experimental.debugAst is enabled', async () => {
  const captured: AthenaQueryTraceEvent[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => createMockResponse([{ id: 1 }], 200)

  try {
    const client = createClient('https://athena-db.com', 'secret', {
      experimental: {
        debugAst: true,
        traceQueries: {
          logger(event) {
            captured.push(event)
          },
        },
      },
    })

    await client.from('users').eq('id', 1).select('id')

    const invalidRpcQuery = client.rpc('list_users', { active: true }, { get: true }).eq('active', false)
    await assert.rejects(() => invalidRpcQuery.select('id'), /conflicts with RPC argument "active"/)

    assert.equal(captured.length, 2)
    assert.equal(captured[0].ast?.kind, 'select')
    assert.equal(captured[0].ast?.transport.endpoint, '/gateway/fetch')
    assert.equal(captured[1].ast?.kind, 'rpc')
    assert.equal(captured[1].ast?.transport.mode, 'rpc-get')
    assert.ok(captured[1].thrownError)
  } finally {
    globalThis.fetch = originalFetch
  }
})
