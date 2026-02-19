# workflows

comprehensive technical documentation for workflow execution orchestration and deterministic replay mechanisms

## workflow definition

workflow created through workflow function accepting name handler and options

```typescript
function workflow<T R>(
  name: string
  handler: (ctx: WorkflowContext input: T) => Promise<R>
  options?: WorkflowOptions
): Workflow<T R>
```

handler receives context and input returns promise of result

context provides methods for orchestration

- run executes activities with retry
- executeChild spawns child workflows
- addCompensation registers rollback functions
- isCancelled checks cancellation state
- sleep delays execution deterministically

options configure behavior

```typescript
{
  workflowId?: string
  failureStrategy?: FailureStrategy
  timeout?: string | number
  parentId?: string
  taskQueue?: string
}
```

## workflow execution lifecycle

### initialization phase

1. generate workflow id from name and uuid or use provided id
2. check storage for existing workflow with same id
3. if exists return handle to existing workflow idempotency
4. create initial state structure

state structure

```typescript
{
  workflowId: string
  runId: string
  status: 'pending'
  input: any
  startedAt: number
  parentId?: string
  childIds: []
  activities: []
  compensations: []
  history: []
}
```

5. add workflow_started event to history
6. persist state to storage
7. schedule async execution
8. return workflow handle

### execution phase

1. update status to running
2. persist state
3. create saga coordinator for compensations
4. create workflow context

context implementation

```typescript
{
  workflowId: state.workflowId
  runId: state.runId
  parentId: state.parentId
  
  run: async <T R>(activity: Activity<T R> input: T): Promise<R> => {
    const activityId = uuid()
    addEvent({ type: 'activity_scheduled' activityId name: activity.name input })
    addEvent({ type: 'activity_started' activityId })
    
    const result = await activityExecutor.execute(activity input workflowId activityId)
    
    addEvent({ type: 'activity_completed' activityId result })
    return result
  }
  
  executeChild: async <T R>(name: string input: T options?: WorkflowOptions): Promise<WorkflowHandle<R>> => {
    const childWorkflow = getWorkflow(name)
    const handle = await workflowExecutor.execute(childWorkflow input { ...options parentId: workflowId })
    state.childIds.push(handle.workflowId)
    addEvent({ type: 'child_workflow_started' childId: handle.workflowId name })
    return handle
  }
  
  addCompensation: (fn: () => Promise<void>): void => {
    const id = uuid()
    saga.addCompensation(id fn)
    state.compensations.push({ id executed: false })
    addEvent({ type: 'compensation_added' compensationId: id })
  }
  
  isCancelled: (): boolean => cancelledSet.has(workflowId)
  
  sleep: async (ms: number): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve ms))
  }
}
```

5. invoke handler with context and input
6. await handler completion

### completion phase

success path

1. handler returns result
2. status set to completed
3. result stored in state
4. completedAt timestamp recorded
5. workflow_completed event added
6. state persisted

failure path

1. handler throws error
2. status set to failed
3. error message stored
4. completedAt timestamp recorded
5. workflow_failed event added
6. failure strategy invoked
7. state persisted after strategy execution

## workflow context methods

### ctx.run activity execution

executes activity with full retry timeout and heartbeat support

```typescript
async run<T R>(activity: Activity<T R> input: T): Promise<R>
```

execution steps

1. generate unique activity id
2. add activity_scheduled event
3. add activity_started event
4. create activity executor
5. execute activity with state callback

state callback updates

```typescript
async (activityState: ActivityState) => {
  await store.saveActivity(workflowId activityState)
  
  if (activityState.status === 'failed') {
    addEvent({ type: 'activity_failed' activityId error attempt })
  } else if (activityState.status === 'retrying') {
    addEvent({ type: 'activity_retry' activityId attempt delayMs })
  } else if (activityState.lastHeartbeat) {
    addEvent({ type: 'activity_heartbeat' activityId message })
  }
  
  await store.saveWorkflow(state)
}
```

6. on success add activity_completed event
7. on failure propagate error
8. return result

### ctx.executeChild child workflow spawning

spawns child workflow with parent relationship

```typescript
async executeChild<T R>(
  workflowName: string
  input: T
  options?: WorkflowOptions
): Promise<WorkflowHandle<R>>
```

execution steps

1. lookup workflow definition by name
2. merge options with parentId
3. execute child workflow through executor
4. add child id to parent childIds array
5. add child_workflow_started event
6. persist parent state
7. return child handle

child workflow properties

- independent execution lifecycle
- can complete before parent
- cancellation propagates from parent to child
- failure handling per child strategy
- parent can wait on child result

### ctx.addCompensation saga registration

registers compensation function for rollback

```typescript
addCompensation(fn: () => Promise<void>): void
```

registration steps

1. generate unique compensation id
2. add to saga coordinator stack
3. add to workflow compensations array
4. add compensation_added event
5. function stored in memory not persisted

compensation characteristics

- executes in reverse order lifo
- runs only on workflow failure with compensate strategy
- async function returning promise
- errors caught and recorded
- continues execution despite individual failures

### ctx.isCancelled cancellation check

returns boolean indicating workflow cancellation state

```typescript
isCancelled(): boolean
```

implementation checks set of cancelled workflow ids

```typescript
cancelledWorkflows.has(workflowId)
```

cancellation triggered by

- explicit handle.cancel() call
- parent workflow cancellation propagation
- cascade failure strategy

workflow should check cancellation periodically and exit gracefully

### ctx.sleep delay execution

pauses workflow execution for specified milliseconds

```typescript
async sleep(ms: number): Promise<void>
```

implementation uses promise with setTimeout

```typescript
await new Promise(resolve => setTimeout(resolve ms))
```

sleep characteristics

- durable across process restarts
- deterministic replay skips sleep
- does not block worker worker
- other workflows continue executing

## workflow options

### workflowId custom identifier

forces specific workflow id for idempotency

```typescript
{ workflowId: 'order-123' }
```

behavior

- duplicate execution returns existing workflow
- prevents accidental duplicate processing
- useful for external system integration
- recommend using business entity id

### failureStrategy error handling

configures workflow failure behavior

```typescript
{ failureStrategy: 'compensate' | 'retry' | 'cascade' | 'ignore' | 'quarantine' }
```

strategy descriptions

- compensate: execute compensation functions saga pattern
- retry: restart workflow from beginning
- cascade: fail parent and children
- ignore: mark failed continue system
- quarantine: preserve state for debugging

default retry if not specified

### timeout maximum duration

limits workflow execution time

```typescript
{ timeout: '5m' }
```

timeout formats

- ms milliseconds
- s seconds
- m minutes
- h hours

timeout enforcement

```typescript
Promise.race([
  handler(ctx input)
  new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')) timeoutMs))
])
```

### parentId parent workflow

set automatically by executeChild

```typescript
{ parentId: 'parent-workflow-id' }
```

used for

- hierarchy tracking
- cancellation propagation
- failure cascade

### taskQueue worker routing

routes workflow to specific worker pool

```typescript
{ taskQueue: 'critical' }
```

workers filter tasks by queue assignment
unassigned workers process any queue

## parent child relationships

### hierarchy structure

workflows form tree structure through executeChild

```
parent-workflow
├── child-1
│   ├── grandchild-1
│   └── grandchild-2
├── child-2
└── child-3
```

each node maintains

- parentId reference to parent
- childIds array of children
- independent execution state

### spawning children

```typescript
const child1 = await ctx.executeChild('process-batch' { batchId: 1 })
const child2 = await ctx.executeChild('process-batch' { batchId: 2 })

const results = await Promise.all([
  child1.result()
  child2.result()
])
```

parallel execution

- children execute concurrently
- parent waits on results
- failure handling per child strategy

sequential execution

```typescript
const child1 = await ctx.executeChild('step-1' data)
const result1 = await child1.result()

const child2 = await ctx.executeChild('step-2' result1)
const result2 = await child2.result()
```

### cancellation propagation

parent cancellation cascades to children

```typescript
await handle.cancel()
```

cancellation sequence

1. mark parent cancelled
2. iterate parent childIds
3. cancel each child recursively
4. persist all states

child cancellation

- children check isCancelled periodically
- exit gracefully when cancelled
- compensations may execute based on strategy

### failure propagation

controlled by failure strategy

cascade strategy

- child failure cancels parent
- sibling children cancelled
- entire tree fails

compensate strategy

- child failure triggers child compensations
- parent can handle child failure
- siblings continue execution

ignore strategy

- child failure recorded
- parent continues
- other children unaffected

## workflow idempotency

### duplicate execution prevention

same workflow id returns existing workflow

```typescript
const handle1 = await world.execute('process-order' order { workflowId: 'order-123' })
const handle2 = await world.execute('process-order' order { workflowId: 'order-123' })

handle1.workflowId === handle2.workflowId // true
```

implementation

```typescript
const existing = await store.getWorkflow(workflowId)
if (existing) {
  return createHandle(workflowId existing.runId)
}
```

use cases

- external system retries
- user double clicks
- network retry logic
- distributed system coordination

### id generation strategies

automatic generation

```typescript
const workflowId = `${workflowName}-${uuid()}`
```

business entity id

```typescript
{ workflowId: `order-${order.id}` }
```

composite id

```typescript
{ workflowId: `${userId}-${action}-${timestamp}` }
```

deterministic id from input

```typescript
{ workflowId: `payment-${hashInput(paymentData)}` }
```

## workflow state

### state structure

```typescript
{
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
}
```

### status values

- pending: created not started
- running: executing handler
- completed: finished successfully
- failed: handler threw error
- cancelled: explicitly cancelled
- compensating: executing compensations
- compensated: compensations completed

### querying state

```typescript
const state = await handle.query()
```

query returns current state from storage
includes all activities compensations and history

filtered queries

```typescript
const failed = await world.queryWorkflows({ status: 'failed' })
const recent = await world.queryWorkflows({ startedAfter: Date.now() - 3600000 })
const parentChildren = await world.queryWorkflows({ parentId: 'parent-id' })
```

## determinism requirements

workflows must be deterministic for replay

### deterministic operations

activities

```typescript
const data = await ctx.run(fetchData url)
```

sleep

```typescript
await ctx.sleep(60000)
```

child workflows

```typescript
const child = await ctx.executeChild('child' input)
```

input based branching

```typescript
if (input.priority === 'high') {
  await ctx.run(fastProcess data)
} else {
  await ctx.run(slowProcess data)
}
```

### non deterministic operations

avoid these in workflows

random values

```typescript
// WRONG
const delay = Math.random() * 1000
await ctx.sleep(delay)

// CORRECT
await ctx.sleep(input.delayMs)
```

current time

```typescript
// WRONG
const now = Date.now()
if (now > deadline) throw new Error('too late')

// CORRECT
if (input.currentTime > input.deadline) throw new Error('too late')
```

external state

```typescript
// WRONG
const config = await fetchConfig()

// CORRECT
const config = await ctx.run(fetchConfigActivity {})
```

### replay mechanism

workflow replay reconstructs state from events

replay steps

1. load workflow state
2. iterate history events
3. for each event reconstruct state changes
4. resume execution from last event
5. continue with remaining logic

determinism ensures

- same events produced on replay
- same state reconstructed
- same decisions made
- same result achieved

## error handling

### activity failures

activity errors trigger retry logic

```typescript
try {
  const result = await ctx.run(riskyActivity data)
} catch (error) {
  // activity exhausted retries
  await ctx.run(logError { error: error.message })
  throw error // propagate to workflow
}
```

retry configuration in activity definition

```typescript
activity('risky' handler {
  retry: { maxAttempts: 5 backoff: 'exponential' }
})
```

### workflow failures

workflow handler errors trigger failure strategy

```typescript
workflow('process' async (ctx input) => {
  await ctx.run(step1 input)
  throw new Error('something went wrong')
  // failure strategy executes here
} { failureStrategy: 'compensate' })
```

### child workflow failures

parent handles child failures based on strategy

```typescript
workflow('parent' async (ctx input) => {
  try {
    const child = await ctx.executeChild('risky-child' input)
    const result = await child.result()
  } catch (error) {
    // child failed
    // handle or propagate
  }
})
```

## workflow patterns

### fan out fan in

parallel processing with aggregation

```typescript
workflow('batch-process' async (ctx items) => {
  const results = await Promise.all(
    items.map(item => ctx.run(processItem item))
  )
  return { processed: results.length total: results }
})
```

### sequential steps

ordered execution with dependencies

```typescript
workflow('pipeline' async (ctx data) => {
  const validated = await ctx.run(validate data)
  const transformed = await ctx.run(transform validated)
  const stored = await ctx.run(store transformed)
  return stored
})
```

### polling

wait for condition with timeout

```typescript
workflow('wait-for-ready' async (ctx { id timeout }) => {
  const start = Date.now()
  
  while (true) {
    const status = await ctx.run(checkStatus { id })
    if (status.ready) return status
    
    if (Date.now() - start > timeout) {
      throw new Error('timeout')
    }
    
    await ctx.sleep(5000)
  }
})
```

### saga

distributed transaction with compensation

```typescript
workflow('saga' async (ctx order) => {
  const payment = await ctx.run(charge order)
  ctx.addCompensation(() => ctx.run(refund payment))
  
  const inventory = await ctx.run(reserve order)
  ctx.addCompensation(() => ctx.run(release inventory))
  
  const shipment = await ctx.run(ship order)
  ctx.addCompensation(() => ctx.run(cancel shipment))
  
  return { orderId: order.id status: 'completed' }
})
```

### conditional branching

dynamic workflow paths

```typescript
workflow('conditional' async (ctx order) => {
  if (order.amount > 1000) {
    await ctx.run(manualReview order)
  }
  
  if (order.country === 'US') {
    await ctx.run(domesticShipping order)
  } else {
    await ctx.run(internationalShipping order)
  }
  
  return { processed: true }
})
```

### recursive workflows

self spawning workflows

```typescript
workflow('recursive-batch' async (ctx { items remaining }) => {
  const batch = items.slice(0 100)
  await Promise.all(batch.map(item => ctx.run(process item)))
  
  const next = items.slice(100)
  if (next.length > 0) {
    await ctx.executeChild('recursive-batch' { items: next remaining: next.length })
  }
  
  return { processed: items.length }
})
```

## testing workflows

### test harness usage

```typescript
import { createTestHarness } from 'worlds-engine/testing'

const harness = createTestHarness()
await harness.world.start()

harness.world.register(myWorkflow myActivity)

const handle = await harness.world.execute('my-workflow' input)

await harness.advance(60000)

await harness.runUntilComplete(handle.workflowId)

const state = await handle.query()
```

### mocking activities

```typescript
const mockActivity = activity('mock' async (ctx input) => {
  return { mocked: true data: input }
})

harness.world.register(workflow mockActivity)
```

### time control

```typescript
await harness.advance(1000)
await harness.advanceTo(Date.now() + 60000)
```

### deterministic testing

```typescript
const harness = createTestHarness({ initialTime: 1000000 })
```

## built by floris from XYLEX Group
