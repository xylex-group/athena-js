import { strict as assert } from 'assert'
import { test } from 'node:test'
import {
  AthenaError,
  AthenaErrorCategory,
  AthenaErrorCode,
  AthenaErrorKind,
  normalizeAthenaError,
} from '../src/index.ts'

test('AthenaError captures classification metadata and retryability', () => {
  const error = new AthenaError({
    code: AthenaErrorCode.NetworkUnavailable,
    kind: AthenaErrorKind.Transient,
    category: AthenaErrorCategory.Transport,
    message: 'network failed',
    status: 0,
    retryable: true,
  })

  assert.equal(error.code, AthenaErrorCode.NetworkUnavailable)
  assert.equal(error.kind, AthenaErrorKind.Transient)
  assert.equal(error.category, AthenaErrorCategory.Transport)
  assert.equal(error.retryable, true)
})

test('normalizeAthenaError includes expanded classification details', () => {
  const normalized = normalizeAthenaError({
    status: 429,
    error: 'too many requests',
    data: null,
    raw: { reason: 'rate limit' },
  })
  assert.equal(normalized.kind, 'rate_limit')
  assert.equal(normalized.code, AthenaErrorCode.RateLimited)
  assert.equal(normalized.category, AthenaErrorCategory.Server)
  assert.equal(normalized.retryable, true)
})

