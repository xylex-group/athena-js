/**
 * runtime api
 * 
 * functions for starting workflows resuming hooks and webhooks
 * getting run status outside of workflow and step functions
 */

import type { World } from '../core/world.js'
import type { WorkflowHandle, WorkflowState, WorkflowOptions } from '../types/index.js'

/**
 * runtime instance for api functions
 */
let runtimeWorld: World | undefined

/**
 * initialize runtime with world instance
 */
export function initializeRuntime(world: World): void {
  runtimeWorld = world
}

/**
 * start new workflow run
 * 
 * enqueues workflow for execution returns handle for tracking
 */
export async function start<T, R>(
  workflowName: string,
  input: T,
  options?: WorkflowOptions
): Promise<WorkflowHandle<R>> {
  if (!runtimeWorld) {
    throw new Error('runtime not initialized call initializeRuntime first')
  }

  return await runtimeWorld.execute<T, R>(workflowName, input, options)
}

/**
 * resume workflow by sending payload to hook
 */
export async function resumeHook<T>(
  hookToken: string,
  payload: T
): Promise<void> {
  if (!runtimeWorld) {
    throw new Error('runtime not initialized')
  }

  // find workflow with this hook token
  const workflows = await runtimeWorld.queryWorkflows({})
  
  for (const workflow of workflows) {
    if (workflow.hooks) {
      const hook = workflow.hooks.find(h => h.token === hookToken)
      if (hook && !hook.resolved) {
        // mark hook as resolved
        hook.resolved = true
        hook.payload = payload
        hook.resolvedAt = Date.now()
        
        // save workflow state
        await runtimeWorld.getBackend().storage.saveWorkflow(workflow)
        
        // trigger workflow resumption
        // workflow will replay and hook.wait() will return payload
        return
      }
    }
  }
  
  throw new Error('hook not found or already resolved')
}

/**
 * resume workflow by sending request to webhook
 */
export async function resumeWebhook(
  webhookToken: string,
  request: Request
): Promise<void> {
  if (!runtimeWorld) {
    throw new Error('runtime not initialized')
  }

  const workflows = await runtimeWorld.queryWorkflows({})
  
  for (const workflow of workflows) {
    if (workflow.webhooks) {
      const webhook = workflow.webhooks.find(w => w.token === webhookToken)
      if (webhook && !webhook.resolved) {
        webhook.resolved = true
        webhook.request = {
          method: request.method,
          url: request.url,
          headers: Object.fromEntries(request.headers.entries()),
          body: await request.text()
        }
        webhook.resolvedAt = Date.now()
        
        await runtimeWorld.getBackend().storage.saveWorkflow(workflow)
        
        return
      }
    }
  }
  
  throw new Error('webhook not found or already resolved')
}

/**
 * get workflow run status and metadata without waiting for completion
 */
export async function getRun(workflowId: string): Promise<WorkflowState> {
  if (!runtimeWorld) {
    throw new Error('runtime not initialized')
  }

  return await runtimeWorld.query(workflowId)
}

/**
 * get all workflow runs matching criteria
 */
export async function queryRuns(filters: {
  status?: string | string[]
  workflowName?: string
  limit?: number
}): Promise<WorkflowState[]> {
  if (!runtimeWorld) {
    throw new Error('runtime not initialized')
  }

  return await runtimeWorld.queryWorkflows(filters as any)
}
