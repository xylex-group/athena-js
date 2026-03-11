import { strict as assert } from 'assert'
import { test } from 'node:test'
import { createAthenaGatewayClient } from '../src/gateway/client.ts'

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

test('buildHeaders sets client and strip nulls by default', () => {
  const client = createAthenaGatewayClient({ client: 'c1' })
  const headers = client.buildHeaders()
  assert.equal(headers['X-Athena-Client'], 'c1')
  assert.equal(headers['X-Strip-Nulls'], 'true')
})

test('buildHeaders sets api key', () => {
  const client = createAthenaGatewayClient({ apiKey: 'k1' })
  const headers = client.buildHeaders()
  assert.equal(headers['apikey'], 'k1')
  assert.equal(headers['x-api-key'], 'k1')
})

test('buildHeaders merges custom headers and preserves athena client', () => {
  const client = createAthenaGatewayClient({
    client: 'c1',
    headers: { 'X-Custom': 'v', 'x-athena-client': 'ignored' },
  })
  const headers = client.buildHeaders()
  assert.equal(headers['X-Athena-Client'], 'c1')
  assert.equal(headers['X-Custom'], 'v')
})

test('buildHeaders forwards publish event', () => {
  const client = createAthenaGatewayClient({ publishEvent: 'evt' })
  const headers = client.buildHeaders()
  assert.equal(headers['X-Publish-Event'], 'evt')
})

test('buildHeaders sets backend type', () => {
  const client = createAthenaGatewayClient({ backend: { type: 'supabase' } })
  const headers = client.buildHeaders()
  assert.equal(headers['X-Backend-Type'], 'supabase')
})

test('buildHeaders accepts stripNulls override', () => {
  const client = createAthenaGatewayClient({})
  const headers = client.buildHeaders({ stripNulls: false })
  assert.equal(headers['X-Strip-Nulls'], 'false')
})

test('buildHeaders sets user and organization ids', () => {
  const client = createAthenaGatewayClient({ userId: 'u1', organizationId: 'o1' })
  const headers = client.buildHeaders()
  assert.equal(headers['X-User-Id'], 'u1')
  assert.equal(headers['X-Organization-Id'], 'o1')
})

test('buildHeaders allows overriding client per call', () => {
  const client = createAthenaGatewayClient({ client: 'base' })
  const headers = client.buildHeaders({ client: 'override' })
  assert.equal(headers['X-Athena-Client'], 'override')
})

test('buildHeaders per-call userId overrides config', () => {
  const client = createAthenaGatewayClient({ userId: 'u1' })
  const headers = client.buildHeaders({ userId: 'u2' })
  assert.equal(headers['X-User-Id'], 'u2')
})

test('buildHeaders per-call organizationId overrides config', () => {
  const client = createAthenaGatewayClient({ organizationId: 'o1' })
  const headers = client.buildHeaders({ organizationId: 'o2' })
  assert.equal(headers['X-Organization-Id'], 'o2')
})

test('buildHeaders honors stripNulls true per-call', () => {
  const client = createAthenaGatewayClient({})
  const headers = client.buildHeaders({ stripNulls: true })
  assert.equal(headers['X-Strip-Nulls'], 'true')
})

test('fetchGateway uses default client header when none provided', async () => {
  const { calls, restore } = mockFetch()
  try {
    const client = createAthenaGatewayClient({})
    await client.fetchGateway({ table_name: 't' })
    const headers = calls[0].init?.headers as Record<string, string>
    assert.ok(headers['X-Athena-Client'], 'default client header should be set')
  } finally {
    restore()
  }
})

test('buildHeaders per-call apiKey overrides config', () => {
  const client = createAthenaGatewayClient({ apiKey: 'base' })
  const headers = client.buildHeaders({ apiKey: 'override' })
  assert.equal(headers['apikey'], 'override')
})

test('buildHeaders per-call publishEvent overrides config', () => {
  const client = createAthenaGatewayClient({ publishEvent: 'base' })
  const headers = client.buildHeaders({ publishEvent: 'override' })
  assert.equal(headers['X-Publish-Event'], 'override')
})

test('buildHeaders merges options headers', () => {
  const client = createAthenaGatewayClient({ headers: { 'X-Config': '1' } })
  const headers = client.buildHeaders({ headers: { 'X-Call': '2' } })
  assert.equal(headers['X-Config'], '1')
  assert.equal(headers['X-Call'], '2')
})

test('buildHeaders keeps stripNulls default when option undefined', () => {
  const client = createAthenaGatewayClient({})
  const headers = client.buildHeaders({})
  assert.equal(headers['X-Strip-Nulls'], 'true')
})

test('buildHeaders sets backend when string provided', () => {
  const client = createAthenaGatewayClient({ backend: 'postgresql' })
  const headers = client.buildHeaders()
  assert.equal(headers['X-Backend-Type'], 'postgresql')
})

test('fetchGateway trims baseUrl trailing slash', async () => {
  const { calls, restore } = mockFetch()
  try {
    const client = createAthenaGatewayClient({ baseUrl: 'https://athena-db.com/' })
    await client.fetchGateway({ table_name: 't' })
    assert.ok(calls[0].url.endsWith('/gateway/fetch'))
    assert.equal(calls[0].init?.method, 'POST')
  } finally {
    restore()
  }
})

test('fetchGateway sends payload body', async () => {
  const { calls, restore } = mockFetch()
  try {
    const client = createAthenaGatewayClient({ baseUrl: 'https://athena-db.com' })
    await client.fetchGateway({ table_name: 't', columns: ['id'] })
    const body = JSON.parse(calls[0].init?.body as string)
    assert.equal(body.table_name, 't')
    assert.deepEqual(body.columns, ['id'])
    assert.equal(calls[0].init?.method, 'POST')
  } finally {
    restore()
  }
})

test('updateGateway sends update payload', async () => {
  const { calls, restore } = mockFetch()
  try {
    const client = createAthenaGatewayClient({ baseUrl: 'https://athena-db.com' })
    await client.updateGateway({ table_name: 't', update_body: { name: 'n' } })
    const body = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(body.update_body, { name: 'n' })
    assert.equal(calls[0].init?.method, 'POST')
  } finally {
    restore()
  }
})

test('insertGateway sends insert payload', async () => {
  const { calls, restore } = mockFetch()
  try {
    const client = createAthenaGatewayClient({ baseUrl: 'https://athena-db.com' })
    await client.insertGateway({ table_name: 't', insert_body: { name: 'n' } })
    const body = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(body.insert_body, { name: 'n' })
    assert.equal(calls[0].init?.method, 'PUT')
  } finally {
    restore()
  }
})

test('deleteGateway sends delete payload', async () => {
  const { calls, restore } = mockFetch()
  try {
    const client = createAthenaGatewayClient({ baseUrl: 'https://athena-db.com' })
    await client.deleteGateway({ table_name: 't', resource_id: 'r1' })
    const body = JSON.parse(calls[0].init?.body as string)
    assert.equal(body.resource_id, 'r1')
    assert.equal(calls[0].init?.method, 'DELETE')
  } finally {
    restore()
  }
})

test('fetchGateway merges config and call headers', async () => {
  const { calls, restore } = mockFetch()
  try {
    const client = createAthenaGatewayClient({
      baseUrl: 'https://athena-db.com',
      headers: { 'X-From-Config': '1' },
    })
    await client.fetchGateway({ table_name: 't' }, { headers: { 'X-From-Call': '2' } })
    const headers = calls[0].init?.headers as Record<string, string>
    assert.equal(headers['X-From-Config'], '1')
    assert.equal(headers['X-From-Call'], '2')
  } finally {
    restore()
  }
})

test('default baseUrl is used when not provided', async () => {
  const { calls, restore } = mockFetch()
  try {
    const client = createAthenaGatewayClient()
    await client.fetchGateway({ table_name: 't' })
    assert.ok(calls[0].url.startsWith('https://athena-db.com'))
  } finally {
    restore()
  }
})
