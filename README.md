# worlds-engine

for people who dont want to go to temporal with a trash fucking ui and sdk that i dont understand or feelss arcane

oh ye and my home slice caran needed workflow done

built by floris from XYLEX Group

## overview

worlds-engine provides workflow orchestration capabilities through a world based architecture where workers execute tasks from queues with automatic retry mechanisms saga pattern compensation logic and event sourcing for deterministic replay

the system handles distributed workflow execution across multiple worker processes with automatic scaling based on workload persistence through file or memory storage and comprehensive failure handling strategies

## architecture components

### worlds orchestrator

the world manages the complete lifecycle of workflow execution including worker spawning task routing queue management and metrics collection

configuration parameters

- minWorkers: minimum worker count default 2
- maxWorkers: maximum worker count default 10
- scaleThreshold: workload percentage triggering scale up default 0.7
- scaleDownThreshold: workload percentage triggering scale down default 0.3
- persistence: storage mode memory file or hybrid default hybrid
- persistencePath: filesystem location for persistent storage default .worlds-engine
- failureStrategy: default failure handling mode default retry
- heartbeatInterval: milliseconds between heartbeat signals default 5000
- heartbeatTimeout: milliseconds before considering process dead default 30000

### worker workers

workers poll task queues execute workflow and activity logic send heartbeat signals and handle cancellation gracefully

each worker maintains

- unique identifier
- status state idle busy stopping stopped
- current task reference
- last heartbeat timestamp
- tasks completed counter
- optional task queue assignment

### workflow engine

workflows orchestrate activities through deterministic execution with event sourcing enabling crash recovery and replay

workflow capabilities

- execute activities with retry logic
- spawn child workflows with parent relationships
- add compensation functions for saga pattern
- sleep for arbitrary durations
- query cancellation state
- access workflow metadata

workflow context methods

```typescript
ctx.run<T R>(activity: Activity<T R> input: T): Promise<R>
ctx.executeChild<T R>(name: string input: T options?: WorkflowOptions): Promise<WorkflowHandle<R>>
ctx.addCompensation(fn: () => Promise<void>): void
ctx.isCancelled(): boolean
ctx.sleep(ms: number): Promise<void>
ctx.fetch(url: string init?: RequestInit): Promise<Response>
ctx.createHook<T>(): Promise<Hook<T>>
ctx.createWebhook(): Promise<Webhook>
ctx.getWritable(): WritableStream<any>
ctx.getMetadata(): WorkflowMetadata
ctx.workflowId: string
ctx.runId: string
ctx.parentId?: string
```

### workflow dev kit api

worlds-engine implements workflow dev kit compatible api for modern workflow orchestration

#### workflow functions

functions available inside workflow functions

```typescript
import {
  getWorkflowMetadata
  getStepMetadata
  sleep
  fetch
  createHook
  defineHook
  createWebhook
  getWritable
} from 'worlds-engine'
```

getWorkflowMetadata returns context about current workflow execution

```typescript
const metadata = getWorkflowMetadata()
console.log(metadata.workflowId)
console.log(metadata.startedAt)
```

getStepMetadata returns context about current step execution

```typescript
const stepInfo = getStepMetadata()
console.log(stepInfo.stepId)
console.log(stepInfo.attempt)
```

sleep suspends workflow for specified duration deterministically

```typescript
await sleep(5000)
```

fetch makes http requests with automatic retry semantics

```typescript
const response = await fetch('https://api.example.com/data')
const data = await response.json()
```

createHook creates low level hook to receive arbitrary payloads

```typescript
const hook = await createHook<{ approved: boolean }>()
console.log(`hook token: ${hook.token}`)
const payload = await hook.wait()
```

defineHook creates type safe hook factory

```typescript
const approvalHook = defineHook<{ approved: boolean; approver: string }>()
const hook = await approvalHook.create()
```

createWebhook suspends workflow until http request received

```typescript
const webhook = await createWebhook()
console.log(`webhook url: ${webhook.url}`)
const request = await webhook.wait()
```

getWritable accesses current workflow run default stream

```typescript
const stream = getWritable()
const writer = stream.getWriter()
await writer.write({ progress: 50 data: 'processing' })
```

#### runtime api

functions used outside workflow and step functions

```typescript
import {
  start
  resumeHook
  resumeWebhook
  getRun
  queryRuns
  initializeRuntime
} from 'worlds-engine'
```

start enqueues new workflow run

```typescript
const handle = await start('workflow-name' input {
  workflowId: 'unique-id'
})
```

resumeHook resumes workflow by sending payload to hook

```typescript
await resumeHook(hookToken { approved: true })
```

resumeWebhook resumes workflow by sending request to webhook

```typescript
await resumeWebhook(webhookToken new Request(url { method: 'POST' }))
```

getRun gets workflow run status without waiting for completion

```typescript
const state = await getRun(workflowId)
console.log(state.status)
console.log(state.activities)
```

queryRuns filters multiple workflow runs

```typescript
const runs = await queryRuns({
  status: 'completed'
  limit: 10
})
```

initializeRuntime connects runtime api to world instance

```typescript
const world = new World(config)
initializeRuntime(world)
await world.start()
```

#### error classes

FatalError marks step as failed without retry

```typescript
import { FatalError } from 'worlds-engine'

throw new FatalError('unrecoverable error')
```

RetryableError marks step as retryable with optional delay

```typescript
import { RetryableError } from 'worlds-engine'

throw new RetryableError('transient error' 5000)
```

### worlds infrastructure abstraction

worlds provide pluggable backend for storage queuing authentication and streaming

#### world interface

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

#### local world

default world implementation for development

```typescript
import { LocalWorld } from 'worlds-engine'

const world = new LocalWorld({
  webhookBaseUrl: 'http://localhost:3000/webhooks'
})

const world = new World(config world)
```

#### custom worlds

extend world class for custom infrastructure

```typescript
import { World type WorldConfig } from 'worlds-engine'

class MyCustomWorld extends World {
  constructor(config: WorldConfig) {
    super(config)
  }
  
  async initialize(): Promise<void> {
    await this.storage.initialize()
  }
  
  async shutdown(): Promise<void> {
    await this.storage.shutdown()
  }
}
```

### directives

workflow and step directives enable compile time transformations

#### use workflow directive

marks function as workflow orchestrator

```typescript
const myWorkflow = async (ctx input) => {
  'use workflow'
  
  const result = await ctx.run(myActivity input)
  return result
}
```

#### use step directive

marks function as side effecting operation

```typescript
const myStep = async (ctx input) => {
  'use step'
  
  await database.write(input)
  return { success: true }
}
```

directives enable

- deterministic execution for workflows
- sandboxed replay for crash recovery
- side effect tracking for steps
- stable id generation
- transformation modes

### activity execution

activities encapsulate business logic with automatic retry exponential backoff timeout handling and heartbeat monitoring

activity configuration

```typescript
{
  retry: {
    maxAttempts: number
    backoff: 'linear' | 'exponential' | 'constant'
    initialInterval: number
    maxInterval: number
    multiplier: number
  }
  timeout: string | number
  heartbeatTimeout: string | number
  taskQueue: string
}
```

activity context methods

```typescript
ctx.heartbeat(message?: string): void
ctx.isCancelled(): boolean
ctx.activityId: string
ctx.workflowId: string
ctx.attempt: number
```

## storage implementations

### memory store

in memory storage using javascript maps provides fast access with no io overhead but loses all state on process termination

operations

- saveWorkflow stores workflow state in map
- getWorkflow retrieves workflow by id
- queryWorkflows filters workflows by criteria
- saveActivity updates activity within workflow
- enqueueTask adds task to priority queue
- dequeueTask removes task based on queue assignment

### file store

filesystem based storage using json files in .worlds-engine directory provides durability across process restarts

directory structure

```
.worlds-engine/
  workflows/
    {workflowId}.json
  schedules/
    {scheduleId}.json
  queue.json
  logs/
    {date}.log
  state/
```

### hybrid store

combines memory and file storage maintaining in memory cache with periodic filesystem sync every 5 seconds providing speed with durability

initialization sequence

1. create file storage directories
2. load workflows from disk into memory
3. load schedules from disk into memory
4. load queue from disk into memory
5. start periodic sync interval

## retry mechanisms

### retry strategies

exponential backoff

```
delay = initialInterval * (multiplier ^ (attempt - 1))
delay = min(delay maxInterval)
delay = delay + (random() * 0.1 * delay)
```

linear backoff

```
delay = initialInterval * attempt
delay = min(delay maxInterval)
delay = delay + (random() * 0.1 * delay)
```

constant backoff

```
delay = initialInterval
delay = delay + (random() * 0.1 * delay)
```

jitter prevents thundering herd by adding 0 to 10 percent random variance

### retry configuration

predefined patterns for common scenarios

```typescript
retryPatterns.api = {
  maxAttempts: 5
  backoff: 'exponential'
  initialInterval: 1000
  maxInterval: 30000
  multiplier: 2
}

retryPatterns.database = {
  maxAttempts: 3
  backoff: 'exponential'
  initialInterval: 500
  maxInterval: 10000
  multiplier: 2
}

retryPatterns.network = {
  maxAttempts: 5
  backoff: 'exponential'
  initialInterval: 2000
  maxInterval: 60000
  multiplier: 3
}
```

### conditional retry

shouldRetryError predicates determine retry eligibility based on error properties

network errors: econnrefused enotfound etimedout network timeout
rate limit errors: rate limit 429
server errors: 500 502 503
transient errors: union of above categories

## saga pattern implementation

compensation functions execute in reverse order lifo when workflow fails

compensation coordinator maintains stack of compensation functions with execution state

workflow saga example

```typescript
const payment = await ctx.run(chargeCard order)
ctx.addCompensation(() => ctx.run(refundCard payment.id))

const reservation = await ctx.run(reserveInventory order)
ctx.addCompensation(() => ctx.run(releaseInventory reservation.id))

await ctx.run(createShipment order)
```

failure triggers compensation execution

1. workflow throws error
2. status changes to compensating
3. compensations execute in reverse order
4. each compensation wrapped in try catch
5. status changes to compensated
6. compensation states recorded in workflow history

## failure strategies

### compensate strategy

executes compensation functions in reverse order to undo completed steps

workflow status progression
pending -> running -> failed -> compensating -> compensated

compensation state

```typescript
{
  id: string
  executed: boolean
  error?: string
}
```

### retry strategy

restarts workflow from beginning with exponential backoff between attempts

workflow retry count tracked in history events
maxRetries default 3 configurable per workflow

### cascade strategy

propagates failure to parent workflow and all child workflows

cascade sequence

1. workflow fails
2. cancel parent if exists
3. cancel all children
4. mark workflow cancelled

### ignore strategy

marks workflow failed without propagation or compensation

final status failed with error recorded

### quarantine strategy

isolates failed workflow preserving full state for debugging

workflow remains in failed status
all history events preserved
no automatic retry or cleanup

## scheduling system

### cron based scheduling

parser interprets cron expressions to calculate next execution time

cron format

```
minute hour day month weekday
0-59   0-23 1-31 1-12  0-6
```

special characters

- asterisk: any value
- slash: step values
- comma: list values
- dash: range values

schedule configuration

```typescript
{
  id: string
  workflowName: string
  input: any | (() => any)
  cronExpression: string
  paused: boolean
  totalExecutions: number
  lastExecution?: number
  nextExecution: number
}
```

### one time scheduling

schedules single workflow execution at specific timestamp

implementation stores timestamp in nextExecution field with empty cronExpression
after execution schedule deleted automatically

## event sourcing

workflow history stores ordered events enabling deterministic replay

event types

- workflow_started: records input and timestamp
- workflow_completed: records result and timestamp
- workflow_failed: records error and timestamp
- workflow_cancelled: records timestamp
- activity_scheduled: records activity name input timestamp
- activity_started: records activity id timestamp
- activity_completed: records result timestamp
- activity_failed: records error attempt timestamp
- activity_retry: records attempt delay timestamp
- activity_heartbeat: records message timestamp
- child_workflow_started: records child id name timestamp
- child_workflow_completed: records child id result timestamp
- compensation_added: records compensation id timestamp
- compensation_executed: records compensation id timestamp
- compensation_failed: records compensation id error timestamp

replay mechanism

1. load workflow state from storage
2. iterate through history events
3. reconstruct workflow state
4. resume from last completed event
5. continue execution

## telemetry system

### logging

logs written to console and .worlds-engine/logs directory with daily rotation

log entry structure

```typescript
{
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error'
  category: 'world' | 'worker' | 'workflow' | 'activity' | 'system'
  message: string
  metadata?: Record<string any>
}
```

log levels filter output based on minimum severity
flush interval 2000 milliseconds batches writes to disk

### metrics collection

tracks workflow throughput success rates workload and resource utilization

metrics structure

```typescript
{
  uptime: number
  workers: {
    total: number
    idle: number
    busy: number
  }
  workflows: {
    queued: number
    running: number
    completed: number
    failed: number
  }
  throughput: {
    perMinute: number
    perHour: number
  }
  workload: number
}
```

throughput calculation uses 60 second rolling window
workload computed as busy workers divided by total workers

### heartbeat monitoring

tracks liveness of workers and activities through periodic heartbeat signals

heartbeat entry

```typescript
{
  id: string
  lastBeat: number
  message?: string
}
```

timeout detection compares current time to last heartbeat
dead entities identified when timeout exceeded

## auto scaling

scaling algorithm evaluates workload every 10 seconds

scale up conditions

```typescript
workload >= scaleThreshold && workers.length < maxWorkers
```

scale up count

```typescript
needed = min(
  ceil((maxWorkers - current) / 2)
  maxWorkers - current
)
```

scale down conditions

```typescript
workload <= scaleDownThreshold && workers.length > minWorkers
```

scale down count

```typescript
toKill = min(
  floor((current - minWorkers) / 2)
  current - minWorkers
)
```

scaling events logged with workload and worker count

## task queue implementation

priority queue implementation sorts tasks by priority then scheduled time

task structure

```typescript
{
  id: string
  type: 'workflow' | 'activity' | 'compensation'
  workflowId: string
  name: string
  input: any
  options: WorkflowOptions | ActivityOptions
  priority?: number
  scheduledAt: number
  taskQueue?: string
}
```

enqueue operation

1. add task to queue array
2. sort by priority descending
3. sort by scheduled time ascending
4. persist queue to storage

dequeue operation with optional queue filter

1. find first matching task
2. remove from queue array
3. persist updated queue
4. return task or undefined

## workflow querying

query filters support complex workflow searches

filter structure

```typescript
{
  status?: WorkflowStatus | WorkflowStatus[]
  workflowName?: string
  parentId?: string
  startedAfter?: number
  startedBefore?: number
  limit?: number
  offset?: number
}
```

query execution

1. load all workflows from storage
2. apply status filter if provided
3. apply name filter if provided
4. apply parent filter if provided
5. apply time range filters if provided
6. sort by started time descending
7. apply offset if provided
8. apply limit if provided
9. return matching workflows

## timeout handling

timeout parsing supports multiple time units

format regex

```
^(\d+)(ms|s|m|h)$
```

conversion factors

- ms: 1
- s: 1000
- m: 60000
- h: 3600000

timeout enforcement uses promise race pattern

```typescript
Promise.race([
  operation()
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error('timeout')) timeoutMs)
  )
])
```

## testing utilities

### test harness

creates isolated world instance with memory storage and controlled time

configuration

```typescript
{
  initialTime?: number
  autoProgress?: boolean
}
```

time control methods

```typescript
advance(ms: number): Promise<void>
advanceTo(timestamp: number): Promise<void>
runUntilComplete(workflowId: string timeout?: number): Promise<void>
```

### time skipper

overrides global time functions for deterministic testing

overridden functions

- Date.now returns controlled time
- setTimeout schedules in virtual time
- setInterval schedules recurring in virtual time

timer management

1. store callback and execution time
2. advance advances virtual time
3. execute callbacks when time reached
4. reschedule intervals automatically

## api reference

### world class

constructor

```typescript
new World(config?: WorldConfig)
```

methods

```typescript
register(...items: (Workflow | Activity)[]): void
start(): Promise<void>
shutdown(): Promise<void>
execute<T R>(name: string input: T options?: WorkflowOptions): Promise<WorkflowHandle<R>>
query(workflowId: string): Promise<WorkflowState>
queryWorkflows(filters: WorkflowQueryFilter): Promise<WorkflowState[]>
schedule(id: string name: string input: any cron: string): Promise<void>
scheduleOnce(name: string input: any executeAt: number): Promise<string>
pauseSchedule(id: string): Promise<void>
resumeSchedule(id: string): Promise<void>
deleteSchedule(id: string): Promise<void>
getSchedules(): ScheduleConfig[]
getMetrics(): WorldMetrics
getWorkers(): WorkerInfo[]
```

### workflow function

creates workflow definition

```typescript
workflow<T R>(
  name: string
  handler: (ctx: WorkflowContext input: T) => Promise<R>
  options?: WorkflowOptions
): Workflow<T R>
```

### activity function

creates activity definition

```typescript
activity<T R>(
  name: string
  handler: (ctx: ActivityContext input: T) => Promise<R>
  options?: ActivityOptions
): Activity<T R>
```

### withRetry function

wraps async function with retry logic

```typescript
withRetry<T>(
  fn: () => Promise<T>
  options?: RetryOptions
): Promise<T>
```

### retryable function

creates retryable version of function

```typescript
retryable<Args Result>(
  fn: (...args: Args) => Promise<Result>
  options?: RetryOptions
): (...args: Args) => Promise<Result>
```

### workflow handle

returned from execute provides workflow control

```typescript
{
  id: string
  workflowId: string
  result(): Promise<T>
  query(): Promise<WorkflowState>
  cancel(): Promise<void>
}
```

## type definitions

all types exported from main package

workflow types

- Workflow: workflow definition
- WorkflowOptions: workflow configuration
- WorkflowContext: execution context
- WorkflowState: queryable state
- WorkflowHandle: control handle
- WorkflowStatus: status enum
- WorkflowEvent: event union type

activity types

- Activity: activity definition
- ActivityOptions: activity configuration
- ActivityContext: execution context
- ActivityState: activity state
- ActivityStatus: status enum

configuration types

- WorldConfig: world configuration
- RetryConfig: retry configuration
- ScheduleConfig: schedule configuration

metric types

- WorldMetrics: world metrics
- WorkerInfo: worker information

query types

- WorkflowQueryFilter: workflow query filters

## usage patterns

basic workflow execution

```typescript
import { World workflow activity } from 'worlds-engine'

const myActivity = activity('name' async (ctx input) => {
  return { result: input.value * 2 }
})

const myWorkflow = workflow('name' async (ctx input) => {
  const result = await ctx.run(myActivity input)
  return result
})

const world = new World()
world.register(myWorkflow myActivity)
await world.start()

const handle = await world.execute('name' { value: 5 })
const result = await handle.result()
```

retry pattern usage

```typescript
import { withRetry retryPatterns } from 'worlds-engine'

const result = await withRetry(
  () => fetch('https://api.example.com')
  retryPatterns.api
)
```

saga pattern usage

```typescript
const saga = workflow('saga' async (ctx order) => {
  const payment = await ctx.run(charge order)
  ctx.addCompensation(() => ctx.run(refund payment))
  
  const inventory = await ctx.run(reserve order)
  ctx.addCompensation(() => ctx.run(release inventory))
  
  await ctx.run(ship order)
})
```

scheduling usage

```typescript
await world.schedule(
  'daily-job'
  'process-reports'
  {}
  '0 9 * * *'
)
```

## performance characteristics

memory store

- enqueue: O(n log n) for sorting
- dequeue: O(n) for filtering
- query: O(n) for filtering

file store

- enqueue: O(n log n) plus file write
- dequeue: O(n) plus file write
- query: O(n * m) where m is file read time

hybrid store

- enqueue: O(n log n) memory operation
- dequeue: O(n) memory operation
- query: O(n) memory operation
- sync: O(n) periodic file writes

workflow execution

- activity retry: exponential time based on backoff
- compensation: linear time based on compensation count
- event sourcing: linear time based on history size

auto scaling

- evaluation: O(1) every 10 seconds
- spawn worker: O(1) process creation
- kill worker: O(1) graceful shutdown

## error handling

error propagation flows through workflow hierarchy based on failure strategy

unhandled errors in activities trigger retry based on retry configuration
exhausted retries bubble to workflow level
workflow failures trigger strategy handler
strategy handler executes compensations retries or cascades

error types preserved through serialization for debugging
stack traces logged but not persisted to avoid storage bloat

## concurrency model

workers execute tasks concurrently using nodejs event loop
each worker runs single task at a time
multiple workers enable parallel execution
task queue coordination prevents duplicate execution

race conditions prevented through

- atomic task dequeue operations
- workflow id uniqueness enforcement
- event log ordering guarantees

## security considerations

file storage uses process umask for permissions
no encryption provided for stored data
task input and output serialized as json
malicious input sanitization responsibility of application

workflow ids should not contain sensitive data
activity results may contain sensitive data
log files may contain sensitive metadata

## deployment patterns

single process deployment

- start world in application process
- workflows execute in same process
- suitable for small to medium workloads

multi process deployment

- share .worlds-engine directory via network filesystem
- each process runs independent world
- coordination through file based queue
- suitable for horizontal scaling

container deployment

- mount .worlds-engine as persistent volume
- single container or multiple with shared volume
- restart resilience through file persistence

## monitoring integration

metrics endpoint exposes world metrics as json
log files parseable as newline delimited json
custom monitoring through onRetry callbacks
external monitoring systems poll metrics endpoint

prometheus integration pattern

```typescript
app.get('/metrics' (req res) => {
  const metrics = world.getMetrics()
  res.send(convertToPrometheusFormat(metrics))
})
```

## migration strategy

workflow state format versioned through history events
breaking changes require migration scripts
migration pattern

1. drain in flight workflows
2. shutdown world
3. run migration script on .worlds-engine
4. update code
5. restart world

backward compatibility maintained within major versions

## debugging workflows

workflow state inspection

```typescript
const state = await world.query(workflowId)
console.log(state.history)
console.log(state.activities)
console.log(state.compensations)
```

log filtering

```typescript
const logs = await logger.queryLogs({
  category: 'workflow'
  level: 'error'
  since: Date.now() - 3600000
})
```

quarantine strategy for problem workflows

```typescript
const problematic = workflow('debug' handler {
  failureStrategy: 'quarantine'
})
```

## built by floris from XYLEX Group
