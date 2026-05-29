import { strict as assert } from 'assert'
import { test } from 'node:test'
import {
  assertInt,
  coerceInt,
  isOk,
  normalizeAthenaError,
  parseBooleanFlag,
  requireAffected,
  requireSuccess,
  unwrap,
  unwrapOne,
  unwrapRows,
  withRetry,
} from '../src/auxiliaries.ts'
import type { AthenaResult } from '../src/client.ts'
import { AthenaGatewayError } from '../src/gateway/errors.ts'

function makeResult<T>(overrides: Partial<AthenaResult<T>> = {}): AthenaResult<T> {
  return {
    data: null,
    error: null,
    status: 200,
    raw: null,
    ...overrides,
  } as AthenaResult<T>
}

test('isOk detects successful Athena results', () => {
  assert.equal(isOk(makeResult({ data: { id: 1 } })), true)
  assert.equal(isOk(makeResult({ status: 500 })), false)
  assert.equal(isOk(makeResult({ error: 'boom' })), false)
})

test('unwrapRows returns arrays and coerces single rows', () => {
  const single = unwrapRows(makeResult<{ id: number } | { id: number }[] | null>({ data: { id: 1 } }))
  const many = unwrapRows(makeResult<{ id: number } | { id: number }[] | null>({ data: [{ id: 1 }, { id: 2 }] }))
  const none = unwrapRows(makeResult<{ id: number } | { id: number }[] | null>({ data: null }))

  assert.deepEqual(single, [{ id: 1 }])
  assert.deepEqual(many, [{ id: 1 }, { id: 2 }])
  assert.deepEqual(none, [])
})

test('unwrapRows throws AthenaGatewayError on failed result', () => {
  assert.throws(
    () =>
      unwrapRows(
        makeResult<{ id: number }[] | { id: number } | null>({
          status: 409,
          error: 'duplicate key value violates unique constraint "users_email_key"',
        }),
      ),
    AthenaGatewayError,
  )
})

test('unwrap and unwrapOne enforce non-null by default', () => {
  assert.equal(unwrap(makeResult<number | null>({ data: 42 })), 42)
  assert.throws(() => unwrap(makeResult<number | null>({ data: null })), AthenaGatewayError)

  const row = unwrapOne(makeResult<{ id: number }[] | { id: number } | null>({ data: [{ id: 7 }] }))
  assert.deepEqual(row, { id: 7 })

  assert.throws(
    () => unwrapOne(makeResult<{ id: number }[] | { id: number } | null>({ data: [] })),
    AthenaGatewayError,
  )

  const nullable = unwrapOne(
    makeResult<{ id: number }[] | { id: number } | null>({ data: null }),
    { allowNull: true },
  )
  assert.equal(nullable, null)
})

test('unwrapOne can require exactly one row', () => {
  assert.throws(
    () =>
      unwrapOne(
        makeResult<{ id: number }[] | { id: number } | null>({ data: [{ id: 1 }, { id: 2 }] }),
        { requireExactlyOne: true },
      ),
    AthenaGatewayError,
  )
})

test('requireSuccess returns result for successful operations', () => {
  const result = makeResult<{ id: number }[]>({ data: [{ id: 1 }] })
  const asserted = requireSuccess(result, { operation: 'insert', table: 'users' })
  assert.equal(asserted, result)
})

test('requireSuccess throws AthenaGatewayError for failed operations', () => {
  assert.throws(
    () =>
      requireSuccess(
        makeResult<{ id: number }[]>({
          status: 403,
          error: 'forbidden',
        }),
        { operation: 'update', table: 'users' },
      ),
    AthenaGatewayError,
  )
})

test('requireSuccess uses contextual fallback message when status fails without explicit error', () => {
  assert.throws(
    () =>
      requireSuccess(
        makeResult<{ id: number }[]>({
          status: 503,
          error: null,
        }),
        { operation: 'update', table: 'users' },
      ),
    /Athena update failed/,
  )
})

test('requireAffected enforces mutation count minimum', () => {
  const ok = makeResult<{ id: number }[]>({
    data: [{ id: 1 }],
    count: 2,
  })
  assert.equal(requireAffected(ok), 2)
  assert.equal(requireAffected(ok, { min: 2 }), 2)

  assert.throws(
    () =>
      requireAffected(
        makeResult<{ id: number }[]>({
          data: [{ id: 1 }],
          count: 0,
        }),
      ),
    /Expected at least 1 affected rows but received 0/,
  )
})

test('requireAffected throws when count is missing', () => {
  assert.throws(
    () =>
      requireAffected(
        makeResult<{ id: number }[]>({
          data: [{ id: 1 }],
          count: undefined,
        }),
      ),
    /response.count is missing/,
  )
})

test('requireAffected treats null count as missing and surfaces guidance', () => {
  assert.throws(
    () =>
      requireAffected(
        makeResult<{ id: number }[]>({
          data: [{ id: 1 }],
          count: null,
        }),
      ),
    /response.count is missing/,
  )
})

test('normalizeAthenaError maps unique and transient kinds', () => {
  const unique = normalizeAthenaError(
    makeResult({
      status: 409,
      error: 'duplicate key value violates unique constraint "users_email_key"',
      raw: { detail: 'duplicate' },
    }),
    { operation: 'insert', table: 'users' },
  )

  assert.equal(unique.kind, 'unique_violation')
  assert.equal(unique.constraint, 'users_email_key')
  assert.equal(unique.table, 'users')
  assert.equal(unique.operation, 'insert')

  const transient = normalizeAthenaError(
    new AthenaGatewayError({
      code: 'NETWORK_ERROR',
      status: 0,
      message: 'socket hang up',
      endpoint: '/gateway/fetch',
      method: 'POST',
    }),
  )

  assert.equal(transient.kind, 'transient')
  assert.equal(transient.operation, 'select')
})

test('normalizeAthenaError maps auth, rate_limit, not_found, and validation by status', () => {
  const auth = normalizeAthenaError(
    makeResult({
      status: 401,
      error: 'unauthorized',
      raw: null,
    }),
  )
  assert.equal(auth.kind, 'auth')

  const rateLimit = normalizeAthenaError(
    makeResult({
      status: 429,
      error: 'too many requests',
      raw: null,
    }),
  )
  assert.equal(rateLimit.kind, 'rate_limit')

  const notFound = normalizeAthenaError(
    makeResult({
      status: 404,
      error: 'row not found',
      raw: null,
    }),
  )
  assert.equal(notFound.kind, 'not_found')

  const validation = normalizeAthenaError(
    makeResult({
      status: 422,
      error: 'validation failed',
      raw: null,
    }),
  )
  assert.equal(validation.kind, 'validation')
})

test('normalizeAthenaError supports raw Error and unknown input', () => {
  const fromError = normalizeAthenaError(new Error('timeout while connecting'))
  assert.equal(fromError.kind, 'transient')
  assert.equal(fromError.message, 'timeout while connecting')

  const fromUnknown = normalizeAthenaError({ foo: 'bar' })
  assert.equal(fromUnknown.kind, 'unknown')
  assert.equal(fromUnknown.message, 'Unknown Athena error')
})

test('coerceInt and assertInt handle mixed integer values safely', () => {
  assert.equal(coerceInt(12), 12)
  assert.equal(coerceInt('42'), 42)
  assert.equal(coerceInt(12.4), null)
  assert.equal(coerceInt('1.2'), null)
  assert.equal(coerceInt(null), null)
  assert.equal(coerceInt(BigInt(12)), 12)

  const tooLarge = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1)
  assert.equal(coerceInt(tooLarge, { strictBigInt: true }), null)
  assert.equal(coerceInt(-5, { min: 0 }), null)
  assert.equal(coerceInt(11, { max: 10 }), null)

  assert.equal(assertInt('7', 'case_id'), 7)
  assert.throws(() => assertInt('foo', 'case_id'), /case_id must be a finite integer/)
})

test('parseBooleanFlag supports common truthy and falsey variants', () => {
  assert.equal(parseBooleanFlag('1', false), true)
  assert.equal(parseBooleanFlag(' true ', false), true)
  assert.equal(parseBooleanFlag('YES', false), true)
  assert.equal(parseBooleanFlag('on', false), true)

  assert.equal(parseBooleanFlag('0', true), false)
  assert.equal(parseBooleanFlag(' false ', true), false)
  assert.equal(parseBooleanFlag('NO', true), false)
  assert.equal(parseBooleanFlag('off', true), false)
})

test('parseBooleanFlag falls back for missing or unrecognized values', () => {
  assert.equal(parseBooleanFlag(undefined, true), true)
  assert.equal(parseBooleanFlag('', false), false)
  assert.equal(parseBooleanFlag('   ', true), true)
  assert.equal(parseBooleanFlag('maybe', false), false)
})

test('withRetry retries transient failures and eventually succeeds', async () => {
  let attempts = 0

  const result = await withRetry(
    {
      retries: 3,
      baseDelayMs: 0,
      jitter: false,
    },
    async () => {
      attempts += 1
      if (attempts < 3) {
        throw new AthenaGatewayError({
          code: 'NETWORK_ERROR',
          message: 'temporary network issue',
          status: 0,
          endpoint: '/gateway/fetch',
          method: 'POST',
        })
      }
      return 'ok'
    },
  )

  assert.equal(result, 'ok')
  assert.equal(attempts, 3)
})

test('withRetry does not retry non-retriable errors by default', async () => {
  let attempts = 0

  await assert.rejects(
    withRetry(
      {
        retries: 5,
        baseDelayMs: 0,
        jitter: false,
      },
      async () => {
        attempts += 1
        throw new AthenaGatewayError({
          code: 'HTTP_ERROR',
          message: 'validation failed',
          status: 400,
          endpoint: '/gateway/insert',
          method: 'PUT',
        })
      },
    ),
    /validation failed/,
  )

  assert.equal(attempts, 1)
})

test('withRetry respects retry count and custom backoff function', async () => {
  let attempts = 0
  const backoffAttempts: number[] = []

  await assert.rejects(
    withRetry(
      {
        retries: 2,
        baseDelayMs: 0,
        jitter: false,
        backoff: attempt => {
          backoffAttempts.push(attempt)
          return 0
        },
        shouldRetry: () => true,
      },
      async () => {
        attempts += 1
        throw new Error('always fails')
      },
    ),
    /always fails/,
  )

  assert.equal(attempts, 3)
  assert.deepEqual(backoffAttempts, [1, 2])
})

test('withRetry passes attempt number to shouldRetry and stops when false', async () => {
  let attempts = 0
  const retryChecks: number[] = []

  await assert.rejects(
    withRetry(
      {
        retries: 5,
        baseDelayMs: 0,
        jitter: false,
        shouldRetry: (_error, attempt) => {
          retryChecks.push(attempt)
          return attempt < 2
        },
      },
      async () => {
        attempts += 1
        throw new AthenaGatewayError({
          code: 'NETWORK_ERROR',
          message: `network fail ${attempts}`,
          status: 0,
          endpoint: '/gateway/fetch',
          method: 'POST',
        })
      },
    ),
    /network fail 2/,
  )

  assert.equal(attempts, 2)
  assert.deepEqual(retryChecks, [1, 2])
})

test('unwrapRows uses fallback failure message when status fails without explicit error', () => {
  assert.throws(
    () =>
      unwrapRows(
        makeResult<{ id: number }[] | { id: number } | null>({
          status: 500,
          error: null,
          errorDetails: null,
          data: null,
          raw: null,
        }),
      ),
    /Athena request failed/,
  )
})
