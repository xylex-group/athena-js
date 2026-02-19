# getting started

comprehensive technical guide to the worlds-engine

## installation

```bash
npm install worlds-engine
```

package requires nodejs 18 or higher
dependencies installed automatically blessed chalk cron-parser uuid

## core concepts

### world architecture

world manages complete workflow lifecycle through worker worker pool

world responsibilities

- worker spawning and lifecycle management
- task queue coordination
- workflow state persistence
- metrics collection and aggregation
- schedule execution
- auto scaling based on workload

initialization sequence

1. create storage backend based on persistence config
2. initialize workflow executor with storage
3. initialize task queue with storage
4. initialize scheduler with storage and execution callback
5. initialize telemetry logger metrics heartbeat monitor
6. prepare for worker spawning

### worker workers

workers execute tasks from queue with heartbeat monitoring

worker lifecycle

1. created with unique id and optional queue assignment
2. started with task getter executor and heartbeat callback
3. polls queue in loop with 1 second idle delay
4. executes tasks through executor callback
5. sends heartbeat every 5 seconds default
6. stops gracefully on shutdown signal
7. marked stopped after exit

worker implementation details

```typescript
class Worker {
  id: string
  status: WorkerStatus
  currentTask?: Task
  taskStartedAt?: number
  lastHeartbeat: number
  tasksCompleted: number
  
  async start(
    getTask: (queue?: string) => Promise<Task | undefined>
    executeTask: (task: Task) => Promise<void>
    onHeartbeat: (id: string) => void
  ): Promise<void>
}
```

### workflow execution model

workflows define orchestration logic through async functions receiving context

workflow function signature

```typescript
async (ctx: WorkflowContext input: T) => Promise<R>
```

workflow context provides

- run method for activity execution
- executeChild method for child workflow spawning
- addCompensation method for saga pattern
- isCancelled method for cancellation checking
- sleep method for delays
- workflow metadata workflowId runId parentId

workflow execution steps

1. generate unique workflow id or use provided
2. check for existing workflow with same id idempotency
3. create initial workflow state with pending status
4. add workflow_started event to history
5. persist state to storage
6. execute handler asynchronously
7. update state based on result or error
8. persist final state
9. return workflow handle

### activity execution model

activities encapsulate business logic with retry and timeout handling

activity function signature

```typescript
async (ctx: ActivityContext input: T) => Promise<R>
```

activity context provides

- heartbeat method for progress reporting
- isCancelled method for cancellation checking
- activity metadata activityId workflowId attempt

activity execution steps

1. create activity state with pending status
2. create retry strategy from config
3. execute with retry loop
4. for each attempt
   - update state to running
   - setup heartbeat callback
   - setup timeout promise if configured
   - setup heartbeat timeout monitor if configured
   - race handler against timeouts
   - catch errors and retry if applicable
5. update state to completed or failed
6. persist final state
7. return result or throw error

## storage backends

### memory store implementation

uses javascript map for workflows and schedules
uses array for task queue with in memory sorting

data structures

```typescript
class MemoryStore {
  private workflows: Map<string WorkflowState>
  private schedules: Map<string ScheduleConfig>
  private taskQueue: Task[]
}
```

operations complexity

- saveWorkflow O(1) map insertion
- getWorkflow O(1) map lookup
- queryWorkflows O(n) linear scan with filter
- enqueueTask O(n log n) array insert and sort
- dequeueTask O(n) linear scan with optional filter

advantages

- zero io overhead
- fast operations
- simple implementation

disadvantages

- no persistence
- memory bounded by process
- lost on crash

### file store implementation

stores workflows as individual json files
stores schedules as individual json files
stores queue as single json file

directory structure

```bash
.worlds-engine/
  workflows/
    workflow-id-1.json
    workflow-id-2.json
  schedules/
    schedule-id-1.json
  queue.json
  logs/
    2025-12-01.log
  state/
```

operations include filesystem io

- saveWorkflow writes json file
- getWorkflow reads json file
- queryWorkflows reads all files and filters
- enqueueTask loads modifies saves queue file
- dequeueTask loads modifies saves queue file

advantages

- persistent across restarts
- no memory pressure
- human readable format

disadvantages

- io overhead on operations
- file system limits on file count
- concurrent access requires locking

### hybrid store implementation

combines memory store with periodic file sync

architecture layers

- memory store for fast operations
- file store for persistence
- sync interval 5 seconds default
- initialization loads from file to memory

sync operation

1. read queue from memory
2. write queue to file
3. workflows and schedules sync on save

advantages

- fast read operations from memory
- persistence through file backup
- automatic recovery on restart

disadvantages

- potential data loss in 5 second window
- memory and disk space required
- sync overhead every 5 seconds

## retry implementation

### retry strategy class

implements retry logic with configurable backoff

```typescript
class RetryStrategy {
  constructor(config: RetryConfig)
  shouldRetry(attempt: number): boolean
  calculateDelay(attempt: number): number
  executeWithRetry<T>(
    fn: () => Promise<T>
    onRetry?: (attempt: number error: Error delayMs: number) => void
  ): Promise<T>
}
```

delay calculation algorithms

exponential backoff

```typescript
delay = initialInterval * Math.pow(multiplier attempt - 1)
delay = Math.min(delay maxInterval)
jitter = Math.random() * 0.1 * delay
finalDelay = delay + jitter
```

linear backoff

```typescript
delay = initialInterval * attempt
delay = Math.min(delay maxInterval)
jitter = Math.random() * 0.1 * delay
finalDelay = delay + jitter
```

constant backoff

```typescript
delay = initialInterval
jitter = Math.random() * 0.1 * delay
finalDelay = delay + jitter
```

jitter purpose prevents thundering herd problem where multiple processes retry simultaneously

### standalone retry utilities

withRetry function wraps any async operation

```typescript
async function withRetry<T>(
  fn: () => Promise<T>
  options?: RetryOptions
): Promise<T>
```

options structure

```typescript
{
  maxAttempts?: number
  backoff?: 'linear' | 'exponential' | 'constant'
  initialInterval?: number
  maxInterval?: number
  multiplier?: number
  timeout?: string | number
  onRetry?: (attempt: number error: Error delayMs: number) => void
  shouldRetry?: (error: Error) => boolean
}
```

retryable function creates wrapped version

```typescript
function retryable<Args Result>(
  fn: (...args: Args) => Promise<Result>
  options?: RetryOptions
): (...args: Args) => Promise<Result>
```

conditional retry predicates

```typescript
shouldRetryError.network(error: Error): boolean
shouldRetryError.rateLimit(error: Error): boolean
shouldRetryError.serverError(error: Error): boolean
shouldRetryError.transient(error: Error): boolean
```

predefined retry patterns

```typescript
retryPatterns.api
retryPatterns.database
retryPatterns.network
retryPatterns.quick
```

## saga pattern details

### compensation coordinator

manages compensation functions in lifo stack

```typescript
class SagaCoordinator {
  private compensations: Compensation[]
  
  addCompensation(id: string fn: () => Promise<void>): void
  async executeCompensations(
    onExecuted?: (id: string) => void
    onFailed?: (id: string error: string) => void
  ): Promise<void>
  getCompensationStates(): CompensationState[]
  hasCompensations(): boolean
  clear(): void
}
```

compensation structure

```typescript
{
  id: string
  fn: () => Promise<void>
  executed: boolean
  error?: string
}
```

execution algorithm

1. reverse compensation array
2. iterate reversed array
3. for each compensation
   - skip if already executed
   - execute function
   - mark executed true on success
   - record error on failure
   - continue with next compensation
4. return all states

error handling in compensations

- errors caught and recorded
- execution continues despite failures
- all compensations attempted
- partial compensation accepted

### workflow integration

compensation registration during workflow execution

```typescript
const result = await ctx.run(activity input)
ctx.addCompensation(async () => {
  await ctx.run(undoActivity result.id)
})
```

compensation trigger on failure

1. workflow handler throws error
2. workflow executor catches error
3. status changed to compensating
4. compensation coordinator executes all compensations
5. status changed to compensated
6. workflow state persisted

compensation state in workflow

```typescript
{
  compensations: [
    { id: 'comp-1' executed: true }
    { id: 'comp-2' executed: true error: 'rollback failed' }
  ]
}
```

## failure strategy implementations

### failure handler class

routes failures to strategy implementations

```typescript
class FailureHandler {
  async handle(
    strategy: FailureStrategy
    context: FailureContext
    handlers: {
      cascade?: (workflowId: string) => Promise<void>
      compensate?: () => Promise<void>
      retry?: () => Promise<void>
      quarantine?: (workflowId: string) => Promise<void>
    }
  ): Promise<void>
}
```

failure context structure

```typescript
{
  workflowId: string
  error: Error
  parentId?: string
  childIds: string[]
}
```

### compensate strategy flow

1. workflow fails with error
2. status set to compensating
3. saga coordinator executes compensations
4. compensation events added to history
5. status set to compensated
6. final state persisted

implementation

```typescript
await saga.executeCompensations(
  (id) => addEvent({ type: 'compensation_executed' compensationId: id })
  (id error) => addEvent({ type: 'compensation_failed' compensationId: id error })
)
```

### retry strategy flow

1. workflow fails with error
2. check retry count in history
3. if under maxRetries restart workflow
4. if exhausted mark as failed

retry count calculation

```typescript
const retryCount = state.history
  .filter(e => e.type === 'workflow_started')
  .length - 1
```

### cascade strategy flow

1. workflow fails with error
2. if parent exists cancel parent
3. for each child cancel child
4. mark workflow cancelled

implementation uses recursive cancellation

```typescript
async cascade(workflowId: string) {
  await this.cancel(workflowId)
}

async cancel(workflowId: string) {
  const state = await store.getWorkflow(workflowId)
  state.status = 'cancelled'
  for (const childId of state.childIds) {
    await this.cancel(childId)
  }
  await store.saveWorkflow(state)
}
```

### ignore strategy flow

1. workflow fails with error
2. status set to failed
3. error recorded
4. no further action

### quarantine strategy flow

1. workflow fails with error
2. status set to failed
3. full state preserved
4. no retry or cleanup
5. manual inspection required

## event sourcing implementation

### event types and structures

workflow lifecycle events

```typescript
{ type: 'workflow_started' timestamp: number input: any }
{ type: 'workflow_completed' timestamp: number result: any }
{ type: 'workflow_failed' timestamp: number error: string }
{ type: 'workflow_cancelled' timestamp: number }
```

activity lifecycle events

```typescript
{ type: 'activity_scheduled' timestamp: number activityId: string name: string input: any }
{ type: 'activity_started' timestamp: number activityId: string }
{ type: 'activity_completed' timestamp: number activityId: string result: any }
{ type: 'activity_failed' timestamp: number activityId: string error: string attempt: number }
{ type: 'activity_retry' timestamp: number activityId: string attempt: number delayMs: number }
{ type: 'activity_heartbeat' timestamp: number activityId: string message?: string }
```

compensation events

```typescript
{ type: 'compensation_added' timestamp: number compensationId: string }
{ type: 'compensation_executed' timestamp: number compensationId: string }
{ type: 'compensation_failed' timestamp: number compensationId: string error: string }
```

child workflow events

```typescript
{ type: 'child_workflow_started' timestamp: number childId: string name: string }
{ type: 'child_workflow_completed' timestamp: number childId: string result: any }
```

### event log management

events appended to workflow history array

```typescript
state.history.push(event)
```

event ordering guaranteed by synchronous append
no concurrent modification of history array

event replay for recovery

1. load workflow state from storage
2. check status
3. if running reconstruct execution state from events
4. resume from last completed event
5. continue execution

determinism requirement

- same input produces same events
- events replay produces same state
- no side effects in workflow handler
- activities for non deterministic operations

## scheduling implementation

### cron expression parsing

uses cron-parser library for expression evaluation

cron format

```
* * * * *
│ │ │ │ │
│ │ │ │ └─ weekday 0-6
│ │ │ └─── month 1-12
│ │ └───── day 1-31
│ └─────── hour 0-23
└───────── minute 0-59
```

special characters

- asterisk matches any value
- comma separates list 1,3,5
- dash defines range 1-5
- slash defines step */5

next execution calculation

```typescript
const parsed = parseExpression(cronExpression)
const next = parsed.next()
schedule.nextExecution = next.getTime()
```

### schedule execution loop

scheduler checks schedules every 10 seconds

check algorithm

1. get current timestamp
2. iterate all schedules
3. for each schedule
   - skip if paused
   - skip if nextExecution in future
   - execute schedule
   - calculate next execution
   - persist updated schedule

execution function

```typescript
async executeSchedule(schedule: ScheduleConfig) {
  const input = typeof schedule.input === 'function'
    ? schedule.input()
    : schedule.input
  
  await executeWorkflow(schedule.workflowName input)
  
  schedule.totalExecutions++
  schedule.lastExecution = Date.now()
  
  if (schedule.cronExpression) {
    const parsed = parseExpression(schedule.cronExpression)
    schedule.nextExecution = parsed.next().getTime()
    await store.saveSchedule(schedule)
  } else {
    await deleteSchedule(schedule.id)
  }
}
```

### schedule management api

create recurring schedule

```typescript
async schedule(
  id: string
  workflowName: string
  input: any | (() => any)
  cronExpression: string
): Promise<void>
```

create one time schedule

```typescript
async scheduleOnce(
  workflowName: string
  input: any
  executeAt: number
): Promise<string>
```

pause schedule

```typescript
async pause(id: string): Promise<void> {
  schedule.paused = true
  await store.saveSchedule(schedule)
}
```

resume schedule

```typescript
async resume(id: string): Promise<void> {
  schedule.paused = false
  const parsed = parseExpression(schedule.cronExpression)
  schedule.nextExecution = parsed.next().getTime()
  await store.saveSchedule(schedule)
}
```

delete schedule

```typescript
async delete(id: string): Promise<void> {
  await store.deleteSchedule(id)
}
```

## telemetry system architecture

### logger implementation

writes to console and file with level filtering

```typescript
class Logger {
  private basePath: string
  private logFile: string
  private writeQueue: LogEntry[]
  private flushInterval: NodeJS.Timeout
  private minLevel: LogEntry['level']
}
```

log methods

```typescript
debug(category: string message: string metadata?: object): void
info(category: string message: string metadata?: object): void
warn(category: string message: string metadata?: object): void
error(category: string message: string metadata?: object): void
```

log entry format

```typescript
{
  timestamp: 1234567890
  level: 'info'
  category: 'workflow'
  message: 'workflow started'
  metadata: { workflowId: 'wf-123' }
}
```

file format newline delimited json

```json
{"timestamp":1234567890,"level":"info","category":"workflow","message":"started"}
{"timestamp":1234567891,"level":"error","category":"activity","message":"failed"}
```

flush mechanism

- entries queued in memory array
- flush every 2 seconds via interval
- batch write to file via appendFile
- console output immediate

level filtering

```typescript
const levelOrder = { debug: 0 info: 1 warn: 2 error: 3 }
if (levelOrder[level] < levelOrder[minLevel]) return
```

### metrics collector

tracks counts and rates with rolling windows

```typescript
class MetricsCollector {
  private startTime: number
  private workflowCompletions: number[]
  private workflowFailures: number[]
  private windowSize: number = 60000
  
  private counters: {
    workflowsQueued: number
    workflowsRunning: number
    workflowsCompleted: number
    workflowsFailed: number
    activitiesCompleted: number
    activitiesFailed: number
  }
}
```

recording methods

```typescript
recordWorkflowQueued(): void
recordWorkflowStarted(): void
recordWorkflowCompleted(): void
recordWorkflowFailed(): void
recordActivityCompleted(): void
recordActivityFailed(): void
```

metrics calculation

```typescript
getMetrics(workerStats): WorldMetrics {
  const now = Date.now()
  const uptime = now - this.startTime
  
  this.cleanOldMetrics()
  
  const recentCompletions = this.workflowCompletions.length
  const perMinute = recentCompletions
  const perHour = (recentCompletions / this.windowSize) * 3600000
  
  const workload = workerStats.total > 0
    ? workerStats.busy / workerStats.total
    : 0
  
  return { uptime workers workflows throughput workload }
}
```

cleanup old metrics

```typescript
cleanOldMetrics(): void {
  const cutoff = Date.now() - this.windowSize
  this.workflowCompletions = this.workflowCompletions.filter(t => t > cutoff)
  this.workflowFailures = this.workflowFailures.filter(t => t > cutoff)
}
```

### heartbeat monitor

tracks liveness through periodic signals

```typescript
class HeartbeatMonitor {
  private heartbeats: Map<string HeartbeatEntry>
  private timeout: number
}
```

heartbeat entry

```typescript
{
  id: string
  lastBeat: number
  message?: string
}
```

operations

```typescript
beat(id: string message?: string): void {
  this.heartbeats.set(id {
    id
    lastBeat: Date.now()
    message
  })
}

check(id: string): boolean {
  const entry = this.heartbeats.get(id)
  if (!entry) return false
  return Date.now() - entry.lastBeat < this.timeout
}

findDead(): string[] {
  const now = Date.now()
  return Array.from(this.heartbeats.entries())
    .filter(([_ entry]) => now - entry.lastBeat >= this.timeout)
    .map(([id]) => id)
}
```

## auto scaling algorithm

### scaling evaluation

runs every 10 seconds in world

```typescript
async checkScaling(): Promise<void> {
  const metrics = this.getMetrics()
  const workload = metrics.workload
  
  if (workload >= scaleThreshold && workers.length < maxWorkers) {
    const needed = Math.min(
      Math.ceil((maxWorkers - workers.length) / 2)
      maxWorkers - workers.length
    )
    for (let i = 0; i < needed; i++) {
      await spawnWorker()
    }
  }
  
  if (workload <= scaleDownThreshold && workers.length > minWorkers) {
    const toKill = Math.min(
      Math.floor((workers.length - minWorkers) / 2)
      workers.length - minWorkers
    )
    for (let i = 0; i < toKill; i++) {
      await killWorker()
    }
  }
}
```

workload calculation

```typescript
workload = busyWorkers / totalWorkers
```

scale up trigger

```typescript
workload >= 0.7 && workers < maxWorkers
```

scale down trigger

```typescript
workload <= 0.3 && workers > minWorkers
```

incremental scaling

- scale up by half remaining capacity
- scale down by half excess capacity
- prevents oscillation
- gradual adjustment

### worker lifecycle

spawn operation

```typescript
async spawnWorker(taskQueue?: string): Promise<void> {
  const worker = new Worker(taskQueue heartbeatInterval)
  this.workers.push(worker)
  
  worker.start(
    async (queue) => await this.taskQueue.dequeue(queue)
    async (task) => await this.executeTask(task)
    (workerId) => this.heartbeat.beat(workerId)
  )
}
```

kill operation

```typescript
async killWorker(): Promise<void> {
  const idleWorker = this.workers.find(d => d.isIdle())
  if (!idleWorker) return
  
  idleWorker.stop()
  this.workers = this.workers.filter(d => d.id !== idleWorker.id)
}
```

graceful shutdown

1. set shouldStop flag
2. wait for current task completion
3. exit work loop
4. set status to stopped

## task queue coordination

### task structure

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

### queue operations

enqueue with priority sorting

```typescript
async enqueue(task: Task): Promise<void> {
  this.queue.push(task)
  this.queue.sort((a b) => {
    if (a.priority !== b.priority) {
      return (b.priority || 0) - (a.priority || 0)
    }
    return a.scheduledAt - b.scheduledAt
  })
  await this.persist()
}
```

dequeue with queue filtering

```typescript
async dequeue(taskQueue?: string): Promise<Task | undefined> {
  if (taskQueue) {
    const idx = this.queue.findIndex(t =>
      t.taskQueue === taskQueue || !t.taskQueue
    )
    if (idx >= 0) {
      const task = this.queue.splice(idx 1)[0]
      await this.persist()
      return task
    }
    return undefined
  }
  
  const task = this.queue.shift()
  if (task) await this.persist()
  return task
}
```

### task routing

workers assigned to specific queues filter tasks

```typescript
const worker = new Worker('critical-queue')
```

tasks routed to matching workers

```typescript
const task = await getTask('critical-queue')
```

unassigned workers process any queue

```typescript
const worker = new Worker()
```

## workflow querying system

### query filter structure

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

### query execution

```typescript
async queryWorkflows(filters: WorkflowQueryFilter): Promise<WorkflowState[]> {
  let results = await this.getAllWorkflows()
  
  results = results.filter(wf => this.matchesFilter(wf filters))
  
  results.sort((a b) => b.startedAt - a.startedAt)
  
  if (filters.offset) {
    results = results.slice(filters.offset)
  }
  
  if (filters.limit) {
    results = results.slice(0 filters.limit)
  }
  
  return results
}
```

filter matching

```typescript
matchesFilter(workflow: WorkflowState filters: WorkflowQueryFilter): boolean {
  if (filters.status) {
    const statuses = Array.isArray(filters.status)
      ? filters.status
      : [filters.status]
    if (!statuses.includes(workflow.status)) return false
  }
  
  if (filters.workflowName && !workflow.workflowId.includes(filters.workflowName)) {
    return false
  }
  
  if (filters.parentId && workflow.parentId !== filters.parentId) {
    return false
  }
  
  if (filters.startedAfter && workflow.startedAt < filters.startedAfter) {
    return false
  }
  
  if (filters.startedBefore && workflow.startedAt > filters.startedBefore) {
    return false
  }
  
  return true
}
```

## timeout implementation

### timeout parsing

```typescript
function parseTimeout(timeout: string | number): number {
  if (typeof timeout === 'number') return timeout
  
  const match = timeout.match(/^(\d+)(ms|s|m|h)$/)
  if (!match) throw new Error('invalid timeout format')
  
  const value = parseInt(match[1] 10)
  const unit = match[2]
  
  switch (unit) {
    case 'ms': return value
    case 's': return value * 1000
    case 'm': return value * 60 * 1000
    case 'h': return value * 60 * 60 * 1000
  }
}
```

### timeout enforcement

promise race pattern

```typescript
async function withTimeout<T>(
  fn: () => Promise<T>
  timeoutMs: number
): Promise<T> {
  return Promise.race([
    fn()
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')) timeoutMs)
    )
  ])
}
```

activity timeout

```typescript
const promises = [handler(ctx input)]

if (timeoutMs) {
  promises.push(
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')) timeoutMs)
    )
  )
}

return await Promise.race(promises)
```

## testing utilities

### test harness

```typescript
function createTestHarness(config?: TestHarnessConfig): TestHarness {
  const world = new World({
    persistence: 'memory'
    minWorkers: 1
    maxWorkers: 1
  })
  
  let currentTime = config?.initialTime || Date.now()
  
  return {
    world
    currentTime
    async advance(ms: number): Promise<void>
    async advanceTo(timestamp: number): Promise<void>
    async runUntilComplete(workflowId: string timeout?: number): Promise<void>
  }
}
```

time control

```typescript
async advance(ms: number): Promise<void> {
  currentTime += ms
  await sleep(100)
}

async advanceTo(timestamp: number): Promise<void> {
  if (timestamp < currentTime) throw new Error('cannot go back')
  await this.advance(timestamp - currentTime)
}

async runUntilComplete(workflowId: string timeout = 30000): Promise<void> {
  const start = Date.now()
  while (true) {
    const state = await world.query(workflowId)
    if (state.status === 'completed' || state.status === 'failed') break
    if (Date.now() - start > timeout) throw new Error('timeout')
    await sleep(100)
  }
}
```

### time skipper

```typescript
class TimeSkipper {
  private currentTime: number
  private timers: Timer[] = []
  
  install(): void {
    Date.now = () => this.currentTime
    global.setTimeout = (cb delay) => {
      const id = this.nextId++
      this.timers.push({ id cb executeAt: this.currentTime + delay })
      return id
    }
  }
  
  advance(ms: number): void {
    const target = this.currentTime + ms
    while (this.currentTime < target) {
      const next = this.timers
        .filter(t => t.executeAt <= target)
        .sort((a b) => a.executeAt - b.executeAt)[0]
      
      if (!next) {
        this.currentTime = target
        break
      }
      
      this.currentTime = next.executeAt
      next.cb()
      
      if (next.interval) {
        next.executeAt = this.currentTime + next.interval
      } else {
        this.timers = this.timers.filter(t => t.id !== next.id)
      }
    }
  }
}
```

## built by floris from XYLEX Group
