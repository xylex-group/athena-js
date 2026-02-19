/**
 * activity system
 * 
 * activities are the units of work that actually do stuff. they handle retries,
 * timeouts, heartbeats, and all the messy error handling so you dont have to.
 */

import { v4 as uuid } from 'uuid'
import { RetryStrategy, parseTimeout } from '../strategies/retry.js'
import type {
  Activity,
  ActivityOptions,
  ActivityContext,
  ActivityState,
} from '../types/index.js'

/**
 * create an activity definition
 * 
 * this doesnt execute anything, just creates the definition that gets
 * registered with the world.
 */
export function activity<T = any, R = any>(
  name: string,
  handler: (ctx: ActivityContext, input: T) => Promise<R>,
  options: ActivityOptions = {}
): Activity<T, R> {
  return {
    name,
    handler,
    options: {
      retry: options.retry || { maxAttempts: 1 },
      timeout: options.timeout,
      heartbeatTimeout: options.heartbeatTimeout,
      taskQueue: options.taskQueue,
    },
  }
}

/**
 * activity executor
 * 
 * handles the actual execution of activities with retry logic, timeouts,
 * heartbeat monitoring, and cancellation support.
 */
export class ActivityExecutor {
  private cancelledActivities = new Set<string>()
  private heartbeatCallbacks = new Map<string, (message?: string) => void>()

  async execute<T, R>(
    activity: Activity<T, R>,
    input: T,
    workflowId: string,
    activityId: string = uuid(),
    onStateChange?: (state: ActivityState) => void
  ): Promise<R> {
    const state: ActivityState = {
      activityId,
      name: activity.name,
      status: 'pending',
      input,
      attempt: 0,
      startedAt: Date.now(),
    }

    if (onStateChange) onStateChange(state)

    const retryConfig = activity.options.retry || { maxAttempts: 1 }
    const retryStrategy = new RetryStrategy(retryConfig)

    try {
      const result = await retryStrategy.executeWithRetry(
        async () => {
          state.attempt++
          state.status = 'running'
          if (onStateChange) onStateChange(state)

          return await this.executeOnce(activity, input, workflowId, activityId, state, onStateChange)
        },
        (_attempt, error, _delayMs) => {
          state.status = 'retrying'
          state.error = error.message
          if (onStateChange) onStateChange(state)
        }
      )

      state.status = 'completed'
      state.result = result
      state.completedAt = Date.now()
      if (onStateChange) onStateChange(state)

      return result
    } catch (err) {
      state.status = 'failed'
      state.error = err instanceof Error ? err.message : String(err)
      state.completedAt = Date.now()
      if (onStateChange) onStateChange(state)

      throw err
    } finally {
      this.heartbeatCallbacks.delete(activityId)
    }
  }

  private async executeOnce<T, R>(
    activity: Activity<T, R>,
    input: T,
    workflowId: string,
    activityId: string,
    state: ActivityState,
    onStateChange?: (state: ActivityState) => void
  ): Promise<R> {
    // check if cancelled before starting
    if (this.isCancelled(activityId)) {
      throw new Error('activity was cancelled')
    }

    // setup heartbeat handler
    let lastHeartbeat = Date.now()
    this.heartbeatCallbacks.set(activityId, (message?: string) => {
      lastHeartbeat = Date.now()
      state.lastHeartbeat = lastHeartbeat
      state.heartbeatMessage = message
      if (onStateChange) onStateChange(state)
    })

    // create activity context
    const ctx: ActivityContext = {
      activityId,
      workflowId,
      attempt: state.attempt,
      heartbeat: (message?: string) => {
        const callback = this.heartbeatCallbacks.get(activityId)
        if (callback) callback(message)
      },
      isCancelled: () => this.isCancelled(activityId),
    }

    // execute with timeout if configured
    const timeoutMs = activity.options.timeout ? parseTimeout(activity.options.timeout) : undefined
    const heartbeatTimeoutMs = activity.options.heartbeatTimeout
      ? parseTimeout(activity.options.heartbeatTimeout)
      : undefined

    const promises: Promise<R>[] = [activity.handler(ctx, input)]

    // add timeout promise
    if (timeoutMs) {
      promises.push(
        new Promise<R>((_, reject) =>
          setTimeout(() => reject(new Error(`activity timeout after ${timeoutMs}ms`)), timeoutMs)
        )
      )
    }

    // add heartbeat timeout monitoring
    if (heartbeatTimeoutMs) {
      const checkInterval = Math.min(heartbeatTimeoutMs / 2, 5000)
      const heartbeatPromise = new Promise<R>((_, reject) => {
        const interval = setInterval(() => {
          if (Date.now() - lastHeartbeat > heartbeatTimeoutMs) {
            clearInterval(interval)
            reject(new Error(`activity heartbeat timeout after ${heartbeatTimeoutMs}ms`))
          }
        }, checkInterval)
      })
      promises.push(heartbeatPromise)
    }

    return await Promise.race(promises)
  }

  cancel(activityId: string): void {
    this.cancelledActivities.add(activityId)
  }

  private isCancelled(activityId: string): boolean {
    return this.cancelledActivities.has(activityId)
  }

  cleanup(activityId: string): void {
    this.cancelledActivities.delete(activityId)
    this.heartbeatCallbacks.delete(activityId)
  }
}
