import { strict as assert } from 'assert'
import { test } from 'node:test'
import { createClient } from '../src/supabase.ts'

type Captured = { url: string; init?: RequestInit }

function withMockFetch(fn: (calls: Captured[]) => Promise<void> | void) {
  return async () => {
    const calls: Captured[] = []
    const original = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify({ data: [], status: 200 }), { status: 200 })
    }
    try {
      await fn(calls)
    } finally {
      globalThis.fetch = original
    }
  }
}

const client = createClient('https://athena-db.com', 'secret')

test(
  'range sets limit/offset',
  withMockFetch(async (calls) => {
    await client.from('characters').range(5, 9).select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.offset, 5)
    assert.equal(payload.limit, 5)
  }),
)

test(
  'match expands to multiple eq conditions',
  withMockFetch(async (calls) => {
    await client.from('characters').match({ role: 'mage', active: true }).select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.conditions, [
      { operator: 'eq', column: 'role', value: 'mage', eq_column: 'role', eq_value: 'mage' },
      { operator: 'eq', column: 'active', value: true, eq_column: 'active', eq_value: true },
    ])
  }),
)

test(
  'not with operator/value encodes dot syntax',
  withMockFetch(async (calls) => {
    await client.from('characters').not('role', 'eq', 'banned').select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.conditions, [{ operator: 'not', value: 'role.eq.banned' }])
  }),
)

test(
  'not with raw expression passes through',
  withMockFetch(async (calls) => {
    await client.from('characters').not('role.eq.banned').select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.conditions, [{ operator: 'not', value: 'role.eq.banned' }])
  }),
)

test(
  'or expression is forwarded',
  withMockFetch(async (calls) => {
    await client.from('characters').or('role.eq.warrior,role.eq.mage').select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.conditions, [{ operator: 'or', value: 'role.eq.warrior,role.eq.mage' }])
  }),
)

test(
  'gt/gte/lt/lte payloads',
  withMockFetch(async (calls) => {
    await client
      .from('characters')
      .gt('level', 1)
      .gte('level', 2)
      .lt('level', 10)
      .lte('level', 20)
      .select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.conditions, [
      { operator: 'gt', column: 'level', value: 1 },
      { operator: 'gte', column: 'level', value: 2 },
      { operator: 'lt', column: 'level', value: 10 },
      { operator: 'lte', column: 'level', value: 20 },
    ])
  }),
)

test(
  'like/ilike payloads',
  withMockFetch(async (calls) => {
    await client.from('characters').like('name', '%a%').ilike('title', '%war%').select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.conditions, [
      { operator: 'like', column: 'name', value: '%a%' },
      { operator: 'ilike', column: 'title', value: '%war%' },
    ])
  }),
)

test(
  'is null payload',
  withMockFetch(async (calls) => {
    await client.from('characters').is('deleted_at', null).select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.conditions, [{ operator: 'is', column: 'deleted_at', value: null }])
  }),
)

test(
  'in array payload',
  withMockFetch(async (calls) => {
    await client.from('characters').in('role', ['mage', 'warrior']).select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.conditions, [
      { operator: 'in', column: 'role', value: ['mage', 'warrior'] },
    ])
  }),
)

test(
  'contains payload',
  withMockFetch(async (calls) => {
    await client.from('characters').contains('tags', ['a']).select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.conditions, [{ operator: 'contains', column: 'tags', value: ['a'] }])
  }),
)

test(
  'containedBy payload',
  withMockFetch(async (calls) => {
    await client.from('characters').containedBy('tags', ['a', 'b']).select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.conditions, [
      { operator: 'containedBy', column: 'tags', value: ['a', 'b'] },
    ])
  }),
)

test(
  'offset/limit chaining after filters',
  withMockFetch(async (calls) => {
    await client.from('characters').eq('role', 'mage').limit(5).offset(10).select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.limit, 5)
    assert.equal(payload.offset, 10)
    assert.deepEqual(payload.conditions, [
      { operator: 'eq', column: 'role', value: 'mage', eq_column: 'role', eq_value: 'mage' },
    ])
  }),
)

test(
  'defaultToNull option passes to insert',
  withMockFetch(async (calls) => {
    await client
      .from('characters')
      .insert({ name: 'Bilbo' }, { defaultToNull: true })
      .select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.default_to_null, true)
  }),
)

test(
  'count/head options pass through select',
  withMockFetch(async (calls) => {
    await client.from('characters').select('id', { count: 'exact', head: true })
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.count, 'exact')
    assert.equal(payload.head, true)
  }),
)

test(
  'upsert propagates update_body and on_conflict',
  withMockFetch(async (calls) => {
    await client
      .from('characters')
      .upsert({ id: 1, name: 'Aragorn' }, { updateBody: { name: 'Strider' }, onConflict: 'id' })
      .select('id')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.insert_body, { id: 1, name: 'Aragorn' })
    assert.deepEqual(payload.update_body, { name: 'Strider' })
    assert.equal(payload.on_conflict, 'id')
  }),
)

test(
  'delete without filters throws',
  async () => {
    const builder = client.from('characters')
    let threw = false
    try {
      // @ts-expect-error testing runtime throw
      builder.delete()
    } catch {
      threw = true
    }
    assert.equal(threw, true, 'delete() without filters should throw')
  },
)

test(
  'delete with resourceId option skips throw',
  withMockFetch(async (calls) => {
    await client.from('characters').delete({ resourceId: 'abc' })
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.equal(payload.resource_id, 'abc')
  }),
)
