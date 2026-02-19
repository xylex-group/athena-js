/**
 * all the types for athena-js
 * 
 * type definitions for world workers workflows activities and backends
 */

export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'compensating' | 'compensated'
export type ActivityStatus = 'pending' | 'running' | 'completed' | 'failed' | 'retrying'
export type WorkerStatus = 'idle' | 'busy' | 'stopping' | 'stopped'
export type BackoffStrategy = 'linear' | 'exponential' | 'constant'
export type FailureStrategy = 'cascade' | 'compensate' | 'retry' | 'ignore' | 'quarantine'

/**
 * world configuration
 */
export interface WorldConfig {
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

/**
 * retry configuration
 */
export interface RetryConfig {
  maxAttempts: number
  backoff?: BackoffStrategy
  initialInterval?: number
  maxInterval?: number
  multiplier?: number
}

/**
 * activity options
 */
export interface ActivityOptions {
  retry?: RetryConfig
  timeout?: string | number
  heartbeatTimeout?: string | number
  taskQueue?: string
}

/**
 * workflow options
 */
export interface WorkflowOptions {
  workflowId?: string
  failureStrategy?: FailureStrategy
  timeout?: string | number
  parentId?: string
  taskQueue?: string
}

/**
 * activity context
 */
export interface ActivityContext {
  activityId: string
  workflowId: string
  attempt: number
  heartbeat: (message?: string) => void
  isCancelled: () => boolean
}

/**
 * workflow context
 */
export interface WorkflowContext {
  workflowId: string
  runId: string
  parentId?: string
  run: <T, R>(activity: Activity<T, R>, input: T) => Promise<R>
  executeChild: <T, R>(workflowName: string, input: T, options?: WorkflowOptions) => Promise<WorkflowHandle<R>>
  addCompensation: (fn: () => Promise<void>) => void
  isCancelled: () => boolean
  sleep: (ms: number) => Promise<void>
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  createHook: <T = any>() => Promise<Hook<T>>
  createWebhook: () => Promise<Webhook>
  getWritable: () => WritableStream<any>
  getMetadata: () => WorkflowMetadata
}

/**
 * workflow metadata
 */
export interface WorkflowMetadata {
  workflowId: string
  runId: string
  parentId?: string
  startedAt: number
  currentStep?: string
}

/**
 * step metadata
 */
export interface StepMetadata {
  stepId: string
  stepName: string
  workflowId: string
  attempt: number
  startedAt: number
}

/**
 * hook interface
 */
export interface Hook<T = any> {
  id: string
  token: string
  resume: (payload: T) => Promise<void>
  wait: () => Promise<T>
}

/**
 * webhook interface
 */
export interface Webhook {
  id: string
  url: string
  token: string
  wait: () => Promise<Request>
}

/**
 * activity definition
 */
export interface Activity<T = any, R = any> {
  name: string
  handler: (ctx: ActivityContext, input: T) => Promise<R>
  options: ActivityOptions
}

/**
 * workflow definition
 */
export interface Workflow<T = any, R = any> {
  name: string
  handler: (ctx: WorkflowContext, input: T) => Promise<R>
  options: WorkflowOptions
}

/**
 * workflow handle
 */
export interface WorkflowHandle<T = any> {
  id: string
  workflowId: string
  result: () => Promise<T>
  query: () => Promise<WorkflowState>
  cancel: () => Promise<void>
}

/**
 * workflow state
 */
export interface WorkflowState {
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

/**
 * hook state
 */
export interface HookState {
  hookId: string
  token: string
  resolved: boolean
  payload?: any
  createdAt: number
  resolvedAt?: number
}

/**
 * webhook state
 */
export interface WebhookState {
  webhookId: string
  url: string
  token: string
  resolved: boolean
  request?: any
  createdAt: number
  resolvedAt?: number
}

/**
 * activity state
 */
export interface ActivityState {
  activityId: string
  name: string
  status: ActivityStatus
  input: any
  result?: any
  error?: string
  attempt: number
  startedAt: number
  completedAt?: number
  lastHeartbeat?: number
  heartbeatMessage?: string
}

/**
 * compensation state
 */
export interface CompensationState {
  id: string
  executed: boolean
  error?: string
}

/**
 * workflow events
 */
export type WorkflowEvent =
  | { type: 'workflow_started'; timestamp: number; input: any }
  | { type: 'workflow_completed'; timestamp: number; result: any }
  | { type: 'workflow_failed'; timestamp: number; error: string }
  | { type: 'workflow_cancelled'; timestamp: number }
  | { type: 'activity_scheduled'; timestamp: number; activityId: string; name: string; input: any }
  | { type: 'activity_started'; timestamp: number; activityId: string }
  | { type: 'activity_completed'; timestamp: number; activityId: string; result: any }
  | { type: 'activity_failed'; timestamp: number; activityId: string; error: string; attempt: number }
  | { type: 'activity_retry'; timestamp: number; activityId: string; attempt: number; delayMs: number }
  | { type: 'activity_heartbeat'; timestamp: number; activityId: string; message?: string }
  | { type: 'child_workflow_started'; timestamp: number; childId: string; name: string }
  | { type: 'child_workflow_completed'; timestamp: number; childId: string; result: any }
  | { type: 'compensation_added'; timestamp: number; compensationId: string }
  | { type: 'compensation_executed'; timestamp: number; compensationId: string }
  | { type: 'compensation_failed'; timestamp: number; compensationId: string; error: string }
  | { type: 'hook_created'; timestamp: number; hookId: string }
  | { type: 'hook_resolved'; timestamp: number; hookId: string; payload: any }
  | { type: 'webhook_created'; timestamp: number; webhookId: string; url: string }
  | { type: 'webhook_resolved'; timestamp: number; webhookId: string }
  | { type: 'stream_write'; timestamp: number; data: any }

/**
 * task structure
 */
export interface Task {
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

/**
 * worker information
 */
export interface WorkerInfo {
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

/**
 * world metrics
 */
export interface WorldMetrics {
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

/**
 * schedule configuration
 */
export interface ScheduleConfig {
  id: string
  workflowName: string
  input: any | (() => any)
  cronExpression: string
  paused: boolean
  totalExecutions: number
  lastExecution?: number
  nextExecution: number
}

/**
 * store interface
 */
export interface Store {
  initialize(): Promise<void>
  shutdown(): Promise<void>

  saveWorkflow(state: WorkflowState): Promise<void>
  getWorkflow(workflowId: string): Promise<WorkflowState | undefined>
  queryWorkflows(filters: WorkflowQueryFilter): Promise<WorkflowState[]>
  deleteWorkflow(workflowId: string): Promise<void>

  saveActivity(workflowId: string, activity: ActivityState): Promise<void>
  getActivity(workflowId: string, activityId: string): Promise<ActivityState | undefined>

  saveSchedule(schedule: ScheduleConfig): Promise<void>
  getSchedule(id: string): Promise<ScheduleConfig | undefined>
  getAllSchedules(): Promise<ScheduleConfig[]>
  deleteSchedule(id: string): Promise<void>

  enqueueTask(task: Task): Promise<void>
  dequeueTask(taskQueue?: string): Promise<Task | undefined>
  peekQueue(limit?: number): Promise<Task[]>
  getQueueSize(taskQueue?: string): Promise<number>
}

/**
 * workflow query filters
 */
export interface WorkflowQueryFilter {
  status?: WorkflowStatus | WorkflowStatus[]
  workflowName?: string
  parentId?: string
  startedAfter?: number
  startedBefore?: number
  limit?: number
  offset?: number
}

/**
 * log entry
 */
export interface LogEntry {
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error'
  category: 'world' | 'worker' | 'workflow' | 'activity' | 'system'
  message: string
  metadata?: Record<string, any>
}

/**
 * test harness configuration
 */
export interface TestHarnessConfig {
  initialTime?: number
  autoProgress?: boolean
}

/**
 * test harness
 */
export interface TestHarness {
  world: any
  currentTime: number
  advance(ms: number): Promise<void>
  advanceTo(timestamp: number): Promise<void>
  runUntilComplete(workflowId: string, timeout?: number): Promise<void>
}

/**
 * error classes
 */
export class FatalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FatalError'
  }
}

export class RetryableError extends Error {
  public readonly retryAfter?: number

  constructor(message: string, retryAfter?: number) {
    super(message)
    this.name = 'RetryableError'
    this.retryAfter = retryAfter
  }
}
