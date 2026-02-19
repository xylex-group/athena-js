/**
 * retry strategies
 * 
 * different ways to handle retries with backoff. exponential is usually the best
 * for most cases since it backs off quickly to avoid overwhelming failing services.
 */

import type { RetryConfig, BackoffStrategy } from '../types/index.js'

export class RetryStrategy {
  private config: Required<RetryConfig>

  constructor(config: RetryConfig) {
    this.config = {
      maxAttempts: config.maxAttempts,
      backoff: config.backoff || 'exponential',
      initialInterval: config.initialInterval || 1000,
      maxInterval: config.maxInterval || 60000,
      multiplier: config.multiplier || 2,
    }
  }

  shouldRetry(attempt: number): boolean {
    return attempt < this.config.maxAttempts
  }

  calculateDelay(attempt: number): number {
    let delay: number

    switch (this.config.backoff) {
      case 'linear':
        delay = this.config.initialInterval * attempt
        break

      case 'exponential':
        delay = this.config.initialInterval * Math.pow(this.config.multiplier, attempt - 1)
        break

      case 'constant':
        delay = this.config.initialInterval
        break

      default:
        delay = this.config.initialInterval
    }

    // cap at max interval
    delay = Math.min(delay, this.config.maxInterval)

    // add jitter to prevent thundering herd
    const jitter = Math.random() * 0.1 * delay
    return Math.round(delay + jitter)
  }

  async executeWithRetry<T>(
    fn: () => Promise<T>,
    onRetry?: (attempt: number, error: Error, delayMs: number) => void
  ): Promise<T> {
    let attempt = 1
    let lastError: Error

    while (true) {
      try {
        return await fn()
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))

        if (!this.shouldRetry(attempt)) {
          throw lastError
        }

        const delay = this.calculateDelay(attempt)
        
        if (onRetry) {
          onRetry(attempt, lastError, delay)
        }

        await new Promise(resolve => setTimeout(resolve, delay))
        attempt++
      }
    }
  }
}

/**
 * parse timeout string like "30s" or "5m" into milliseconds
 */
export function parseTimeout(timeout: string | number): number {
  if (typeof timeout === 'number') return timeout

  const match = timeout.match(/^(\d+)(ms|s|m|h)$/)
  if (!match) {
    throw new Error(`invalid timeout format: ${timeout}`)
  }

  const value = parseInt(match[1], 10)
  const unit = match[2]

  switch (unit) {
    case 'ms':
      return value
    case 's':
      return value * 1000
    case 'm':
      return value * 60 * 1000
    case 'h':
      return value * 60 * 60 * 1000
    default:
      throw new Error(`unknown timeout unit: ${unit}`)
  }
}

