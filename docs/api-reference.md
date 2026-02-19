# api reference

complete api documentation for athena-js workflow orchestration system

## core primitives

### workflow

create workflow definition

```typescript
workflow<T R>(
  name: string
  handler: (ctx: WorkflowContext input: T) => Promise<R>
  options?: WorkflowOptions
): Workflow<T R>
```

parameters

- name: unique workflow identifier
- handler: async function executing workflow logic
- options: optional workflow configuration

workflow options

```typescript
interface WorkflowOptions {
  workflowId?: string
  failureStrategy?: 'cascade' | 'compensate' | 'retry' | 'ignore' | 'quarantine'
  timeout?: string | number
  parentId?: string
  taskQueue?: string
}
```

example

```typescript
const orderWorkflow = workflow('process-order' async (ctx order) => {
  const payment = await ctx.run(chargePayment order)
  ctx.addCompensation(() => ctx.run(refundPayment payment))
  return { orderId: order.id status: 'completed' }
} {
  failureStrategy: 'compensate'
  timeout: 60000
})
```

### activity

create activity definition

```typescript
activity<T R>(
  name: string
  handler: (ctx: ActivityContext input: T) => Promise<R>
  options?: ActivityOptions
): Activity<T R>
```

parameters

- name: unique activity identifier
- handler: async function executing business logic
- options: optional activity configuration

activity options

```typescript
interface ActivityOptions {
  retry?: {
    maxAttempts: number
    backoff?: 'linear' | 'exponential' | 'constant'
    initialInterval?: number
    maxInterval?: number
    multiplier?: number
  }
  timeout?: string | number
  heartbeatTimeout?: string | number
  taskQueue?: string
}
```

example

```typescript
const sendEmail = activity('send-email' async (ctx email) => {
  ctx.heartbeat('connecting to smtp')
  await smtp.connect()
  
  ctx.heartbeat('sending email')
  await smtp.send(email)
  
  return { messageId: '123' success: true }
} {
  retry: {
    maxAttempts: 3
    backoff: 'exponential'
    initialInterval: 1000
    maxInterval: 30000
  }
  timeout: 60000
  heartbeatTimeout: 10000
})
```

### world

central orchestrator managing worker pool

```typescript
class World {
  constructor(config?: WorldConfig world?: World)
  
  register(...items: (Workflow | Activity)[]): void
  async start(): Promise<void>
  async shutdown(): Promise<void>
  async execute<T R>(name: string input: T options?: WorkflowOptions): Promise<WorkflowHandle<R>>
  async query(workflowId: string): Promise<WorkflowState>
  async queryWorkflows(filters: WorkflowQueryFilter): Promise<WorkflowState[]>
  async schedule(id: string name: string input: any cron: string): Promise<void>
  async scheduleOnce(name: string input: any executeAt: number): Promise<string>
  async pauseSchedule(id: string): Promise<void>
  async resumeSchedule(id: string): Promise<void>
  async deleteSchedule(id: string): Promise<void>
  getSchedules(): ScheduleConfig[]
  getMetrics(): WorldMetrics
  getWorkers(): WorkerInfo[]
  getWorld(): World
}
```

world config

```typescript
interface WorldConfig {
  minWorkers?: number
  maxWorkers?: number
  scaleThreshold?: number
  scaleDownThreshold?: number
  persistence?: 'memory' | 'file' | 'hybrid'
  persistencePath?: string
  failureStrategy?: FailureStrategy
  heartbeatInterval?: number
  heartbeatTimeout?: number
  taskQueues?: string[]
}
```

example

```typescript
const world = new World({
  minWorkers: 2
  maxWorkers: 10
  scaleThreshold: 0.7
  persistence: 'hybrid'
  persistencePath: '.athena-js'
  failureStrategy: 'retry'
})

world.register(orderWorkflow chargePayment refundPayment)
await world.start()

const handle = await world.execute('process-order' order {
  workflowId: `order-${order.id}`
})
```

## workflow context

methods available inside workflow handler

### ctx.run

execute activity within workflow

```typescript
ctx.run<T R>(activity: Activity<T R> input: T): Promise<R>
```

example

```typescript
const result = await ctx.run(sendEmail {
  to: 'user@example.com'
  subject: 'hello'
})
```

### ctx.executeChild

spawn child workflow

```typescript
ctx.executeChild<T R>(
  name: string
  input: T
  options?: WorkflowOptions
): Promise<WorkflowHandle<R>>
```

example

```typescript
const child = await ctx.executeChild('process-item' item)
const childResult = await child.result()
```

### ctx.addCompensation

register compensation function for saga pattern

```typescript
ctx.addCompensation(fn: () => Promise<void>): void
```

example

```typescript
const payment = await ctx.run(chargeCard amount)
ctx.addCompensation(() => ctx.run(refundCard payment))
```

### ctx.isCancelled

check if workflow cancelled

```typescript
ctx.isCancelled(): boolean
```

example

```typescript
if (ctx.isCancelled()) {
  return { status: 'cancelled' }
}
```

### ctx.sleep

deterministic sleep

```typescript
ctx.sleep(ms: number): Promise<void>
```

example

```typescript
await ctx.sleep(5000)
console.log('5 seconds later')
```

### ctx.fetch

http request with retry semantics

```typescript
ctx.fetch(url: string init?: RequestInit): Promise<Response>
```

example

```typescript
const response = await ctx.fetch('https://api.example.com/data')
const data = await response.json()
```

### ctx.createHook

create external integration hook

```typescript
ctx.createHook<T>(): Promise<Hook<T>>
```

example

```typescript
const approvalHook = await ctx.createHook<{ approved: boolean }>()
console.log(`send approval to token: ${approvalHook.token}`)
const result = await approvalHook.wait()
```

### ctx.createWebhook

create webhook endpoint

```typescript
ctx.createWebhook(): Promise<Webhook>
```

example

```typescript
const webhook = await ctx.createWebhook()
console.log(`webhook url: ${webhook.url}`)
const request = await webhook.wait()
```

### ctx.getWritable

get workflow stream

```typescript
ctx.getWritable(): WritableStream<any>
```

example

```typescript
const stream = ctx.getWritable()
const writer = stream.getWriter()
await writer.write({ progress: 50 })
```

### ctx.getMetadata

get workflow metadata

```typescript
ctx.getMetadata(): WorkflowMetadata
```

example

```typescript
const metadata = ctx.getMetadata()
console.log(metadata.workflowId)
console.log(metadata.startedAt)
```

## activity context

methods available inside activity handler

### ctx.heartbeat

send heartbeat signal

```typescript
ctx.heartbeat(message?: string): void
```

example

```typescript
for (const item of items) {
  await process(item)
  ctx.heartbeat(`processed ${item.id}`)
}
```

### ctx.isCancelled

check if activity cancelled

```typescript
ctx.isCancelled(): boolean
```

example

```typescript
if (ctx.isCancelled()) {
  await cleanup()
  return
}
```

## workflow functions

functions available inside workflow functions

### getWorkflowMetadata

get current workflow context

```typescript
import { getWorkflowMetadata } from 'athena-js'

getWorkflowMetadata(): WorkflowMetadata
```

returns

```typescript
interface WorkflowMetadata {
  workflowId: string
  runId: string
  parentId?: string
  startedAt: number
  currentStep?: string
}
```

example

```typescript
const myWorkflow = workflow('example' async (ctx input) => {
  const metadata = getWorkflowMetadata()
  console.log(`running workflow ${metadata.workflowId}`)
  return { metadata }
})
```

### getStepMetadata

get current step context

```typescript
import { getStepMetadata } from 'athena-js'

getStepMetadata(): StepMetadata
```

returns

```typescript
interface StepMetadata {
  stepId: string
  stepName: string
  workflowId: string
  attempt: number
  startedAt: number
}
```

example

```typescript
const myActivity = activity('step' async (ctx input) => {
  const stepInfo = getStepMetadata()
  console.log(`step ${stepInfo.stepName} attempt ${stepInfo.attempt}`)
  return { stepInfo }
})
```

### sleep

deterministic sleep

```typescript
import { sleep } from 'athena-js'

sleep(ms: number): Promise<void>
```

example

```typescript
await sleep(5000)
console.log('resumed after 5 seconds')
```

### fetch

http request with retry

```typescript
import { fetch } from 'athena-js'

fetch(url: string init?: RequestInit): Promise<Response>
```

example

```typescript
const response = await fetch('https://api.example.com/data' {
  method: 'POST'
  headers: { 'content-type': 'application/json' }
  body: JSON.stringify({ key: 'value' })
})
```

### createHook

create low level hook

```typescript
import { createHook } from 'athena-js'

createHook<T>(): Promise<Hook<T>>
```

returns

```typescript
interface Hook<T> {
  id: string
  token: string
  resume: (payload: T) => Promise<void>
  wait: () => Promise<T>
}
```

example

```typescript
const hook = await createHook<{ approved: boolean }>()
console.log(`hook token: ${hook.token}`)

setTimeout(() => {
  hook.resume({ approved: true })
} 5000)

const result = await hook.wait()
console.log(`approval: ${result.approved}`)
```

### defineHook

create type safe hook factory

```typescript
import { defineHook } from 'athena-js'

defineHook<T>(): { create: () => Promise<Hook<T>> }
```

example

```typescript
const approvalHook = defineHook<{ approved: boolean; approver: string }>()
const hook = await approvalHook.create()
```

### createWebhook

create webhook endpoint

```typescript
import { createWebhook } from 'athena-js'

createWebhook(): Promise<Webhook>
```

returns

```typescript
interface Webhook {
  id: string
  url: string
  token: string
  wait: () => Promise<Request>
}
```

example

```typescript
const webhook = await createWebhook()
console.log(`webhook url: ${webhook.url}`)

const request = await webhook.wait()
console.log(`received ${request.method} request`)
```

### getWritable

get workflow stream

```typescript
import { getWritable } from 'athena-js'

getWritable(): WritableStream<any>
```

example

```typescript
const stream = getWritable()
const writer = stream.getWriter()

for (let i = 0; i < 100; i++) {
  await writer.write({ progress: i percent: i / 100 })
  await sleep(100)
}

await writer.close()
```

## runtime api

functions used outside workflow and step functions

### start

start new workflow run

```typescript
import { start } from 'athena-js'

start<T R>(
  name: string
  input: T
  options?: WorkflowOptions
): Promise<WorkflowHandle<R>>
```

example

```typescript
const handle = await start('process-order' order {
  workflowId: `order-${order.id}`
})

const result = await handle.result()
```

### resumeHook

resume workflow via hook

```typescript
import { resumeHook } from 'athena-js'

resumeHook<T>(token: string payload: T): Promise<void>
```

example

```typescript
await resumeHook('hook_abc123_456789' {
  approved: true
  approver: 'admin'
})
```

### resumeWebhook

resume workflow via webhook

```typescript
import { resumeWebhook } from 'athena-js'

resumeWebhook(token: string request: Request): Promise<void>
```

example

```typescript
await resumeWebhook('webhook_abc123_456789' new Request('https://example.com' {
  method: 'POST'
  body: JSON.stringify({ data: 'value' })
}))
```

### getRun

get workflow state

```typescript
import { getRun } from 'athena-js'

getRun(workflowId: string): Promise<WorkflowState>
```

returns

```typescript
interface WorkflowState {
  workflowId: string
  runId: string
  status: WorkflowStatus
  input: any
  result?: any
  error?: string
  startedAt: number
  completedAt?: number
  parentId?: string
  childIds: string[]
  activities: ActivityState[]
  compensations: CompensationState[]
  history: WorkflowEvent[]
  hooks?: HookState[]
  webhooks?: WebhookState[]
  stream?: any[]
}
```

example

```typescript
const state = await getRun('order-123')
console.log(`status: ${state.status}`)
console.log(`activities: ${state.activities.length}`)
```

### queryRuns

filter multiple workflow runs

```typescript
import { queryRuns } from 'athena-js'

queryRuns(filters: {
  status?: string | string[]
  workflowName?: string
  limit?: number
}): Promise<WorkflowState[]>
```

example

```typescript
const completed = await queryRuns({
  status: 'completed'
  limit: 10
})

const failed = await queryRuns({
  status: ['failed' 'compensated']
  workflowName: 'process-order'
})
```

### initializeRuntime

connect runtime to world

```typescript
import { initializeRuntime } from 'athena-js'

initializeRuntime(world: World): void
```

example

```typescript
const world = new World(config)
initializeRuntime(world)
await world.start()

const handle = await start('workflow' input)
```

## error classes

### FatalError

unrecoverable error without retry

```typescript
import { FatalError } from 'athena-js'

class FatalError extends Error {
  constructor(message: string)
}
```

example

```typescript
if (invalidInput) {
  throw new FatalError('input validation failed')
}
```

### RetryableError

transient error with retry

```typescript
import { RetryableError } from 'athena-js'

class RetryableError extends Error {
  constructor(message: string retryAfter?: number)
  retryAfter?: number
}
```

example

```typescript
if (networkTimeout) {
  throw new RetryableError('network timeout' 5000)
}
```

## worlds

infrastructure abstraction layer

### world interface

```typescript
interface World {
  storage: Store
  queue: QueueProvider
  auth: AuthProvider
  stream: StreamProvider
  webhookBaseUrl: string
  
  initialize(): Promise<void>
  shutdown(): Promise<void>
  generateWebhookUrl(webhookId: string token: string): string
}
```

### local world

default implementation

```typescript
import { LocalWorld } from 'athena-js'

class LocalWorld extends World {
  constructor(config?: Partial<WorldConfig>)
}
```

example

```typescript
const world = new LocalWorld({
  webhookBaseUrl: 'http://localhost:3000/webhooks'
})

const world = new World(config world)
```

### custom world

extend for custom infrastructure

```typescript
import { World type WorldConfig } from 'athena-js'

class CustomWorld extends World {
  constructor(config: WorldConfig) {
    super(config)
  }
  
  async initialize(): Promise<void> {
    // custom initialization
  }
  
  async shutdown(): Promise<void> {
    // custom cleanup
  }
}
```

## retry utilities

standalone retry functions

### withRetry

wrap function with retry logic

```typescript
import { withRetry } from 'athena-js'

withRetry<T>(
  fn: () => Promise<T>
  config: RetryConfig
  onRetry?: (attempt: number error: Error delay: number) => void
): Promise<T>
```

example

```typescript
const result = await withRetry(
  () => unreliableApiCall()
  { maxAttempts: 5 backoff: 'exponential' initialInterval: 1000 }
  (attempt error delay) => {
    console.log(`retry ${attempt} after ${delay}ms: ${error.message}`)
  }
)
```

### retryable

create retryable function

```typescript
import { retryable } from 'athena-js'

retryable<T extends any[] R>(
  fn: (...args: T) => Promise<R>
  config: RetryConfig
): (...args: T) => Promise<R>
```

example

```typescript
const reliableApiCall = retryable(
  async (endpoint: string) => {
    return await fetch(endpoint)
  }
  { maxAttempts: 3 backoff: 'exponential' }
)

const response = await reliableApiCall('/api/data')
```

### retry patterns

predefined retry configurations

```typescript
import { retryPatterns } from 'athena-js'

retryPatterns: {
  aggressive: RetryConfig
  standard: RetryConfig
  conservative: RetryConfig
  minimal: RetryConfig
  exponential: RetryConfig
  linear: RetryConfig
}
```

example

```typescript
const result = await withRetry(
  () => apiCall()
  retryPatterns.aggressive
)
```

## directives

compile time transformations

### workflow directive

marks function as workflow orchestrator

```typescript
'use workflow'
```

example

```typescript
const myWorkflow = async (ctx input) => {
  'use workflow'
  
  const result = await ctx.run(activity input)
  return result
}
```

### step directive

marks function as side effecting operation

```typescript
'use step'
```

example

```typescript
const myStep = async (ctx input) => {
  'use step'
  
  await database.write(input)
  return { success: true }
}
```

## types

typescript type definitions

### workflow types

```typescript
type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'compensating' | 'compensated'
type FailureStrategy = 'cascade' | 'compensate' | 'retry' | 'ignore' | 'quarantine'
type BackoffStrategy = 'linear' | 'exponential' | 'constant'

interface Workflow<T R> {
  name: string
  handler: (ctx: WorkflowContext input: T) => Promise<R>
  options: WorkflowOptions
}

interface WorkflowHandle<T> {
  id: string
  workflowId: string
  result: () => Promise<T>
  query: () => Promise<WorkflowState>
  cancel: () => Promise<void>
}
```

### activity types

```typescript
type ActivityStatus = 'pending' | 'running' | 'completed' | 'failed' | 'retrying'

interface Activity<T R> {
  name: string
  handler: (ctx: ActivityContext input: T) => Promise<R>
  options: ActivityOptions
}

interface ActivityContext {
  activityId: string
  workflowId: string
  attempt: number
  heartbeat: (message?: string) => void
  isCancelled: () => boolean
}
```

### worker types

```typescript
type WorkerStatus = 'idle' | 'busy' | 'stopping' | 'stopped'

interface WorkerInfo {
  id: string
  status: WorkerStatus
  currentTask?: {
    id: string
    name: string
    startedAt: number
  }
  lastHeartbeat: number
  taskQueue?: string
  tasksCompleted: number
}
```

built by floris from XYLEX Group
