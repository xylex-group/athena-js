/**
 * retry patterns example
 * 
 * shows different ways to add retry logic with backoff to existing functions
 * without needing full workflow orchestration.
 */

import { withRetry, retryable, retryPatterns, shouldRetryError } from '../../src/index'

// simulate an unreliable api
let apiCallCount = 0
async function unreliableApiCall(endpoint: string): Promise<any> {
  apiCallCount++
  console.log(`  attempt ${apiCallCount} to call ${endpoint}`)
  
  // fail first 2 attempts
  if (apiCallCount <= 2) {
    throw new Error('network timeout')
  }
  
  return { data: 'success', endpoint }
}

// simulate rate limited api
let rateLimitCount = 0
async function rateLimitedApi(): Promise<any> {
  rateLimitCount++
  console.log(`  attempt ${rateLimitCount} to call rate limited api`)
  
  // fail with rate limit for first 3 attempts
  if (rateLimitCount <= 3) {
    throw new Error('rate limit exceeded (429)')
  }
  
  return { data: 'success' }
}

// simulate database operation
let dbCallCount = 0
async function flakeyDatabaseQuery(query: string): Promise<any> {
  dbCallCount++
  console.log(`  attempt ${dbCallCount} to execute query: ${query}`)
  
  // fail randomly
  if (Math.random() < 0.4) {
    throw new Error('database connection timeout')
  }
  
  return { rows: [{ id: 1, name: 'test' }] }
}

async function main() {
  console.log('=== Retry Patterns Examples ===\n')

  // example 1: basic retry with default settings
  console.log('1. Basic retry with defaults (3 attempts, exponential backoff):')
  apiCallCount = 0
  try {
    const result = await withRetry(() => unreliableApiCall('/users'), {
      onRetry: (attempt, error, delayMs) => {
        console.log(`  retry after ${delayMs}ms due to: ${error.message}`)
      }
    })
    console.log('  success:', result)
  } catch (err) {
    console.log('  failed:', err.message)
  }

  console.log('\n2. Retry with custom config (5 attempts, longer delays):')
  apiCallCount = 0
  try {
    const result = await withRetry(() => unreliableApiCall('/posts'), {
      maxAttempts: 5,
      backoff: 'exponential',
      initialInterval: 500,
      maxInterval: 10000,
      multiplier: 2,
      onRetry: (attempt, error, delayMs) => {
        console.log(`  retry ${attempt} after ${delayMs}ms: ${error.message}`)
      }
    })
    console.log('  success:', result)
  } catch (err) {
    console.log('  failed:', err.message)
  }

  // example 2: using retry patterns
  console.log('\n3. Using predefined API retry pattern:')
  rateLimitCount = 0
  try {
    const result = await withRetry(() => rateLimitedApi(), {
      ...retryPatterns.api,
      onRetry: (attempt, error, delayMs) => {
        console.log(`  retry ${attempt} after ${delayMs}ms: ${error.message}`)
      }
    })
    console.log('  success:', result)
  } catch (err) {
    console.log('  failed:', err.message)
  }

  // example 3: conditional retry based on error type
  console.log('\n4. Conditional retry (only retry network errors):')
  try {
    const result = await withRetry(
      async () => {
        throw new Error('validation failed: invalid email')
      },
      {
        maxAttempts: 3,
        shouldRetry: shouldRetryError.network,
        onRetry: (attempt, error, delayMs) => {
          console.log(`  retry ${attempt}: ${error.message}`)
        }
      }
    )
    console.log('  success:', result)
  } catch (err) {
    console.log('  failed immediately (not a network error):', err.message)
  }

  // example 4: create a retryable function
  console.log('\n5. Create a retryable function:')
  
  const fetchWithRetry = retryable(
    async (url: string) => {
      console.log(`  fetching ${url}`)
      if (Math.random() < 0.6) {
        throw new Error('fetch failed')
      }
      return { url, data: 'fetched successfully' }
    },
    {
      maxAttempts: 5,
      backoff: 'exponential',
      initialInterval: 200,
      onRetry: (attempt, error, delayMs) => {
        console.log(`  retry ${attempt} after ${delayMs}ms`)
      }
    }
  )

  try {
    const result = await fetchWithRetry('https://api.example.com')
    console.log('  success:', result)
  } catch (err) {
    console.log('  failed:', err.message)
  }

  // example 5: database retry pattern
  console.log('\n6. Database retry pattern:')
  dbCallCount = 0
  try {
    const result = await withRetry(
      () => flakeyDatabaseQuery('SELECT * FROM users'),
      {
        ...retryPatterns.database,
        shouldRetry: shouldRetryError.transient,
        onRetry: (attempt, error, delayMs) => {
          console.log(`  retry ${attempt} after ${delayMs}ms: ${error.message}`)
        }
      }
    )
    console.log('  success:', result)
  } catch (err) {
    console.log('  failed:', err.message)
  }

  // example 6: timeout with retry
  console.log('\n7. Retry with timeout:')
  try {
    const result = await withRetry(
      async () => {
        await new Promise(resolve => setTimeout(resolve, 3000))
        return 'too slow'
      },
      {
        maxAttempts: 2,
        timeout: '1s',
        onRetry: (attempt, error, delayMs) => {
          console.log(`  retry ${attempt} after ${delayMs}ms: ${error.message}`)
        }
      }
    )
    console.log('  success:', result)
  } catch (err) {
    console.log('  failed:', err.message)
  }

  // example 7: linear backoff
  console.log('\n8. Linear backoff (1s, 2s, 3s):')
  apiCallCount = 0
  try {
    const result = await withRetry(() => unreliableApiCall('/linear'), {
      maxAttempts: 4,
      backoff: 'linear',
      initialInterval: 1000,
      onRetry: (attempt, error, delayMs) => {
        console.log(`  retry ${attempt} after ${delayMs}ms`)
      }
    })
    console.log('  success:', result)
  } catch (err) {
    console.log('  failed:', err.message)
  }

  // example 8: constant backoff
  console.log('\n9. Constant backoff (500ms every time):')
  apiCallCount = 0
  try {
    const result = await withRetry(() => unreliableApiCall('/constant'), {
      maxAttempts: 4,
      backoff: 'constant',
      initialInterval: 500,
      onRetry: (attempt, error, delayMs) => {
        console.log(`  retry ${attempt} after ${delayMs}ms`)
      }
    })
    console.log('  success:', result)
  } catch (err) {
    console.log('  failed:', err.message)
  }

  console.log('\n=== All examples completed ===')
}

main().catch(console.error)

