# retry patterns example

this example shows how to add retry logic with backoff to any async function without needing full workflow orchestration.

## what it demonstrates

- basic retry with default settings
- custom retry configuration
- using predefined retry patterns (api, database, network)
- conditional retry based on error type
- creating retryable functions
- different backoff strategies (exponential, linear, constant)
- retry with timeout

## when to use this

use the standalone retry utilities when you:

- have existing functions that need retry logic
- dont need full workflow orchestration
- want simple retry behavior for api calls, database queries, etc
- are wrapping third-party libraries

## when to use workflows instead

use workflows when you:

- need complex orchestration across multiple services
- need compensation logic (saga pattern)
- need to coordinate long-running processes
- need parent/child relationships
- need scheduling

## running the example

```bash
npm install
npm start
```

## key concepts

### basic retry

```typescript
import { withRetry } from 'worlds-engine'

const result = await withRetry(
  () => fetch('https://api.example.com/data'),
  { maxAttempts: 3, backoff: 'exponential' }
)
```

### retryable function

```typescript
import { retryable } from 'worlds-engine'

const fetchWithRetry = retryable(
  async (url: string) => {
    const res = await fetch(url)
    return res.json()
  },
  { maxAttempts: 5, backoff: 'exponential' }
)

const data = await fetchWithRetry('https://api.example.com')
```

### predefined patterns

```typescript
import { withRetry, retryPatterns } from 'worlds-engine'

// api pattern: 5 attempts, exponential backoff
await withRetry(apiCall, retryPatterns.api)

// database pattern: 3 attempts, shorter intervals
await withRetry(dbQuery, retryPatterns.database)

// network pattern: 5 attempts, longer intervals
await withRetry(networkOp, retryPatterns.network)
```

### conditional retry

```typescript
import { withRetry, shouldRetryError } from 'worlds-engine'

await withRetry(riskyOperation, {
  maxAttempts: 3,
  shouldRetry: shouldRetryError.transient // only retry network/rate limit/server errors
})
```

## backoff strategies

**exponential**: delays increase exponentially (1s, 2s, 4s, 8s)

- best for most cases
- backs off quickly to avoid overwhelming services

**linear**: delays increase linearly (1s, 2s, 3s, 4s)

- predictable timing
- good for known recovery times

**constant**: same delay every time (1s, 1s, 1s, 1s)

- simple and predictable
- good for quick retries

## error handling

you can decide which errors to retry:

```typescript
await withRetry(operation, {
  shouldRetry: (error) => {
    // only retry network errors
    if (error.message.includes('network')) return true
    // dont retry validation errors
    if (error.message.includes('validation')) return false
    return true
  }
})
```

## monitoring retries

track retry attempts:

```typescript
await withRetry(operation, {
  onRetry: (attempt, error, delayMs) => {
    console.log(`retry ${attempt} after ${delayMs}ms: ${error.message}`)
    // or send to your monitoring service
  }
})
```
