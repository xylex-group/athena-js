/**
 * athena gateway tests
 *
 * unit tests for gateway types header building and payload normalization logic
 */

import { strict as assert } from 'assert'
import { test } from 'node:test'
import type {
  AthenaFetchPayload,
  AthenaGatewayCondition,
  AthenaInsertPayload,
  AthenaDeletePayload,
  AthenaUpdatePayload,
  AthenaGatewayHookConfig,
  AthenaGatewayCallOptions,
} from '../src/gateway/types.js'
import { createClient } from '../src/supabase.ts'

// test type contracts by constructing payloads and verifying shape

test('AthenaFetchPayload accepts minimal required fields', () => {
  const payload: AthenaFetchPayload = {
    table_name: 'users',
  }
  assert.equal(payload.table_name, 'users')
  assert.equal(payload.conditions, undefined)
})

test('AthenaFetchPayload accepts full options', () => {
  const condition: AthenaGatewayCondition = {
    column: 'id',
    operator: 'eq',
    value: 42,
  }
  const payload: AthenaFetchPayload = {
    table_name: 'users',
    columns: ['id', 'name'],
    conditions: [condition],
    limit: 10,
    offset: 0,
    strip_nulls: true,
    group_by: 'role',
    time_granularity: 'day',
  }
  assert.equal(payload.table_name, 'users')
  assert.deepEqual(payload.conditions, [condition])
  assert.equal(payload.limit, 10)
})

test('AthenaInsertPayload requires table_name and insert_body', () => {
  const payload: AthenaInsertPayload = {
    table_name: 'orders',
    insert_body: { amount: 100, status: 'pending' },
  }
  assert.equal(payload.table_name, 'orders')
  assert.equal((payload.insert_body as Record<string, unknown>).amount, 100)
})

test('AthenaInsertPayload accepts optional update_body for upserts', () => {
  const payload: AthenaInsertPayload = {
    table_name: 'orders',
    insert_body: { id: '1', amount: 100 },
    update_body: { amount: 200 },
  }
  assert.deepEqual(payload.update_body, { amount: 200 })
})

test('AthenaDeletePayload requires table_name and resource_id', () => {
  const payload: AthenaDeletePayload = {
    table_name: 'orders',
    resource_id: 'abc-123',
  }
  assert.equal(payload.table_name, 'orders')
  assert.equal(payload.resource_id, 'abc-123')
})

test('AthenaUpdatePayload extends fetch payload with update_body', () => {
  const payload: AthenaUpdatePayload = {
    table_name: 'orders',
    conditions: [{ column: 'id', operator: 'eq', value: '1' }],
    update_body: { status: 'completed' },
  }
  assert.deepEqual(payload.update_body, { status: 'completed' })
  assert.equal(payload.conditions?.length, 1)
})

test('AthenaGatewayHookConfig accepts optional user context fields', () => {
  const config: AthenaGatewayHookConfig = {
    baseUrl: 'https://athena-db.com',
    userId: 'user-1',
    companyId: 'company-1',
    organizationId: 'org-1',
    apiKey: 'secret',
    stripNulls: false,
  }
  assert.equal(config.userId, 'user-1')
  assert.equal(config.companyId, 'company-1')
  assert.equal(config.organizationId, 'org-1')
  assert.equal(config.stripNulls, false)
})

test('AthenaGatewayCallOptions accepts per-call overrides', () => {
  const options: AthenaGatewayCallOptions = {
    baseUrl: 'https://custom.athena-db.com',
    client: 'custom_client',
    userId: 'per-call-user',
  }
  assert.equal(options.client, 'custom_client')
  assert.equal(options.userId, 'per-call-user')
})

test('AthenaGatewayCondition supports multiple operators and values', () => {
  const conditions: AthenaGatewayCondition[] = [
    { column: 'active', operator: 'eq', value: true },
    { column: 'count', operator: 'gt', value: 0 },
    { column: 'name', operator: 'like', value: 'alice' },
    { column: 'deleted_at', operator: 'is', value: null },
  ]
  assert.equal(conditions[0].operator, 'eq')
  assert.equal(conditions[1].operator, 'gt')
  assert.equal(conditions[2].operator, 'like')
  assert.equal(conditions[3].operator, 'is')
  assert.equal(conditions[0].value, true)
  assert.equal(conditions[1].value, 0)
  assert.equal(conditions[2].value, 'alice')
  assert.equal(conditions[3].value, null)
})

test('fetch payload conditions default to empty array pattern', () => {
  const payload: AthenaFetchPayload = { table_name: 'users' }
  // simulate the normalization done inside fetchGateway
  const normalized = { ...payload, conditions: payload.conditions ?? [] }
  assert.deepEqual(normalized.conditions, [])
})

test('update payload conditions default to empty array pattern', () => {
  const payload: AthenaUpdatePayload = {
    table_name: 'users',
    update_body: { active: false },
  }
  const normalized = { ...payload, conditions: payload.conditions ?? [] }
  assert.deepEqual(normalized.conditions, [])
  assert.deepEqual(normalized.update_body, { active: false })
})

test('select builds fetch payload with Supabase-style filters', async () => {
  const received: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    received.push({ url: String(url), init })
    return new Response(JSON.stringify({ data: [], status: 200 }), { status: 200 })
  }
  try {
    const client = createClient('https://athena-db.com', 'secret')
    await client.from('characters').gt('level', 5).range(0, 9).select('id,name')
    assert.equal(received.length, 1)
    const payload = JSON.parse(received[0].init?.body as string)
    assert.equal(payload.limit, 10)
    assert.equal(payload.offset, 0)
    assert.deepEqual(payload.conditions, [{ column: 'level', operator: 'gt', value: 5 }])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('insert mutation supports select() and returning rows', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify([{ id: 1, name: 'Frodo' }]), { status: 201 })
  }
  try {
    const client = createClient('https://athena-db.com', 'secret')
    const mutation = client.from('characters').insert({ name: 'Frodo' })
    const result = await mutation.select('id,name')
    assert.equal(calls.length, 1)
    assert(result.data?.[0]?.name === 'Frodo')
    const payload = JSON.parse(calls[0].init?.body as string)
    assert.deepEqual(payload.insert_body, { name: 'Frodo' })
    assert.equal(payload.columns, 'id,name')
  } finally {
    globalThis.fetch = originalFetch
  }
})
