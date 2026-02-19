# activities

activities are where the actual work happens. they call apis, write to databases, send emails, process files, whatever your application needs to do.

the key thing about activities is theyre automatically retried, timed out, and monitored. you just write the logic and let worlds-engine handle the reliability.

## defining activities

```typescript
import { activity } from 'worlds-engine'

const sendEmail = activity('send-email', async (ctx, input) => {
  // ctx = activity context
  // input = whatever the workflow passes
  
  await emailService.send(input.to, input.subject, input.body)
  
  return { sent: true, timestamp: Date.now() }
}, {
  retry: { maxAttempts: 3, backoff: 'exponential' },
  timeout: '30s',
  heartbeatTimeout: '10s'
})
```

## activity context

the context gives you these methods:

### ctx.heartbeat(message)

send a heartbeat to prove youre still alive:

```typescript
const processBatch = activity('batch', async (ctx, { items }) => {
  for (let i = 0; i < items.length; i++) {
    await processItem(items[i])
    ctx.heartbeat(`processed ${i+1}/${items.length}`)
  }
})
```

if you dont send heartbeats within the configured timeout, the activity is considered dead and gets retried.

### ctx.isCancelled()

check if the workflow was cancelled:

```typescript
const longProcess = activity('long', async (ctx, data) => {
  for (const chunk of data.chunks) {
    if (ctx.isCancelled()) {
      return { cancelled: true, processed: chunk.index }
    }
    await processChunk(chunk)
  }
})
```

### ctx.activityId, ctx.workflowId, ctx.attempt

access metadata:

```typescript
console.log('attempt', ctx.attempt, 'of activity', ctx.activityId)
```

## activity options

```typescript
activity('name', handler, {
  retry: {
    maxAttempts: 3,           // how many times to retry
    backoff: 'exponential',   // 'linear' | 'exponential' | 'constant'
    initialInterval: 1000,    // first retry delay (ms)
    maxInterval: 60000,       // cap on retry delay
    multiplier: 2,            // for exponential backoff
  },
  timeout: '30s',             // max execution time ('30s', '5m', '1h')
  heartbeatTimeout: '10s',    // max time between heartbeats
  taskQueue: 'critical',      // route to specific workers
})
```

## retry strategies

### exponential backoff (recommended)

backs off exponentially: 1s, 2s, 4s, 8s, etc. good for most cases.

```typescript
retry: {
  maxAttempts: 5,
  backoff: 'exponential',
  initialInterval: 1000,
  maxInterval: 60000,
  multiplier: 2
}
```

### linear backoff

increases linearly: 1s, 2s, 3s, 4s, etc.

```typescript
retry: {
  maxAttempts: 5,
  backoff: 'linear',
  initialInterval: 1000
}
```

### constant backoff

same delay every time: 5s, 5s, 5s, etc.

```typescript
retry: {
  maxAttempts: 3,
  backoff: 'constant',
  initialInterval: 5000
}
```

## timeouts

activities can have execution timeouts:

```typescript
activity('slow-api', handler, {
  timeout: '30s',  // must complete in 30 seconds
  retry: { maxAttempts: 3 }
})
```

timeout formats: `'30s'`, `'5m'`, `'2h'`, `'500ms'`

if an activity times out, its retried according to retry config.

## heartbeats

for long-running activities, use heartbeats to prove progress:

```typescript
const processVideo = activity('video', async (ctx, { videoUrl }) => {
  ctx.heartbeat('downloading')
  const video = await download(videoUrl)
  
  ctx.heartbeat('transcoding')
  const transcoded = await transcode(video)
  
  ctx.heartbeat('uploading')
  const url = await upload(transcoded)
  
  return { url }
}, {
  timeout: '10m',
  heartbeatTimeout: '30s'
})
```

if no heartbeat is received within `heartbeatTimeout`, the activity is considered stuck and gets retried.

## idempotency

activities should be idempotent when possible. that means if you run them multiple times with the same input, the result is the same.

this is important because activities can be retried if they timeout or the process crashes.

**idempotent (good):**

```typescript
// sets a value (running twice has same effect)
await db.users.update(userId, { status: 'active' })

// checks then creates if missing
const user = await db.users.findOrCreate(email, userData)
```

**not idempotent (be careful):**

```typescript
// increments a counter (running twice increments twice)
await db.users.increment(userId, 'loginCount', 1)

// sends an email (user gets multiple emails)
await emailService.send(email, subject, body)
```

for non-idempotent operations, you might need to:

1. use unique IDs to deduplicate
2. check if the operation already happened
3. design your system to tolerate duplicates

## patterns

### batch processing

process items in batches with progress tracking:

```typescript
const processBatch = activity('batch', async (ctx, { items, batchSize }) => {
  const results = []
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map(item => processItem(item))
    )
    results.push(...batchResults)
    
    ctx.heartbeat(`processed ${i + batch.length}/${items.length}`)
  }
  
  return { processed: results.length }
}, {
  timeout: '30m',
  heartbeatTimeout: '1m'
})
```

### external api calls

wrap api calls with retry logic:

```typescript
const callApi = activity('api-call', async (ctx, { endpoint, data }) => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  
  if (!response.ok) {
    throw new Error(`api error: ${response.status}`)
  }
  
  return await response.json()
}, {
  retry: {
    maxAttempts: 5,
    backoff: 'exponential',
    initialInterval: 1000,
    maxInterval: 30000
  },
  timeout: '30s'
})
```

### database operations

activities are perfect for database operations:

```typescript
const saveOrder = activity('save-order', async (ctx, order) => {
  return await db.orders.create({
    id: order.id,
    userId: order.userId,
    items: order.items,
    total: order.total,
    status: 'pending'
  })
}, {
  retry: { maxAttempts: 3, backoff: 'exponential' }
})
```

### file processing

process files with progress tracking:

```typescript
const processFile = activity('process-file', async (ctx, { filePath }) => {
  ctx.heartbeat('reading file')
  const content = await fs.readFile(filePath)
  
  ctx.heartbeat('parsing')
  const data = JSON.parse(content.toString())
  
  ctx.heartbeat('validating')
  const valid = validateData(data)
  if (!valid) throw new Error('invalid data')
  
  ctx.heartbeat('storing')
  await db.data.insertMany(data)
  
  return { records: data.length }
}, {
  timeout: '5m',
  heartbeatTimeout: '30s'
})
```

## error handling

activities can throw errors. the retry logic handles transient failures:

```typescript
const riskyOperation = activity('risky', async (ctx, data) => {
  try {
    return await externalService.call(data)
  } catch (err) {
    if (err.code === 'RATE_LIMIT') {
      // will be retried with backoff
      throw new Error('rate limited, retry later')
    }
    
    if (err.code === 'INVALID_INPUT') {
      // no point retrying
      throw new Error('invalid input, cannot retry')
    }
    
    throw err
  }
}, {
  retry: { maxAttempts: 5, backoff: 'exponential' }
})
```

## activity state

you can query activity state through the workflow:

```typescript
const workflowState = await world.query(workflowId)

for (const activity of workflowState.activities) {
  console.log(activity.name)          // activity name
  console.log(activity.status)        // 'pending' | 'running' | 'completed' | 'failed' | 'retrying'
  console.log(activity.attempt)       // current attempt number
  console.log(activity.result)        // result if completed
  console.log(activity.error)         // error if failed
  console.log(activity.lastHeartbeat) // last heartbeat time
}
```

## testing activities

you can test activities directly:

```typescript
import { activity } from 'worlds-engine'

const myActivity = activity('test', async (ctx, input) => {
  return { value: input.x * 2 }
})

// create a mock context
const mockContext = {
  activityId: 'test-1',
  workflowId: 'workflow-1',
  attempt: 1,
  heartbeat: () => {},
  isCancelled: () => false
}

const result = await myActivity.handler(mockContext, { x: 5 })
expect(result.value).toBe(10)
```

## best practices

1. **keep activities focused** - each activity should do one thing
2. **make them idempotent** - safe to retry
3. **use heartbeats** - for long-running operations
4. **timeout appropriately** - dont let activities hang forever
5. **handle errors** - differentiate between retryable and permanent failures
6. **log progress** - use heartbeat messages for visibility

## next

- [failure-strategies.md](./failure-strategies.md) - handling failures and compensations

