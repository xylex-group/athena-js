import { strict as assert } from 'assert'
import { test } from 'node:test'
import { createClient } from '../src/client.ts'

type Captured = { url: string; init?: RequestInit }

function mockFetch() {
  const calls: Captured[] = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify({ data: [], status: 200 }), { status: 200 })
  }
  return { calls, restore: () => (globalThis.fetch = original) }
}

const client = createClient('https://athena-db.com', 'secret')

test('select defaults to * when columns omitted', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').select()
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.columns, '*')
  } finally {
    restore()
  }
})

test('select accepts array columns', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').select(['id', 'name'])
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.columns, ['id', 'name'])
  } finally {
    restore()
  }
})

test('offset before select is applied', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').offset(3).select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.offset, 3)
  } finally {
    restore()
  }
})

test('limit before select is applied', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').limit(7).select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.limit, 7)
  } finally {
    restore()
  }
})

test('reset clears filters and pagination', async () => {
  const { calls, restore } = mockFetch()
  try {
    const b = client.from('characters')
    b.eq('role', 'mage').limit(2)
    await b.reset().select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.conditions, undefined)
    assert.equal(payload.limit, undefined)
  } finally {
    restore()
  }
})

test('conditions are cloned per request', async () => {
  const { calls, restore } = mockFetch()
  try {
    const b = client.from('characters').eq('role', 'mage')
    await b.select('id')
    await b.select('name')
    const payload1 = JSON.parse(calls[0].init?.body as string)
    const payload2 = JSON.parse(calls[1].init?.body as string)
    assert.notStrictEqual(payload1.conditions, payload2.conditions)
  } finally {
    restore()
  }
})

test('delete honors eq id without resourceId option', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').eq('id', 1).delete()
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.conditions, [
      { operator: 'eq', column: 'id', value: 1, eq_column: 'id', eq_value: 1 },
    ])
  } finally {
    restore()
  }
})

test('update propagates strip_nulls default', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').eq('id', 1).update({ name: 'New' }).select()
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.strip_nulls, true)
  } finally {
    restore()
  }
})

test('update honors stripNulls override', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').eq('id', 1).update({ name: 'New' }).select('*', { stripNulls: false })
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.strip_nulls, false)
  } finally {
    restore()
  }
})

test('select honors stripNulls override', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').select('*', { stripNulls: false })
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.strip_nulls, false)
  } finally {
    restore()
  }
})

test('insert without select returns mutation promise', async () => {
  const { restore } = mockFetch()
  try {
    const mutation = client.from('characters').insert({ name: 'Frodo' })
    assert.equal(typeof mutation.then, 'function')
  } finally {
    restore()
  }
})

test('mutation select passes columns through', async () => {
  const { calls, restore } = mockFetch()
  try {
    const mutation = client.from('characters').insert({ name: 'Frodo' })
    await mutation.select('id,name')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.columns, 'id,name')
  } finally {
    restore()
  }
})

test('upsert forwards head/count to payload', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client
      .from('characters')
      .upsert({ id: 1, name: 'Aragorn' }, { head: true, count: 'planned' })
      .select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.head, true)
    assert.equal(payload.count, 'planned')
  } finally {
    restore()
  }
})

test('upsert merges defaultToNull', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client
      .from('characters')
      .upsert({ id: 1, name: 'Aragorn' }, { defaultToNull: true })
      .select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.default_to_null, true)
  } finally {
    restore()
  }
})

test('select with head option omits conditions when none set', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').select('*', { head: true })
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.conditions, undefined)
    assert.equal(payload.head, true)
  } finally {
    restore()
  }
})

test('single wraps select result', async () => {
  const { restore } = mockFetch()
  try {
    const result = await client.from('characters').select('id').single()
    assert.equal(result.data, null)
    assert.equal(result.error, null)
  } finally {
    restore()
  }
})

test('maybeSingle delegates to single', async () => {
  const { restore } = mockFetch()
  try {
    const result = await client.from('characters').select('id').maybeSingle()
    assert.equal(result.data, null)
    assert.equal(result.error, null)
  } finally {
    restore()
  }
})

test('delete with columns returns select columns', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').eq('id', 1).delete().select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.columns, 'id')
  } finally {
    restore()
  }
})

test('range overrides previous limit/offset', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').limit(1).range(2, 4).select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.offset, 2)
    assert.equal(payload.limit, 3)
  } finally {
    restore()
  }
})

test('match after other filters appends conditions', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client
      .from('characters')
      .gt('level', 1)
      .match({ role: 'mage' })
      .select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.conditions, [
      { operator: 'gt', column: 'level', value: 1 },
      { operator: 'eq', column: 'role', value: 'mage', eq_column: 'role', eq_value: 'mage' },
    ])
  } finally {
    restore()
  }
})

test('builder state is isolated per table', async () => {
  const { calls, restore } = mockFetch()
  try {
    client.from('characters').eq('role', 'mage')
    await client.from('orders').select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.conditions, undefined)
    assert.equal(payload.table_name, 'orders')
  } finally {
    restore()
  }
})

test('client.from returns new builder each call', async () => {
  const b1 = client.from('characters')
  const b2 = client.from('characters')
  assert.notStrictEqual(b1, b2)
})

test('update merges options from select call', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').eq('id', 1).update({ name: 'New' }).select('id', { count: 'exact' })
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.columns, 'id')
  } finally {
    restore()
  }
})

test('insert merges options from select call', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').insert({ name: 'Frodo' }).select('id', { head: true })
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.head, true)
  } finally {
    restore()
  }
})

test('upsert merges select options', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').upsert({ id: 1 }).select('id', { head: true, count: 'estimated' })
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.head, true)
    assert.equal(payload.count, 'estimated')
  } finally {
    restore()
  }
})

test('delete uses resourceId when provided alongside filters', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').eq('id', 1).delete({ resourceId: 'r-1' }).select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.resource_id, 'r-1')
    assert.deepEqual(payload.conditions, [
      { operator: 'eq', column: 'id', value: 1, eq_column: 'id', eq_value: 1 },
    ])
  } finally {
    restore()
  }
})

test('delete derives resource_id from eq(resource_id)', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').eq('resource_id', 'r-123').delete()
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.resource_id, 'r-123')
  } finally {
    restore()
  }
})

test('delete derives resource_id from eq(id)', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').eq('id', 42).delete()
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.resource_id, '42')
  } finally {
    restore()
  }
})

test('select with count option sets count field', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').select('*', { count: 'estimated' })
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.count, 'estimated')
  } finally {
    restore()
  }
})

test('update select passes columns into payload', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').eq('id', 1).update({ name: 'N' }).select('id,name')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.columns, 'id,name')
  } finally {
    restore()
  }
})

test('upsert supports onConflict array', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').upsert({ id: 1 }, { onConflict: ['id', 'name'] }).select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.on_conflict, ['id', 'name'])
  } finally {
    restore()
  }
})

test('insert select carries count option', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').insert({ name: 'F' }).select('*', { count: 'exact' })
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.count, 'exact')
  } finally {
    restore()
  }
})

test('range used after filters still sets limit/offset', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').eq('role', 'mage').range(1, 3).select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.offset, 1)
    assert.equal(payload.limit, 3)
  } finally {
    restore()
  }
})

test('or after filters appends to conditions', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').eq('role', 'mage').or('role.eq.warrior').select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.conditions, [
      { operator: 'eq', column: 'role', value: 'mage', eq_column: 'role', eq_value: 'mage' },
      { operator: 'or', value: 'role.eq.warrior' },
    ])
  } finally {
    restore()
  }
})

test('like after match keeps both conditions', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').match({ role: 'mage' }).like('name', '%a%').select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.conditions, [
      { operator: 'eq', column: 'role', value: 'mage', eq_column: 'role', eq_value: 'mage' },
      { operator: 'like', column: 'name', value: '%a%' },
    ])
  } finally {
    restore()
  }
})

test('canonical select filter order works: select(...).eq(...)', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client
      .from('instruments')
      .select('name,section_id')
      .eq('name', 'violin')

    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.table_name, 'instruments')
    assert.equal(payload.columns, 'name,section_id')
    assert.deepEqual(payload.conditions, [
      { operator: 'eq', column: 'name', value: 'violin', eq_column: 'name', eq_value: 'violin' },
    ])
  } finally {
    restore()
  }
})

test('canonical chained range filters work: gte + lt after select', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client
      .from('cities')
      .select('name,country_id')
      .gte('population', 1000)
      .lt('population', 10000)

    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.table_name, 'cities')
    assert.equal(payload.columns, 'name,country_id')
    assert.deepEqual(payload.conditions, [
      { operator: 'gte', column: 'population', value: 1000 },
      { operator: 'lt', column: 'population', value: 10000 },
    ])
  } finally {
    restore()
  }
})

test('select switches to structured transport for schema-qualified relation strings', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('chat_subscriptions').select('user_id,athena.user(id)')

    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.table_name, 'chat_subscriptions')
    assert.equal(payload.select, 'user_id,athena.user(id)')
    assert.equal(payload.columns, undefined)
    assert.equal(payload.where, undefined)
  } finally {
    restore()
  }
})

test('structured select transport forwards simple filters and ordering for schema-qualified relations', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client
      .from('chat_subscriptions')
      .eq('chat_id', 'chat_1')
      .order('created_at', { ascending: false })
      .limit(5)
      .select('user_id,athena.user(id)')

    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.select, 'user_id,athena.user(id)')
    assert.deepEqual(payload.where, {
      chat_id: {
        eq: 'chat_1',
      },
    })
    assert.deepEqual(payload.orderBy, {
      created_at: 'desc',
    })
    assert.equal(payload.limit, 5)
    assert.equal(payload.offset, undefined)
  } finally {
    restore()
  }
})

test('schema-qualified relation selects stay off query fallback for uuid-aware equality filters', async () => {
  const { calls, restore } = mockFetch()
  const userId = 'ce005658-dab5-438c-9814-6fecc796dd15'
  try {
    await client
      .from('public.chat_subscriptions')
      .eq('user_id', userId)
      .select('user_id,user:athena.user(id)')

    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.endsWith('/gateway/fetch'))
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.table_name, 'public.chat_subscriptions')
    assert.equal(payload.select, 'user_id,user:athena.user(id)')
    assert.deepEqual(payload.where, {
      user_id: {
        eq: userId,
      },
    })
    assert.equal(payload.strip_nulls, true)
    assert.equal(payload.columns, undefined)
  } finally {
    restore()
  }
})

test('schema-qualified relation select rejects unsupported structured-filter operators clearly', async () => {
  await assert.rejects(
    () =>
      client
        .from('chat_subscriptions')
        .gte('created_at', '2026-01-01T00:00:00Z')
        .select('user_id,athena.user(id)'),
    /only support eq, neq, gt, lt, and in filters/,
  )
})

test('schema-qualified relation select rejects head/count options clearly', async () => {
  await assert.rejects(
    () =>
      client.from('chat_subscriptions').select('user_id,athena.user(id)', {
        head: true,
      }),
    /does not support count\/head options/,
  )
})

test('findMany compiles nested select trees into gateway columns', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('orchestral_sections').findMany({
      select: {
        name: true,
        instruments: {
          select: {
            name: true,
          },
        },
      },
    })

    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.endsWith('/gateway/fetch'))
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.table_name, 'orchestral_sections')
    assert.equal(payload.columns, 'name,instruments(name)')
  } finally {
    restore()
  }
})

test('findMany supports aliased via relation nodes', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('messages').findMany({
      select: {
        sender: {
          as: 'from',
          via: 'sender_id',
          select: {
            name: true,
          },
        },
      },
    })

    assert.equal(calls.length, 1)
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.columns, 'from:sender_id(name)')
  } finally {
    restore()
  }
})

test('findMany relation nodes support explicit schema targeting', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('chat_subscriptions').findMany({
      select: {
        user_id: true,
        user: {
          schema: 'athena',
          select: {
            id: true,
          },
        },
      },
    })

    assert.equal(calls.length, 1)
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.table_name, 'chat_subscriptions')
    assert.equal(payload.select, 'user_id,user:athena.user(id)')
    assert.equal(payload.columns, undefined)
  } finally {
    restore()
  }
})

test('findMany relation nodes reject combining schema and via', async () => {
  await assert.rejects(
    () =>
      client.from('chat_subscriptions').findMany({
        select: {
          user: {
            schema: 'athena',
            via: 'user_id',
            select: {
              id: true,
            },
          },
        },
      }),
    /cannot combine schema and via yet/,
  )
})

test('findMany appends where conditions and overrides existing order/limit state', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client
      .from('orders')
      .eq('status', 'open')
      .limit(5)
      .order('created_at')
      .findMany({
        select: {
          id: true,
          total: true,
        },
        where: {
          customer_id: 'cust_1',
          total: {
            gte: 100,
          },
          or: [{ priority: 'high' }, { priority: 'urgent' }],
          not: {
            archived_at: {
              is: null,
            },
          },
        },
        orderBy: {
          created_at: 'desc',
        },
        limit: 25,
      })

    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.columns, 'id,total')
    assert.equal(payload.limit, 25)
    assert.deepEqual(payload.sort_by, {
      field: 'created_at',
      direction: 'descending',
    })
    assert.deepEqual(payload.conditions, [
      { operator: 'eq', column: 'status', value: 'open', eq_column: 'status', eq_value: 'open' },
      { operator: 'eq', column: 'customer_id', value: 'cust_1', eq_column: 'customer_id', eq_value: 'cust_1' },
      { operator: 'gte', column: 'total', value: 100 },
      { operator: 'or', value: 'priority.eq.high,priority.eq.urgent' },
      { operator: 'not', value: 'archived_at.is.null' },
    ])
  } finally {
    restore()
  }
})

test('findMany preserves uuid-aware equality fallback inside where objects', async () => {
  const { calls, restore } = mockFetch()
  const sessionId = '550e8400-e29b-41d4-a716-446655440000'
  try {
    await client.from('form_sessions').findMany({
      select: {
        session_id: true,
      },
      where: {
        session_id: sessionId,
      },
    })

    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.endsWith('/gateway/query'))
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.ok(payload.query.includes(`"session_id"::text = '${sessionId}'`))
  } finally {
    restore()
  }
})

test('findManyAst experimental flag normalizes shorthand where filters before fetch', async () => {
  const { calls, restore } = mockFetch()
  const client = createClient('https://athena-db.com', 'secret', {
    experimental: {
      findManyAst: true,
    },
  })
  try {
    await client.from('orders').findMany({
      select: {
        id: true,
      },
      where: {
        status: 'open',
      },
      orderBy: {
        created_at: 'asc',
      },
      limit: 1,
    })

    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.endsWith('/gateway/fetch'))
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload, {
      table_name: 'orders',
      select: {
        id: true,
      },
      where: {
        status: {
          eq: 'open',
        },
      },
      orderBy: {
        column: 'created_at',
        ascending: true,
      },
      limit: 1,
    })
  } finally {
    restore()
  }
})

test('findManyAst experimental flag preserves uuid-aware equality fallback inside where objects', async () => {
  const { calls, restore } = mockFetch()
  const client = createClient('https://athena-db.com', 'secret', {
    experimental: {
      findManyAst: true,
    },
  })
  const sessionId = '550e8400-e29b-41d4-a716-446655440000'
  try {
    await client.from('form_sessions').findMany({
      select: {
        session_id: true,
      },
      where: {
        session_id: sessionId,
      },
      limit: 1,
    })

    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.endsWith('/gateway/query'))
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.ok(payload.query.includes(`"session_id"::text = '${sessionId}'`))
  } finally {
    restore()
  }
})

test('findManyAst experimental flag falls back when relation nodes target an explicit schema', async () => {
  const { calls, restore } = mockFetch()
  const client = createClient('https://athena-db.com', 'secret', {
    experimental: {
      findManyAst: true,
    },
  })
  try {
    await client.from('chat_subscriptions').findMany({
      select: {
        user_id: true,
        user: {
          schema: 'athena',
          select: {
            id: true,
          },
        },
      },
    })

    assert.equal(calls.length, 1)
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.select, 'user_id,user:athena.user(id)')
    assert.equal(typeof payload.select, 'string')
    assert.equal(payload.columns, undefined)
  } finally {
    restore()
  }
})

test('findManyAst experimental flag falls back when chained filters already exist', async () => {
  const { calls, restore } = mockFetch()
  const client = createClient('https://athena-db.com', 'secret', {
    experimental: {
      findManyAst: true,
    },
  })
  try {
    await client.from('orders').eq('status', 'open').findMany({
      select: {
        id: true,
      },
    })

    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.endsWith('/gateway/fetch'))
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.columns, 'id')
    assert.deepEqual(payload.conditions, [
      { operator: 'eq', column: 'status', value: 'open', eq_column: 'status', eq_value: 'open' },
    ])
  } finally {
    restore()
  }
})

test('findMany rejects unsupported boolean AST shapes', async () => {
  await assert.rejects(
    () =>
      client.from('orders').findMany({
        select: {
          id: true,
        },
        where: {
          not: {
            status: {
              eq: 'open',
              neq: 'closed',
            },
          },
        },
      }),
    /findMany where\.not only supports a single lossless operator expression/,
  )
})

test('uuid-like eq on *_id uses query fallback with ::text comparison', async () => {
  const { calls, restore } = mockFetch()
  const sessionId = '550e8400-e29b-41d4-a716-446655440000'
  try {
    await client
      .from('form_sessions')
      .eq('session_id', sessionId)
      .limit(1)
      .select('*')

    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.endsWith('/gateway/query'))
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(typeof payload.query, 'string')
    assert.ok(payload.query.includes(`FROM "form_sessions"`))
    assert.ok(payload.query.includes(`"session_id"::text = '${sessionId}'`))
    assert.ok(payload.query.includes('LIMIT 1'))
  } finally {
    restore()
  }
})

test('eqUuid uses explicit ::uuid value cast', async () => {
  const { calls, restore } = mockFetch()
  const sessionId = '550e8400-e29b-41d4-a716-446655440000'
  try {
    await client
      .from('form_sessions')
      .eqUuid('session_id', sessionId)
      .select('*')

    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.endsWith('/gateway/query'))
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.ok(payload.query.includes(`"session_id" = '${sessionId}'::uuid`))
  } finally {
    restore()
  }
})

test('eqCast forwards explicit cast via query fallback', async () => {
  const { calls, restore } = mockFetch()
  const sessionId = '550e8400-e29b-41d4-a716-446655440000'
  try {
    await client
      .from('form_sessions')
      .eqCast('session_id', sessionId, 'uuid')
      .select('*')

    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.endsWith('/gateway/query'))
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.ok(payload.query.includes(`"session_id" = '${sessionId}'::uuid`))
  } finally {
    restore()
  }
})

test('non-uuid eq on *_id stays on /gateway/fetch', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('form_sessions').eq('session_id', 'not-a-uuid').select('*')

    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.endsWith('/gateway/fetch'))
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.conditions, [
      { operator: 'eq', column: 'session_id', value: 'not-a-uuid', eq_column: 'session_id', eq_value: 'not-a-uuid' },
    ])
  } finally {
    restore()
  }
})

test('currentPage and pageSize serialize as current_page and page_size on select', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('orders').select('id, total').currentPage(2).pageSize(25)
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.current_page, 2)
    assert.equal(payload.page_size, 25)
  } finally {
    restore()
  }
})

test('totalPages serializes as total_pages on select', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('orders').select('id').totalPages(10)
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.total_pages, 10)
  } finally {
    restore()
  }
})

test('currentPage/pageSize/totalPages combine with limit on select', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client
      .from('orders')
      .select('id')
      .currentPage(1)
      .pageSize(50)
      .totalPages(4)
      .limit(50)
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.current_page, 1)
    assert.equal(payload.page_size, 50)
    assert.equal(payload.total_pages, 4)
    assert.equal(payload.limit, 50)
  } finally {
    restore()
  }
})

test('pagination helpers work before .select()', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('orders').currentPage(3).pageSize(20).totalPages(12).select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.current_page, 3)
    assert.equal(payload.page_size, 20)
    assert.equal(payload.total_pages, 12)
  } finally {
    restore()
  }
})

test('update chain forwards currentPage/pageSize/totalPages', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client
      .from('characters')
      .update({ level: 10 })
      .eq('role', 'mage')
      .currentPage(2)
      .pageSize(10)
      .totalPages(5)
      .select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.set, { level: 10 })
    assert.equal(payload.current_page, 2)
    assert.equal(payload.page_size, 10)
    assert.equal(payload.total_pages, 5)
  } finally {
    restore()
  }
})

test('select without pagination helpers omits page fields', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('orders').select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.current_page, undefined)
    assert.equal(payload.page_size, undefined)
    assert.equal(payload.total_pages, undefined)
  } finally {
    restore()
  }
})

test('reset clears currentPage/pageSize/totalPages', async () => {
  const { calls, restore } = mockFetch()
  try {
    const b = client.from('orders')
    b.currentPage(2).pageSize(25).totalPages(4)
    await b.reset().select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.current_page, undefined)
    assert.equal(payload.page_size, undefined)
    assert.equal(payload.total_pages, undefined)
  } finally {
    restore()
  }
})

test('select chain supports .order() after .select() (desc) with limit', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client
      .from('rsf_messages')
      .eq('room_id', '31')
      .select('*', { stripNulls: false })
      .order('created_at', { ascending: false })
      .limit(100)

    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.table_name, 'rsf_messages')
    assert.equal(payload.columns, '*')
    assert.equal(payload.strip_nulls, false)
    assert.equal(payload.limit, 100)
    assert.deepEqual(payload.sort_by, { field: 'created_at', direction: 'descending' })
    assert.deepEqual(payload.conditions, [
      { operator: 'eq', column: 'room_id', value: '31', eq_column: 'room_id', eq_value: '31' },
    ])
  } finally {
    restore()
  }
})

test('order defaults to ascending when options omitted', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').select('id').order('created_at')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.sort_by, { field: 'created_at', direction: 'ascending' })
  } finally {
    restore()
  }
})

test('order defaults to ascending when { ascending: true }', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').select('id').order('created_at', { ascending: true })
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.sort_by, { field: 'created_at', direction: 'ascending' })
  } finally {
    restore()
  }
})

test('order before .select() is also serialized', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client
      .from('characters')
      .order('level', { ascending: false })
      .eq('role', 'mage')
      .select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.sort_by, { field: 'level', direction: 'descending' })
  } finally {
    restore()
  }
})

test('select without .order() omits sort_by from payload', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('characters').select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.sort_by, undefined)
  } finally {
    restore()
  }
})

test('update chain supports .order() and serializes sort_by', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client
      .from('characters')
      .update({ name: 'Renamed' })
      .eq('role', 'mage')
      .order('created_at', { ascending: false })
      .select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.set, { name: 'Renamed' })
    assert.deepEqual(payload.sort_by, { field: 'created_at', direction: 'descending' })
  } finally {
    restore()
  }
})

test('reset clears .order() state', async () => {
  const { calls, restore } = mockFetch()
  try {
    const b = client.from('characters')
    b.order('created_at', { ascending: false })
    await b.reset().select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.sort_by, undefined)
  } finally {
    restore()
  }
})

test('table select options support schema qualification', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('users').select('id', { schema: 'auth' })
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.table_name, 'auth.users')
  } finally {
    restore()
  }
})

test('from options support schema qualification for selects', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('users', { schema: 'auth' }).select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.table_name, 'auth.users')
  } finally {
    restore()
  }
})

test('from options support schema qualification for findMany base tables', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('chat_subscriptions', { schema: 'public' }).findMany({
      select: {
        user_id: true,
        user: {
          schema: 'athena',
          select: {
            id: true,
          },
        },
      },
    })

    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.table_name, 'public.chat_subscriptions')
    assert.equal(payload.select, 'user_id,user:athena.user(id)')
  } finally {
    restore()
  }
})

test('table mutation select options support schema qualification', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client
      .from('users')
      .insert({ id: 'u-1' })
      .select('id', { schema: 'auth' })
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.table_name, 'auth.users')
  } finally {
    restore()
  }
})

test('from options reject conflicting schema-qualified tables immediately', () => {
  assert.throws(
    () => client.from('public.users', { schema: 'athena' }),
    /schema option "athena" conflicts with schema-qualified table "public.users"/,
  )
})

test('table options keep pre-qualified table when schema matches', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('public.users').select('id', { schema: 'public' })
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.table_name, 'public.users')
  } finally {
    restore()
  }
})

test('table options keep quoted pre-qualified table when schema matches', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('"public"."users"').select('id', { schema: 'public' })
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.table_name, '"public"."users"')
  } finally {
    restore()
  }
})

test('table options deduplicate matching schema for insert/upsert/update/delete', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client
      .from('"public"."users"')
      .insert({ id: 'u-1' })
      .select('id', { schema: 'public' })

    await client
      .from('"public"."users"')
      .upsert({ id: 'u-1' })
      .select('id', { schema: 'public' })

    await client
      .from('"public"."users"')
      .eq('id', 'u-1')
      .update({ id: 'u-2' })
      .select('id', { schema: 'public' })

    await client
      .from('"public"."users"')
      .eq('id', 'u-2')
      .delete({ schema: 'public' })

    const tableNames = calls.map(call => JSON.parse(call.init?.body as string).table_name)
    assert.deepEqual(tableNames, [
      '"public"."users"',
      '"public"."users"',
      '"public"."users"',
      '"public"."users"',
    ])
  } finally {
    restore()
  }
})

test('table options compare unquoted schema names case-insensitively', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.from('Public.users').select('id', { schema: 'public' })
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.table_name, 'Public.users')
  } finally {
    restore()
  }
})

test('table options reject conflicting schema and schema-qualified table', async () => {
  await assert.rejects(
    async () => client.from('public.users').select('id', { schema: 'athena' }),
    /schema option "athena" conflicts with schema-qualified table "public.users"/,
  )
})

test('typed equality query fallback uses schema-qualified table name', async () => {
  const { calls, restore } = mockFetch()
  const sessionId = '550e8400-e29b-41d4-a716-446655440000'
  try {
    await client
      .from('form_sessions')
      .eqUuid('session_id', sessionId)
      .select('*', { schema: 'athena' })

    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.endsWith('/gateway/query'))
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.ok(payload.query.includes('FROM "athena"."form_sessions"'))
  } finally {
    restore()
  }
})

test('rpc is awaitable and executes once', async () => {
  const { calls, restore } = mockFetch()
  try {
    const rpc = client.rpc('list_characters', { active_only: true })
    assert.equal(typeof rpc.then, 'function')
    await rpc
    await rpc
    assert.equal(calls.length, 1)
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.function, 'list_characters')
    assert.deepEqual(payload.args, { active_only: true })
  } finally {
    restore()
  }
})

test('rpc chain builds strict filters and selection payload', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client
      .rpc('list_characters', { scope: 'all' })
      .eq('role', 'mage')
      .gt('level', 10)
      .ilike('name', '%ar%')
      .in('status', ['active', 'pending'])
      .select(['id', 'name'])

    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.function, 'list_characters')
    assert.equal(payload.select, 'id,name')
    assert.deepEqual(payload.filters, [
      { column: 'role', operator: 'eq', value: 'mage' },
      { column: 'level', operator: 'gt', value: 10 },
      { column: 'name', operator: 'ilike', value: '%ar%' },
      { column: 'status', operator: 'in', value: ['active', 'pending'] },
    ])
  } finally {
    restore()
  }
})

test('rpc order, limit, and offset map to payload', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client
      .rpc('list_characters')
      .order('created_at', { ascending: false })
      .range(10, 19)
      .select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.order, { column: 'created_at', ascending: false })
    assert.equal(payload.offset, 10)
    assert.equal(payload.limit, 10)
  } finally {
    restore()
  }
})

test('rpc count exact is sent and surfaced on result', async () => {
  const original = globalThis.fetch
  const calls: Captured[] = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify({ data: [{ id: 1 }], count: 7 }), { status: 200 })
  }
  try {
    const result = await client.rpc<{ id: number }>('list_characters', undefined, { count: 'exact' }).select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.count, 'exact')
    assert.equal(result.count, 7)
    assert.deepEqual(result.data, [{ id: 1 }])
  } finally {
    globalThis.fetch = original
  }
})

test('rpc supports planned and estimated count options', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.rpc('list_characters').select('id', { count: 'planned' })
    await client.rpc('list_characters').select('id', { count: 'estimated' })
    const first = JSON.parse(calls[0].init?.body as string)
    const second = JSON.parse(calls[1].init?.body as string)
    assert.equal(first.count, 'planned')
    assert.equal(second.count, 'estimated')
  } finally {
    restore()
  }
})

test('rpc head option is forwarded to payload', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.rpc('list_characters').select('id', { head: true })
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.head, true)
  } finally {
    restore()
  }
})

test('rpc single and maybeSingle return first row', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [{ id: 1, name: 'Aragorn' }, { id: 2, name: 'Legolas' }] }), {
      status: 200,
    })
  try {
    const single = await client.rpc<{ id: number; name: string }>('list_characters').single('id,name')
    const maybe = await client.rpc<{ id: number; name: string }>('list_characters').maybeSingle('id,name')
    assert.deepEqual(single.data, { id: 1, name: 'Aragorn' })
    assert.deepEqual(maybe.data, { id: 1, name: 'Aragorn' })
  } finally {
    globalThis.fetch = original
  }
})

test('rpc table-return filters with single are supported', async () => {
  const original = globalThis.fetch
  const calls: Captured[] = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify({ data: [{ id: 1, name: 'Rohan' }] }), {
      status: 200,
    })
  }
  try {
    const result = await client
      .rpc<{ id: number; name: string }>('list_stored_countries')
      .eq('id', 1)
      .single()

    assert.deepEqual(result.data, { id: 1, name: 'Rohan' })
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.function, 'list_stored_countries')
    assert.deepEqual(payload.filters, [{ column: 'id', operator: 'eq', value: 1 }])
  } finally {
    globalThis.fetch = original
  }
})

test('rpc throws when function name is blank', () => {
  assert.throws(
    () => client.rpc('   '),
    /rpc requires a function name/,
  )
})

test('rpc select-level options override constructor options', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client
      .rpc('list_characters', { scope: 'all' }, { schema: 'public' })
      .select('id', { schema: 'private', count: 'exact' })

    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.schema, 'private')
    assert.equal(payload.count, 'exact')
  } finally {
    restore()
  }
})

test('rpc get mode calls compatibility endpoint with filters', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client
      .rpc('list_characters', { role: 'admin' }, { get: true, schema: 'public' })
      .eq('active', true)
      .order('created_at', { ascending: false })
      .range(2, 6)
      .select('id,name', { count: 'planned', head: true })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].init?.method, 'GET')
    assert.ok(calls[0].url.includes('/rpc/list_characters?'))

    const url = new URL(calls[0].url)
    assert.equal(url.searchParams.get('role'), 'admin')
    assert.equal(url.searchParams.get('schema'), 'public')
    assert.equal(url.searchParams.get('active'), 'eq.true')
    assert.equal(url.searchParams.get('order'), 'created_at.desc')
    assert.equal(url.searchParams.get('limit'), '5')
    assert.equal(url.searchParams.get('offset'), '2')
    assert.equal(url.searchParams.get('select'), 'id,name')
    assert.equal(url.searchParams.get('count'), 'planned')
    assert.equal(url.searchParams.get('head'), 'true')
  } finally {
    restore()
  }
})

test('rpc select-level count can be set without constructor options', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.rpc('list_characters').select('id', { count: 'exact' })
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.count, 'exact')
  } finally {
    restore()
  }
})

test('rpc order defaults ascending to true when not provided', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.rpc('list_characters').order('created_at').select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.order, { column: 'created_at', ascending: true })
  } finally {
    restore()
  }
})

test('rpc with no filters omits filters field', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client.rpc('list_characters').select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.filters, undefined)
  } finally {
    restore()
  }
})

test('rpc result with count keeps count after single()', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [{ id: 1 }], count: 3 }), { status: 200 })
  try {
    const result = await client.rpc<{ id: number }>('list_characters').single('id')
    assert.equal(result.count, 3)
    assert.deepEqual(result.data, { id: 1 })
  } finally {
    globalThis.fetch = original
  }
})

test('query calls /gateway/query with { query } payload', async () => {
  const { calls, restore } = mockFetch()
  try {
    const result = await client.query('select * from characters')
    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.endsWith('/gateway/query'))
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload, { query: 'select * from characters' })
    assert.deepEqual(result.data, [])
    assert.equal(result.status, 200)
    assert.equal(result.error, null)
  } finally {
    restore()
  }
})

test('query handles error propagation', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'invalid syntax', status: 400 }), {
      status: 400,
    })
  try {
    const result = await client.query('select * from syntax_error')
    assert.equal(result.data, null)
    assert.equal(result.status, 400)
    assert.equal(result.error?.message, 'invalid syntax')
  } finally {
    globalThis.fetch = original
  }
})

test('experimental.retryReads retries select after a retryable network failure', async () => {
  let attempts = 0
  const original = globalThis.fetch
  globalThis.fetch = async () => {
    attempts += 1
    if (attempts === 1) {
      throw new Error('temporary network issue')
    }
    return new Response(JSON.stringify([{ id: 1 }]), { status: 200 })
  }

  try {
    const retryingClient = createClient('https://athena-db.com', 'secret', {
      experimental: {
        retryReads: true,
      },
    })
    const result = await retryingClient.from('characters').select('id').limit(1)

    assert.equal(attempts, 2)
    assert.equal(result.status, 200)
    assert.deepEqual(result.data, [{ id: 1 }])
    assert.equal(result.error, null)
  } finally {
    globalThis.fetch = original
  }
})

test('experimental.retryReads retries query after a retryable network failure', async () => {
  let attempts = 0
  const original = globalThis.fetch
  globalThis.fetch = async () => {
    attempts += 1
    if (attempts === 1) {
      throw new Error('temporary network issue')
    }
    return new Response(JSON.stringify([{ id: 1 }]), { status: 200 })
  }

  try {
    const retryingClient = createClient('https://athena-db.com', 'secret', {
      experimental: {
        retryReads: true,
      },
    })
    const result = await retryingClient.query('select id from characters')

    assert.equal(attempts, 2)
    assert.equal(result.status, 200)
    assert.deepEqual(result.data, [{ id: 1 }])
    assert.equal(result.error, null)
  } finally {
    globalThis.fetch = original
  }
})

test('experimental.retryReads retries findManyAst reads after a retryable network failure', async () => {
  let attempts = 0
  const original = globalThis.fetch
  globalThis.fetch = async () => {
    attempts += 1
    if (attempts === 1) {
      throw new Error('temporary network issue')
    }
    return new Response(JSON.stringify([{ id: 1 }]), { status: 200 })
  }

  try {
    const retryingClient = createClient('https://athena-db.com', 'secret', {
      experimental: {
        retryReads: true,
        findManyAst: true,
      },
    })
    const result = await retryingClient.from('characters').findMany({
      select: {
        id: true,
      },
      limit: 1,
    })

    assert.equal(attempts, 2)
    assert.equal(result.status, 200)
    assert.deepEqual(result.data, [{ id: 1 }])
    assert.equal(result.error, null)
  } finally {
    globalThis.fetch = original
  }
})

test('experimental.retryReads does not retry writes by default', async () => {
  let attempts = 0
  const original = globalThis.fetch
  globalThis.fetch = async () => {
    attempts += 1
    throw new Error('temporary network issue')
  }

  try {
    const retryingClient = createClient('https://athena-db.com', 'secret', {
      experimental: {
        retryReads: true,
      },
    })
    const result = await retryingClient.from('characters').insert({ id: 1 }).select('id')

    assert.equal(attempts, 1)
    assert.equal(result.status, 0)
    assert.equal(result.error?.retryable, true)
  } finally {
    globalThis.fetch = original
  }
})
