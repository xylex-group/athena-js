/**
 * worlds-engine
 * 
 * workflow orchestration for nextjs and express apps
 * supports workflow dev kit style directives worlds and workers
 * 
 * built by floris from XYLEX Group
 */

// core exports
export { World, workflow, activity } from './core/world.js'
export { Worker } from './core/worker.js'

// backend exports
export { LocalBackend } from './world/local-world.js'
export type { Backend, BackendConfig, QueueProvider, AuthProvider, StreamProvider } from './world/world-interface.js'

// directive exports
export {
  DirectiveRegistry,
  WorkflowSandbox,
  createDirectiveWorkflow,
  createDirectiveStep,
  validateWorkflowCode,
  globalRegistry
} from './directives/workflow-directive.js'

// runtime api exports
export {
  start,
  resumeHook,
  resumeWebhook,
  getRun,
  queryRuns,
  initializeRuntime
} from './api/runtime.js'

// workflow function exports
export {
  getWorkflowMetadata,
  getStepMetadata,
  sleep,
  fetch,
  createHook,
  defineHook,
  createWebhook,
  getWritable
} from './api/workflow-functions.js'

// retry utilities
export { withRetry, retryable, retryPatterns, shouldRetryError } from './utils/retry.js'

// type exports
export type {
  WorldConfig,
  WorldMetrics,
  Workflow,
  WorkflowOptions,
  WorkflowContext,
  WorkflowState,
  WorkflowHandle,
  WorkflowStatus,
  WorkflowMetadata,
  Activity,
  ActivityOptions,
  ActivityContext,
  ActivityState,
  ActivityStatus,
  StepMetadata,
  RetryConfig,
  FailureStrategy,
  ScheduleConfig,
  WorkerInfo,
  WorkerStatus,
  WorkflowQueryFilter,
  LogEntry,
  TestHarness,
  TestHarnessConfig,
  Hook,
  Webhook
} from './types/index.js'

// error class exports
export { FatalError, RetryableError } from './types/index.js'

// athena gateway type exports (hook available via the /react entry point)
export type {
  AthenaGatewayCondition,
  AthenaFetchPayload,
  AthenaInsertPayload,
  AthenaDeletePayload,
  AthenaUpdatePayload,
  AthenaGatewayBaseOptions,
  AthenaGatewayHookConfig,
  AthenaGatewayCallOptions,
  AthenaGatewayResponse,
  AthenaGatewayResponseLog,
  AthenaGatewayCallLog,
  AthenaGatewayHookResult,
  AthenaGatewayMethod,
  AthenaGatewayEndpointPath,
} from './gateway/types.js'
