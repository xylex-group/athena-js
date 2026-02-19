/**
 * standalone retry utilities
 * 
 * use these to add retry logic to any async function without needing activities
 * or workflows. useful for wrapping external api calls, database operations, etc.
 */

import { RetryStrategy, parseTimeout } from '../strategies/retry.js'
import type { RetryConfig } from '../types/index.js'

export interface RetryOptions extends Partial<RetryConfig> {
  timeout?: string | number
  onRetry?: (attempt: number, error: Error, delayMs: number) => void
  shouldRetry?: (error: Error) => boolean
}

/**
 * wrap any async function with retry logic
 * 
 * example:
 * ```typescript
 * const result = await withRetry(
 *   () => fetch('https://api.example.com/data'),
 *   { maxAttempts: 3, backoff: 'exponential' }
 * )
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config: RetryConfig = {
    maxAttempts: options.maxAttempts || 3,
    backoff: options.backoff || 'exponential',
    initialInterval: options.initialInterval || 1000,
    maxInterval: options.maxInterval || 60000,
    multiplier: options.multiplier || 2,
  }

  const strategy = new RetryStrategy(config)
  const timeoutMs = options.timeout ? parseTimeout(options.timeout) : undefined

  return strategy.executeWithRetry(async () => {
    if (timeoutMs) {
      return await withTimeout(fn, timeoutMs)
    }
    return await fn()
  }, (attempt, error, delayMs) => {
    // check if we should retry this specific error
    if (options.shouldRetry && !options.shouldRetry(error)) {
      throw error
    }

    if (options.onRetry) {
      options.onRetry(attempt, error, delayMs)
    }
  })
}

/**
 * create a retryable version of any async function
 * 
 * example:
 * ```typescript
 * const fetchWithRetry = retryable(
 *   async (url: string) => {
 *     const res = await fetch(url)
 *     return res.json()
 *   },
 *   { maxAttempts: 5, backoff: 'exponential' }
 * )
 * 
 * const data = await fetchWithRetry('https://api.example.com')
 * ```
 */
export function retryable<Args extends any[], Result>(
  fn: (...args: Args) => Promise<Result>,
  options: RetryOptions = {}
): (...args: Args) => Promise<Result> {
  return (...args: Args) => withRetry(() => fn(...args), options)
}

/**
 * execute a function with a timeout
 */
async function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
    ),
  ])
}

/**
 * common retry patterns for specific use cases
 */
export const retryPatterns = {
  /**
   * retry config for api calls
   */
  api: {
    maxAttempts: 5,
    backoff: 'exponential' as const,
    initialInterval: 1000,
    maxInterval: 30000,
    multiplier: 2,
  },

  /**
   * retry config for database operations
   */
  database: {
    maxAttempts: 3,
    backoff: 'exponential' as const,
    initialInterval: 500,
    maxInterval: 10000,
    multiplier: 2,
  },

  /**
   * retry config for network operations
   */
  network: {
    maxAttempts: 5,
    backoff: 'exponential' as const,
    initialInterval: 2000,
    maxInterval: 60000,
    multiplier: 3,
  },

  /**
   * retry config for quick retries
   */
  quick: {
    maxAttempts: 3,
    backoff: 'constant' as const,
    initialInterval: 100,
  },
}

/**
 * helper to check if an error is retryable
 */
export const shouldRetryError = {
  /**
   * retry on network errors
   */
  network: (error: Error): boolean => {
    const message = error.message.toLowerCase()
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('etimedout')
    )
  },

  /**
   * retry on rate limit errors
   */
  rateLimit: (error: Error): boolean => {
    const message = error.message.toLowerCase()
    return message.includes('rate limit') || message.includes('429')
  },

  /**
   * retry on server errors (5xx)
   */
  serverError: (error: Error): boolean => {
    const message = error.message.toLowerCase()
    return message.includes('500') || message.includes('502') || message.includes('503')
  },

  /**
   * retry on any of the above
   */
  transient: (error: Error): boolean => {
    return (
      shouldRetryError.network(error) ||
      shouldRetryError.rateLimit(error) ||
      shouldRetryError.serverError(error)
    )
  },
}

