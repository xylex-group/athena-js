/**
 * failure strategies
 * 
 * different ways to handle failures in workflows. you can cascade failures up
 * to parents, compensate with saga pattern, retry, ignore, or quarantine for
 * debugging.
 */

import type { FailureStrategy, WorkflowState } from '../types/index.js'

export interface FailureContext {
  workflowId: string
  error: Error
  parentId?: string
  childIds: string[]
}

export class FailureHandler {
  /**
   * decide what to do when a workflow fails based on its strategy
   */
  async handle(
    strategy: FailureStrategy,
    context: FailureContext,
    handlers: {
      cascade?: (workflowId: string) => Promise<void>
      compensate?: () => Promise<void>
      retry?: () => Promise<void>
      quarantine?: (workflowId: string) => Promise<void>
    }
  ): Promise<void> {
    switch (strategy) {
      case 'cascade':
        await this.handleCascade(context, handlers.cascade)
        break

      case 'compensate':
        if (handlers.compensate) {
          await handlers.compensate()
        }
        break

      case 'retry':
        if (handlers.retry) {
          await handlers.retry()
        }
        break

      case 'ignore':
        // do nothing, just mark as failed and move on
        break

      case 'quarantine':
        if (handlers.quarantine) {
          await handlers.quarantine(context.workflowId)
        }
        break

      default:
        throw new Error(`unknown failure strategy: ${strategy}`)
    }
  }

  /**
   * cascade failure means we fail the parent and all children too
   */
  private async handleCascade(
    context: FailureContext,
    cascadeHandler?: (workflowId: string) => Promise<void>
  ): Promise<void> {
    if (!cascadeHandler) return

    // fail parent if it exists
    if (context.parentId) {
      await cascadeHandler(context.parentId)
    }

    // fail all children
    for (const childId of context.childIds) {
      await cascadeHandler(childId)
    }
  }

  /**
   * check if a workflow should be retried based on its state and strategy
   */
  shouldRetryWorkflow(state: WorkflowState, maxRetries = 3): boolean {
    if (state.status !== 'failed') return false
    
    // count how many times this workflow has been retried
    const retryCount = state.history.filter(e => e.type === 'workflow_started').length - 1
    
    return retryCount < maxRetries
  }
}

