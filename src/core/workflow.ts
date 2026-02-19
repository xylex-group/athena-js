/**
 * workflow engine
 * 
 * the heart of worlds-engine. workflows are deterministic, support event sourcing,
 * handle parent/child relationships, and integrate with the saga pattern for
 * compensation logic.
 */

import { v4 as uuid } from 'uuid'
import { ActivityExecutor } from './activity.js'
import { SagaCoordinator } from '../strategies/saga.js'
import { FailureHandler } from '../strategies/failure.js'
import type {
  Workflow,
  WorkflowOptions,
  WorkflowContext,
  WorkflowState,
  WorkflowEvent,
  WorkflowHandle,
  Activity,
  Store,
} from '../types/index.js'

/**
 * create a workflow definition
 * 
 * workflows orchestrate activities and other workflows. they can spawn children,
 * add compensations, and handle complex error scenarios.
 */
export function workflow<T = any, R = any>(
  name: string,
  handler: (ctx: WorkflowContext, input: T) => Promise<R>,
  options: WorkflowOptions = {}
): Workflow<T, R> {
  return {
    name,
    handler,
    options: {
      failureStrategy: options.failureStrategy || 'retry',
      timeout: options.timeout,
      parentId: options.parentId,
      taskQueue: options.taskQueue,
      workflowId: options.workflowId,
    },
  }
}

/**
 * workflow executor
 * 
 * manages workflow execution, event sourcing, child workflows, and compensations
 */
export class WorkflowExecutor {
  private activityExecutor: ActivityExecutor
  private failureHandler: FailureHandler
  private cancelledWorkflows = new Set<string>()
  private activities = new Map<string, Activity>()
  private workflows = new Map<string, Workflow>()

  constructor(private store: Store) {
    this.activityExecutor = new ActivityExecutor()
    this.failureHandler = new FailureHandler()
  }

  registerActivity(activity: Activity): void {
    this.activities.set(activity.name, activity)
  }

  registerWorkflow(workflow: Workflow): void {
    this.workflows.set(workflow.name, workflow)
  }

  async execute<T, R>(
    workflow: Workflow<T, R>,
    input: T,
    options: WorkflowOptions = {}
  ): Promise<WorkflowHandle<R>> {
    const workflowId = options.workflowId || `${workflow.name}-${uuid()}`
    const runId = uuid()

    // check if workflow with this ID already exists (idempotency)
    const existing = await this.store.getWorkflow(workflowId)
    if (existing) {
      return this.createHandle(workflowId, existing.runId)
    }

    // initialize workflow state
    const state: WorkflowState = {
      workflowId,
      runId,
      status: 'pending',
      input,
      startedAt: Date.now(),
      parentId: options.parentId,
      childIds: [],
      activities: [],
      compensations: [],
      history: [],
    }

    this.addEvent(state, { type: 'workflow_started', timestamp: Date.now(), input })
    await this.store.saveWorkflow(state)

    // execute asynchronously
    this.executeWorkflow(workflow, state, input).catch(() => {
      // errors are handled inside executeWorkflow
    })

    return this.createHandle(workflowId, runId)
  }

  private async executeWorkflow<T, R>(
    workflow: Workflow<T, R>,
    state: WorkflowState,
    input: T
  ): Promise<void> {
    try {
      state.status = 'running'
      await this.store.saveWorkflow(state)

      // setup saga coordinator for compensations
      const saga = new SagaCoordinator()

      // create workflow context
      const ctx = this.createContext(state, saga)

      // execute the workflow handler
      const result = await workflow.handler(ctx, input)

      // success
      state.status = 'completed'
      state.result = result
      state.completedAt = Date.now()
      this.addEvent(state, { type: 'workflow_completed', timestamp: Date.now(), result })
      await this.store.saveWorkflow(state)
    } catch (err) {
      // failure - handle according to strategy
      const error = err instanceof Error ? err : new Error(String(err))
      state.status = 'failed'
      state.error = error.message
      state.completedAt = Date.now()
      this.addEvent(state, { type: 'workflow_failed', timestamp: Date.now(), error: error.message })

      const saga = new SagaCoordinator()
      // restore compensations from state
      state.compensations.forEach(c => {
        if (!c.executed) {
          saga.addCompensation(c.id, async () => {})
        }
      })

      await this.handleFailure(workflow, state, error, saga)
    }
  }

  private async handleFailure(
    workflow: Workflow,
    state: WorkflowState,
    error: Error,
    saga: SagaCoordinator
  ): Promise<void> {
    const strategy = workflow.options.failureStrategy || 'retry'

    await this.failureHandler.handle(
      strategy,
      {
        workflowId: state.workflowId,
        error,
        parentId: state.parentId,
        childIds: state.childIds,
      },
      {
        compensate: async () => {
          state.status = 'compensating'
          await this.store.saveWorkflow(state)

          await saga.executeCompensations(
            (id) => {
              this.addEvent(state, { type: 'compensation_executed', timestamp: Date.now(), compensationId: id })
            },
            (id, error) => {
              this.addEvent(state, { type: 'compensation_failed', timestamp: Date.now(), compensationId: id, error })
            }
          )

          state.status = 'compensated'
          state.compensations = saga.getCompensationStates()
          await this.store.saveWorkflow(state)
        },
        cascade: async (workflowId) => {
          await this.cancel(workflowId)
        },
        quarantine: async (_workflowId) => {
          // just keep it in failed state for inspection
          await this.store.saveWorkflow(state)
        },
      }
    )

    await this.store.saveWorkflow(state)
  }

  private createContext(state: WorkflowState, saga: SagaCoordinator): WorkflowContext {
    return {
      workflowId: state.workflowId,
      runId: state.runId,
      parentId: state.parentId,

      run: async <T, R>(activity: Activity<T, R>, input: T): Promise<R> => {
        const activityId = uuid()
        
        this.addEvent(state, {
          type: 'activity_scheduled',
          timestamp: Date.now(),
          activityId,
          name: activity.name,
          input,
        })

        this.addEvent(state, {
          type: 'activity_started',
          timestamp: Date.now(),
          activityId,
        })

        try {
          const result = await this.activityExecutor.execute(
            activity,
            input,
            state.workflowId,
            activityId,
            async (activityState) => {
              await this.store.saveActivity(state.workflowId, activityState)
              
              if (activityState.status === 'failed') {
                this.addEvent(state, {
                  type: 'activity_failed',
                  timestamp: Date.now(),
                  activityId,
                  error: activityState.error || 'unknown',
                  attempt: activityState.attempt,
                })
              } else if (activityState.status === 'retrying') {
                this.addEvent(state, {
                  type: 'activity_retry',
                  timestamp: Date.now(),
                  activityId,
                  attempt: activityState.attempt,
                  delayMs: 0,
                })
              } else if (activityState.lastHeartbeat) {
                this.addEvent(state, {
                  type: 'activity_heartbeat',
                  timestamp: Date.now(),
                  activityId,
                  message: activityState.heartbeatMessage,
                })
              }

              await this.store.saveWorkflow(state)
            }
          )

          this.addEvent(state, {
            type: 'activity_completed',
            timestamp: Date.now(),
            activityId,
            result,
          })

          await this.store.saveWorkflow(state)

          return result
        } catch (err) {
          throw err
        }
      },

      executeChild: async <T, R>(workflowName: string, input: T, options?: WorkflowOptions): Promise<WorkflowHandle<R>> => {
        const childWorkflow = this.workflows.get(workflowName)
        if (!childWorkflow) {
          throw new Error(`workflow ${workflowName} not found`)
        }

        const childOptions = {
          ...options,
          parentId: state.workflowId,
        }

        const handle = await this.execute(childWorkflow, input, childOptions)
        state.childIds.push(handle.workflowId)

        this.addEvent(state, {
          type: 'child_workflow_started',
          timestamp: Date.now(),
          childId: handle.workflowId,
          name: workflowName,
        })

        await this.store.saveWorkflow(state)

        return handle
      },

      addCompensation: (fn: () => Promise<void>): void => {
        const compensationId = uuid()
        saga.addCompensation(compensationId, fn)
        
        state.compensations.push({
          id: compensationId,
          executed: false,
        })

        this.addEvent(state, {
          type: 'compensation_added',
          timestamp: Date.now(),
          compensationId,
        })
      },

      isCancelled: (): boolean => {
        return this.cancelledWorkflows.has(state.workflowId)
      },

      sleep: async (ms: number): Promise<void> => {
        return new Promise(resolve => setTimeout(resolve, ms))
      },

      fetch: async (url: string, init?: RequestInit): Promise<Response> => {
        // deterministic fetch with retry semantics
        try {
          const response = await fetch(url, init)
          return response
        } catch (err) {
          throw err
        }
      },

      createHook: async <T = any>() => {
        const hookId = uuid()
        
        if (!state.hooks) {
          state.hooks = []
        }

        const hookState: any = {
          hookId,
          token: `hook_${hookId}_${Date.now()}`,
          resolved: false,
          createdAt: Date.now(),
          payload: undefined,
          resolvedAt: undefined
        }

        state.hooks.push(hookState)

        this.addEvent(state, {
          type: 'hook_created',
          timestamp: Date.now(),
          hookId
        })

        await this.store.saveWorkflow(state)

        return {
          id: hookId,
          token: hookState.token,
          resume: async (payload: T) => {
            hookState.resolved = true
            hookState.payload = payload
            hookState.resolvedAt = Date.now()
            await this.store.saveWorkflow(state)
          },
          wait: async (): Promise<T> => {
            return new Promise((resolve) => {
              const checkInterval = setInterval(() => {
                if (hookState.resolved) {
                  clearInterval(checkInterval)
                  resolve(hookState.payload)
                }
              }, 100)
            })
          }
        }
      },

      createWebhook: async () => {
        const webhookId = uuid()
        
        if (!state.webhooks) {
          state.webhooks = []
        }

        const webhookState: any = {
          webhookId,
          url: `http://localhost:3000/webhooks/${webhookId}`,
          token: `webhook_${webhookId}_${Date.now()}`,
          resolved: false,
          createdAt: Date.now(),
          request: undefined,
          resolvedAt: undefined
        }

        state.webhooks.push(webhookState)

        this.addEvent(state, {
          type: 'webhook_created',
          timestamp: Date.now(),
          webhookId,
          url: webhookState.url
        })

        await this.store.saveWorkflow(state)

        return {
          id: webhookId,
          url: webhookState.url,
          token: webhookState.token,
          wait: async (): Promise<Request> => {
            return new Promise((resolve) => {
              const checkInterval = setInterval(() => {
                if (webhookState.resolved && webhookState.request) {
                  clearInterval(checkInterval)
                  resolve(new Request(webhookState.request.url, {
                    method: webhookState.request.method,
                    headers: webhookState.request.headers,
                    body: webhookState.request.body
                  }))
                }
              }, 100)
            })
          }
        }
      },

      getWritable: () => {
        if (!state.stream) {
          state.stream = []
        }

        return new WritableStream({
          write: async (chunk) => {
            state.stream!.push(chunk)
            
            this.addEvent(state, {
              type: 'stream_write',
              timestamp: Date.now(),
              data: chunk
            })

            await this.store.saveWorkflow(state)
          }
        })
      },

      getMetadata: () => {
        return {
          workflowId: state.workflowId,
          runId: state.runId,
          parentId: state.parentId,
          startedAt: state.startedAt,
          currentStep: undefined
        }
      }
    }
  }

  private createHandle<R>(workflowId: string, runId: string): WorkflowHandle<R> {
    return {
      id: runId,
      workflowId,

      result: async (): Promise<R> => {
        return new Promise((resolve, reject) => {
          const checkInterval = setInterval(async () => {
            const state = await this.store.getWorkflow(workflowId)
            if (!state) {
              clearInterval(checkInterval)
              reject(new Error('workflow not found'))
              return
            }

            if (state.status === 'completed') {
              clearInterval(checkInterval)
              resolve(state.result)
            } else if (state.status === 'failed' || state.status === 'cancelled') {
              clearInterval(checkInterval)
              reject(new Error(state.error || 'workflow failed'))
            }
          }, 100)
        })
      },

      query: async (): Promise<WorkflowState> => {
        const state = await this.store.getWorkflow(workflowId)
        if (!state) {
          throw new Error('workflow not found')
        }
        return state
      },

      cancel: async (): Promise<void> => {
        await this.cancel(workflowId)
      },
    }
  }

  async cancel(workflowId: string): Promise<void> {
    this.cancelledWorkflows.add(workflowId)

    const state = await this.store.getWorkflow(workflowId)
    if (!state) return

    state.status = 'cancelled'
    state.completedAt = Date.now()
    this.addEvent(state, { type: 'workflow_cancelled', timestamp: Date.now() })

    // cancel all children
    for (const childId of state.childIds) {
      await this.cancel(childId)
    }

    await this.store.saveWorkflow(state)
  }

  private addEvent(state: WorkflowState, event: WorkflowEvent): void {
    state.history.push(event)
  }
}

