import { strict as assert } from 'assert'
import { test } from 'node:test'
import { AthenaGatewayError } from '../src/gateway/errors.ts'
import {
  normalizeAthenaError,
  normalizeAthenaResult,
  runWithRetry,
  safeSerializeQueryKey,
} from '../src/react/utils.ts'

test('safeSerializeQueryKey handles primitive arrays and strings consistently', () => {
  const a = safeSerializeQueryKey(['users', 1, true, null, undefined])
  const b = safeSerializeQueryKey(['users', 1, true, null, undefined])
  const c = safeSerializeQueryKey('users')

  assert.equal(a, b)
  assert.equal(c, 'key:users')
})

test('safeSerializeQueryKey handles circular objects safely', () => {
  const obj: Record<string, unknown> = { name: 'circle' }
  obj.self = obj

  const token = safeSerializeQueryKey(['k', obj])
  assert.equal(token.includes('[circular]'), true)
})

test('normalizeAthenaResult unwraps envelope success and applies select', () => {
  const result = normalizeAthenaResult<{ id: number }[], number[]>(
    {
      data: [{ id: 1 }, { id: 2 }],
      error: null,
      status: 200,
      raw: { source: 'x' },
    },
    rows => rows.map(row => row.id),
  )

  assert.equal(result.error, null)
  assert.deepEqual(result.data, [1, 2])
  assert.equal(result.status, 200)
  assert.deepEqual(result.raw, { source: 'x' })
})

test('normalizeAthenaResult maps envelope errors to AthenaQueryError', () => {
  const result = normalizeAthenaResult(
    {
      data: null,
      error: 'denied',
      status: 403,
      raw: { code: 'E403' },
    },
  )

  assert.equal(result.data, undefined)
  assert.equal(result.error?.message, 'denied')
  assert.equal(result.error?.status, 403)
  assert.equal(result.status, 403)
})

test('normalizeAthenaError converts AthenaGatewayError to query error shape', () => {
  const gatewayError = new AthenaGatewayError({
    code: 'HTTP_ERROR',
    message: 'gateway failed',
    status: 500,
    endpoint: '/gateway/fetch',
    method: 'POST',
  })

  const normalized = normalizeAthenaError(gatewayError)
  assert.equal(normalized.message, 'gateway failed')
  assert.equal(normalized.status, 500)
  assert.equal(normalized.code, 'HTTP_ERROR')
})

test('runWithRetry retries until success with retryDelay callback', async () => {
  let attempts = 0
  const seenDelayAttempts: number[] = []

  const result = await runWithRetry(
    async attempt => {
      attempts = attempt
      if (attempt < 3) {
        throw new Error(`attempt-${attempt}`)
      }
      return 'ok'
    },
    {
      retry: 2,
      retryDelay: attempt => {
        seenDelayAttempts.push(attempt)
        return 0
      },
    },
  )

  assert.equal(result, 'ok')
  assert.equal(attempts, 3)
  assert.deepEqual(seenDelayAttempts, [1, 2])
})
