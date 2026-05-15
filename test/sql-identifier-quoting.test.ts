import { strict as assert } from 'assert'
import { test } from 'node:test'
import { createClient } from '../src/client.ts'

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

const client = createClient('https://athena-db.com', 'secret')

test('query fallback quotes reserved-word columns from array selection', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client
      .from('public.type_lab')
      .eqCast('id', '550e8400-e29b-41d4-a716-446655440000', 'uuid')
      .select(['table', 'user', 'order'])

    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.endsWith('/gateway/query'))
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.ok(payload.query.includes('SELECT "table", "user", "order" FROM "public"."type_lab"'))
  } finally {
    restore()
  }
})

test('query fallback quotes mixed-case and spaced identifiers', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client
      .from('analytics.type_lab')
      .eqCast('id', '550e8400-e29b-41d4-a716-446655440000', 'uuid')
      .select(['MixedCase', 'space name'])

    const payload = JSON.parse(calls[0].init?.body as string)
    assert.ok(payload.query.includes('SELECT "MixedCase", "space name" FROM "analytics"."type_lab"'))
  } finally {
    restore()
  }
})

test('query fallback quotes simple comma-separated identifier strings', async () => {
  const { calls, restore } = mockFetch()
  try {
    await client
      .from('public.type_lab')
      .eqCast('id', '550e8400-e29b-41d4-a716-446655440000', 'uuid')
      .select('table, user, order')

    const payload = JSON.parse(calls[0].init?.body as string)
    assert.ok(payload.query.includes('SELECT "table", "user", "order" FROM "public"."type_lab"'))
  } finally {
    restore()
  }
})
