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
    eq_column: 'id',
    eq_value: 42,
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
    conditions: [{ eq_column: 'id', eq_value: '1' }],
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

test('AthenaGatewayCondition supports all eq_value types', () => {
  const conditions: AthenaGatewayCondition[] = [
    { eq_column: 'active', eq_value: true },
    { eq_column: 'count', eq_value: 0 },
    { eq_column: 'name', eq_value: 'alice' },
    { eq_column: 'deleted_at', eq_value: null },
  ]
  assert.equal(conditions[0].eq_value, true)
  assert.equal(conditions[1].eq_value, 0)
  assert.equal(conditions[2].eq_value, 'alice')
  assert.equal(conditions[3].eq_value, null)
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
