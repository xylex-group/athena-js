/**
 * retry utility tests
 * 
 * comprehensive test suite for retry mechanisms backoff strategies and error handling
 */

import { strict as assert } from 'assert'
import { test } from 'node:test'
import { withRetry, retryable, retryPatterns, shouldRetryError } from '../src/utils/retry.js'
import { RetryStrategy } from '../src/strategies/retry.js'

test('retry strategy calculates exponential backoff correctly', () => {
  const strategy = new RetryStrategy({
    maxAttempts: 5,
    backoff: 'exponential',
    initialInterval: 1000,
    multiplier: 2,
    maxInterval: 60000,
  })

  const delay1 = strategy.calculateDelay(1)
  const delay2 = strategy.calculateDelay(2)
  const delay3 = strategy.calculateDelay(3)

  // delays should increase exponentially with jitter
  assert(delay1 >= 1000 && delay1 <= 1100, `delay1 ${delay1} should be around 1000ms`)
  assert(delay2 >= 2000 && delay2 <= 2200, `delay2 ${delay2} should be around 2000ms`)
  assert(delay3 >= 4000 && delay3 <= 4400, `delay3 ${delay3} should be around 4000ms`)
})

test('retry strategy calculates linear backoff correctly', () => {
  const strategy = new RetryStrategy({
    maxAttempts: 4,
    backoff: 'linear',
    initialInterval: 500,
    maxInterval: 10000,
  })

  const delay1 = strategy.calculateDelay(1)
  const delay2 = strategy.calculateDelay(2)
  const delay3 = strategy.calculateDelay(3)

  assert(delay1 >= 500 && delay1 <= 550, `delay1 ${delay1} should be around 500ms`)
  assert(delay2 >= 1000 && delay2 <= 1100, `delay2 ${delay2} should be around 1000ms`)
  assert(delay3 >= 1500 && delay3 <= 1650, `delay3 ${delay3} should be around 1500ms`)
})

test('retry strategy calculates constant backoff correctly', () => {
  const strategy = new RetryStrategy({
    maxAttempts: 3,
    backoff: 'constant',
    initialInterval: 2000,
    maxInterval: 10000,
  })

  const delay1 = strategy.calculateDelay(1)
  const delay2 = strategy.calculateDelay(2)
  const delay3 = strategy.calculateDelay(3)

  assert(delay1 >= 2000 && delay1 <= 2200, `delay1 ${delay1} should be around 2000ms`)
  assert(delay2 >= 2000 && delay2 <= 2200, `delay2 ${delay2} should be around 2000ms`)
  assert(delay3 >= 2000 && delay3 <= 2200, `delay3 ${delay3} should be around 2000ms`)
})

test('retry strategy respects max interval', () => {
  const strategy = new RetryStrategy({
    maxAttempts: 10,
    backoff: 'exponential',
    initialInterval: 1000,
    multiplier: 2,
    maxInterval: 5000,
  })

  const delay10 = strategy.calculateDelay(10)
  
  assert(delay10 <= 5500, `delay should not exceed maxInterval with jitter`)
})

test('retry strategy should retry correct number of times', () => {
  const strategy = new RetryStrategy({
    maxAttempts: 3,
    backoff: 'constant',
    initialInterval: 1,
  })

  assert.equal(strategy.shouldRetry(1), true)
  assert.equal(strategy.shouldRetry(2), true)
  assert.equal(strategy.shouldRetry(3), false)
  assert.equal(strategy.shouldRetry(4), false)
})

test('withRetry succeeds after retries', async () => {
  let attempts = 0

  const result = await withRetry(
    async () => {
      attempts++
      if (attempts < 3) throw new Error('not yet')
      return 'success'
    },
    { maxAttempts: 5, backoff: 'constant', initialInterval: 1 }
  )

  assert.equal(result, 'success')
  assert.equal(attempts, 3)
})

test('withRetry fails after max attempts', async () => {
  let attempts = 0

  try {
    await withRetry(
      async () => {
        attempts++
        throw new Error('always fails')
      },
      { maxAttempts: 3, backoff: 'constant', initialInterval: 1 }
    )
    assert.fail('should have thrown')
  } catch (err) {
    assert.equal(err.message, 'always fails')
    assert.equal(attempts, 3)
  }
})

test('withRetry calls onRetry callback', async () => {
  const retries: number[] = []

  await withRetry(
    async () => {
      if (retries.length < 2) throw new Error('retry')
      return 'done'
    },
    {
      maxAttempts: 5,
      backoff: 'constant',
      initialInterval: 1,
      onRetry: (attempt, error, delay) => {
        retries.push(attempt)
      }
    }
  )

  assert.deepEqual(retries, [1, 2])
})

test('withRetry respects shouldRetry predicate', async () => {
  let attempts = 0

  try {
    await withRetry(
      async () => {
        attempts++
        throw new Error('validation error')
      },
      {
        maxAttempts: 5,
        backoff: 'constant',
        initialInterval: 1,
        shouldRetry: (error) => error.message.includes('network')
      }
    )
    assert.fail('should have thrown')
  } catch (err) {
    assert.equal(err.message, 'validation error')
    assert.equal(attempts, 1, 'should not retry non-network errors')
  }
})

test('withRetry with timeout', async () => {
  try {
    await withRetry(
      async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return 'too slow'
      },
      { maxAttempts: 2, timeout: '50ms', initialInterval: 1 }
    )
    assert.fail('should have timed out')
  } catch (err) {
    assert(err.message.includes('timeout'))
  }
})

test('retryable creates wrapped function', async () => {
  let attempts = 0

  const flaky = retryable(
    async (value: number) => {
      attempts++
      if (attempts < 2) throw new Error('retry')
      return value * 2
    },
    { maxAttempts: 5, backoff: 'constant', initialInterval: 1 }
  )

  const result = await flaky(5)
  assert.equal(result, 10)
  assert.equal(attempts, 2)
})

test('retryable preserves function arguments', async () => {
  const multiply = retryable(
    async (a: number, b: number, c: number) => {
      return a * b * c
    },
    { maxAttempts: 2, backoff: 'constant', initialInterval: 1 }
  )

  const result = await multiply(2, 3, 4)
  assert.equal(result, 24)
})

test('retryPatterns.api has correct configuration', () => {
  assert.equal(retryPatterns.api.maxAttempts, 5)
  assert.equal(retryPatterns.api.backoff, 'exponential')
  assert.equal(retryPatterns.api.initialInterval, 1000)
  assert.equal(retryPatterns.api.maxInterval, 30000)
  assert.equal(retryPatterns.api.multiplier, 2)
})

test('retryPatterns.database has correct configuration', () => {
  assert.equal(retryPatterns.database.maxAttempts, 3)
  assert.equal(retryPatterns.database.backoff, 'exponential')
  assert.equal(retryPatterns.database.initialInterval, 500)
})

test('retryPatterns.network has correct configuration', () => {
  assert.equal(retryPatterns.network.maxAttempts, 5)
  assert.equal(retryPatterns.network.initialInterval, 2000)
  assert.equal(retryPatterns.network.multiplier, 3)
})

test('shouldRetryError.network detects network errors', () => {
  assert.equal(shouldRetryError.network(new Error('network timeout')), true)
  assert.equal(shouldRetryError.network(new Error('ECONNREFUSED')), true)
  assert.equal(shouldRetryError.network(new Error('ENOTFOUND')), true)
  assert.equal(shouldRetryError.network(new Error('ETIMEDOUT')), true)
  assert.equal(shouldRetryError.network(new Error('validation failed')), false)
})

test('shouldRetryError.rateLimit detects rate limit errors', () => {
  assert.equal(shouldRetryError.rateLimit(new Error('rate limit exceeded')), true)
  assert.equal(shouldRetryError.rateLimit(new Error('429 too many requests')), true)
  assert.equal(shouldRetryError.rateLimit(new Error('network error')), false)
})

test('shouldRetryError.serverError detects server errors', () => {
  assert.equal(shouldRetryError.serverError(new Error('500 internal server error')), true)
  assert.equal(shouldRetryError.serverError(new Error('502 bad gateway')), true)
  assert.equal(shouldRetryError.serverError(new Error('503 service unavailable')), true)
  assert.equal(shouldRetryError.serverError(new Error('404 not found')), false)
})

test('shouldRetryError.transient combines all transient errors', () => {
  assert.equal(shouldRetryError.transient(new Error('network timeout')), true)
  assert.equal(shouldRetryError.transient(new Error('rate limit')), true)
  assert.equal(shouldRetryError.transient(new Error('503 error')), true)
  assert.equal(shouldRetryError.transient(new Error('validation error')), false)
})

test('withRetry handles immediate success', async () => {
  let attempts = 0

  const result = await withRetry(
    async () => {
      attempts++
      return 'immediate success'
    },
    { maxAttempts: 3, backoff: 'constant', initialInterval: 1 }
  )

  assert.equal(result, 'immediate success')
  assert.equal(attempts, 1)
})

test('withRetry preserves error details', async () => {
  class CustomError extends Error {
    code: string
    constructor(message: string, code: string) {
      super(message)
      this.code = code
    }
  }

  try {
    await withRetry(
      async () => {
        throw new CustomError('custom error', 'ERR_CUSTOM')
      },
      { maxAttempts: 2, backoff: 'constant', initialInterval: 1 }
    )
    assert.fail('should have thrown')
  } catch (err) {
    assert.equal(err.message, 'custom error')
    assert.equal(err.code, 'ERR_CUSTOM')
  }
})

test('retryable with complex return types', async () => {
  type Result = { data: string; count: number }

  const complexFunction = retryable(
    async (input: string): Promise<Result> => {
      return { data: input, count: input.length }
    },
    { maxAttempts: 2, backoff: 'constant', initialInterval: 1 }
  )

  const result = await complexFunction('test')
  assert.deepEqual(result, { data: 'test', count: 4 })
})

test('withRetry with predefined pattern', async () => {
  let attempts = 0

  const result = await withRetry(
    async () => {
      attempts++
      if (attempts < 2) throw new Error('transient error')
      return 'success'
    },
    { ...retryPatterns.quick }
  )

  assert.equal(result, 'success')
  assert.equal(attempts, 2)
})

test('jitter adds randomness to delays', () => {
  const strategy = new RetryStrategy({
    maxAttempts: 5,
    backoff: 'constant',
    initialInterval: 1000,
    maxInterval: 10000,
  })

  const delays = Array.from({ length: 10 }, () => strategy.calculateDelay(1))
  
  const allSame = delays.every(d => d === delays[0])
  assert.equal(allSame, false, 'jitter should produce different delays')
  
  delays.forEach(d => {
    assert(d >= 1000 && d <= 1100, `delay ${d} should be between 1000 and 1100`)
  })
})

test('executeWithRetry stops after first success', async () => {
  const strategy = new RetryStrategy({
    maxAttempts: 10,
    backoff: 'constant',
    initialInterval: 1,
  })

  let attempts = 0
  const result = await strategy.executeWithRetry(async () => {
    attempts++
    if (attempts === 1) return 'first try'
    throw new Error('should not reach')
  })

  assert.equal(result, 'first try')
  assert.equal(attempts, 1)
})

