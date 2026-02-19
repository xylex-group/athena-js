/**
 * workflow functions
 * 
 * api functions available inside workflow functions
 * sleep fetch hooks webhooks streaming metadata
 */

import type {
  WorkflowMetadata,
  StepMetadata,
  Hook,
  Webhook,
  WorkflowContext
} from '../types/index.js'

/**
 * current workflow context for api functions
 */
let currentContext: WorkflowContext | undefined
let currentMetadata: WorkflowMetadata | undefined

/**
 * set current workflow context
 */
export function setWorkflowContext(ctx: WorkflowContext, metadata: WorkflowMetadata): void {
  currentContext = ctx
  currentMetadata = metadata
}

/**
 * clear current workflow context
 */
export function clearWorkflowContext(): void {
  currentContext = undefined
  currentMetadata = undefined
}

/**
 * get workflow metadata
 * 
 * returns context about current workflow execution
 */
export function getWorkflowMetadata(): WorkflowMetadata {
  if (!currentMetadata) {
    throw new Error('getWorkflowMetadata called outside workflow context')
  }
  return { ...currentMetadata }
}

/**
 * get step metadata
 * 
 * returns context about current step execution
 */
export function getStepMetadata(): StepMetadata {
  if (!currentContext) {
    throw new Error('getStepMetadata called outside step context')
  }
  
  return {
    stepId: `step-${Date.now()}`,
    stepName: 'current-step',
    workflowId: currentContext.workflowId,
    attempt: 1,
    startedAt: Date.now()
  }
}

/**
 * sleep workflow for specified duration
 * 
 * deterministic and replay safe
 */
export async function sleep(ms: number): Promise<void> {
  if (!currentContext) {
    throw new Error('sleep called outside workflow context')
  }
  
  await currentContext.sleep(ms)
}

/**
 * fetch with automatic retry semantics
 * 
 * makes http requests from within workflow
 */
export async function fetch(url: string, init?: RequestInit): Promise<Response> {
  if (!currentContext) {
    throw new Error('fetch called outside workflow context')
  }
  
  return await currentContext.fetch(url, init)
}

/**
 * create low level hook to receive arbitrary payloads
 * 
 * suspends workflow until payload received via resumeHook
 */
export async function createHook<T = any>(): Promise<Hook<T>> {
  if (!currentContext) {
    throw new Error('createHook called outside workflow context')
  }
  
  return await currentContext.createHook<T>()
}

/**
 * define hook helper for type safe payload types
 * 
 * returns factory function that creates typed hooks
 */
export function defineHook<T>() {
  return {
    create: async (): Promise<Hook<T>> => {
      return await createHook<T>()
    }
  }
}

/**
 * create webhook that suspends workflow until http request received
 * 
 * generates unique url for receiving webhook data
 */
export async function createWebhook(): Promise<Webhook> {
  if (!currentContext) {
    throw new Error('createWebhook called outside workflow context')
  }
  
  return await currentContext.createWebhook()
}

/**
 * get writable stream for current workflow run
 * 
 * enables streaming data from workflow execution
 */
export function getWritable(): WritableStream<any> {
  if (!currentContext) {
    throw new Error('getWritable called outside workflow context')
  }
  
  return currentContext.getWritable()
}

/**
 * workflow function type definitions for export
 */
export type {
  WorkflowMetadata,
  StepMetadata,
  Hook,
  Webhook
}

