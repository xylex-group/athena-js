import { strict as assert } from 'assert'
import { test } from 'node:test'
import { createClient } from '../src/supabase.ts'

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
