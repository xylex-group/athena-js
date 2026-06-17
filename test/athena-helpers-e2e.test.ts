import { strict as assert } from 'assert'
import { test } from 'node:test'
import crypto from 'crypto'
import {
  assertInt,
  normalizeAthenaError,
  requireAffected,
  requireSuccess,
  unwrapOne,
  unwrapRows,
  withRetry,
} from '../src/auxiliaries.ts'
import { createClient } from '../src/client.ts'
import { AthenaGatewayError } from '../src/gateway/errors.ts'

const ATHENA_URL = process.env.ATHENA_URL ?? 'https://mirror3.athena-db.com'
const ATHENA_API_KEY = process.env.ATHENA_API_KEY ?? 'x'
const ATHENA_CLIENT = process.env.ATHENA_CLIENT ?? 'athena_logging'

if (!ATHENA_URL || !ATHENA_API_KEY) {
  throw new Error('ATHENA_URL and ATHENA_API_KEY are required for E2E tests')
}

function makePayload(runId: string) {
  return {
    test_bool: true,
    test_text: runId,
    test_number: 42,
    test_json: { runId, ok: true },
    test_time: null,
    test_uuid: crypto.randomUUID(),
  }
}

function createE2EClient() {
  return createClient({
    key: ATHENA_API_KEY,
    gatewayUrl: ATHENA_URL,
    client: ATHENA_CLIENT,
  })
}

test('e2e helpers: requireSuccess + unwrap helpers work on live insert/select flow', async (t) => {
  const client = createE2EClient()
  const runId = `helpers-e2e-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const payload = makePayload(runId)

  let insertedId: number | undefined

  try {
    const insertResult = await client
      .from('test')
      .insert(payload)
      .single('id,test_uuid,test_text,test_number', { count: 'exact' })

    const ensuredInsert = requireSuccess(insertResult, {
      table: 'test',
      operation: 'insert',
      identity: { test_text: runId },
    })

    const insertedRow = unwrapOne(ensuredInsert, {
      context: { table: 'test', operation: 'insert', identity: { test_text: runId } },
    }) as Record<string, unknown>

    insertedId = assertInt(insertedRow.id, 'inserted id', { min: 1 })

    if (ensuredInsert.count != null) {
      const affected = requireAffected(ensuredInsert, { min: 1 }, {
        table: 'test',
        operation: 'insert',
        identity: { id: insertedId },
      })
      assert.ok(affected >= 1)
    } else {
      t.diagnostic('Gateway did not return count for count=exact request; skipping requireAffected success assertion')
    }

    const fetchResult = await client
      .from('test')
      .select('id,test_uuid,test_text,test_number')
      .eq('id', insertedId)

    const ensuredFetch = requireSuccess(fetchResult, {
      table: 'test',
      operation: 'select',
      identity: { id: insertedId },
    })
    const rows = unwrapRows(ensuredFetch, {
      context: { table: 'test', operation: 'select', identity: { id: insertedId } },
    })

    assert.equal(rows.length, 1)
    const row = rows[0] as Record<string, unknown>
    assert.equal(row.test_uuid, payload.test_uuid)
    assert.equal(row.test_text, runId)
    assert.equal(row.test_number, 42)
  } finally {
    if (insertedId != null) {
      await client.from('test').eq('id', insertedId).delete()
    }
  }
})

test('e2e helpers: normalizeAthenaError + requireSuccess handle real query failures', async () => {
  const client = createE2EClient()

  const badResult = await client.query(`select id from definitely_missing_${Date.now()}`)

  assert.throws(
    () =>
      requireSuccess(badResult, {
        table: 'definitely_missing_table',
        operation: 'select',
      }),
    AthenaGatewayError,
  )

  const normalized = normalizeAthenaError(badResult, {
    table: 'definitely_missing_table',
    operation: 'select',
  })

  assert.equal(normalized.operation, 'select')
  assert.equal(normalized.table, 'definitely_missing_table')
  assert.equal(normalized.status, badResult.status)
  assert.ok(normalized.message.length > 0)
})

test('e2e helpers: withRetry can recover and complete a live read', async () => {
  const client = createE2EClient()

  let attempts = 0
  const result = await withRetry(
    {
      retries: 2,
      baseDelayMs: 0,
      jitter: false,
      shouldRetry: error => normalizeAthenaError(error).kind === 'transient',
    },
    async () => {
      attempts += 1
      if (attempts === 1) {
        throw new AthenaGatewayError({
          code: 'NETWORK_ERROR',
          message: 'synthetic transient for retry e2e',
          status: 0,
          endpoint: '/gateway/fetch',
          method: 'POST',
        })
      }

      return client.from('test').select('id').limit(1)
    },
  )

  assert.equal(attempts, 2)

  const ensured = requireSuccess(result, { table: 'test', operation: 'select' })
  const rows = unwrapRows(ensured, { context: { table: 'test', operation: 'select' } })
  assert.ok(Array.isArray(rows))
})
