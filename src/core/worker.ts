/**
 * worker implementation
 * 
 * renamed from drone to worker for consistency with workflow dev terminology
 * workers execute tasks from queue send heartbeats and handle cancellation
 */

import { v4 as uuid } from 'uuid'
import type { WorkerInfo, WorkerStatus, Task } from '../types/index.js'

export class Worker {
  public readonly id: string
  private status: WorkerStatus = 'idle'
  private currentTask?: Task
  private taskStartedAt?: number
  private lastHeartbeat: number = Date.now()
  private shouldStop = false
  private heartbeatInterval: NodeJS.Timeout | undefined
  private tasksCompleted = 0

  constructor(
    private taskQueue?: string,
    private heartbeatFrequency = 5000
  ) {
    this.id = `worker-${uuid().substring(0, 8)}`
  }

  async start(
    getTask: (taskQueue?: string) => Promise<Task | undefined>,
    executeTask: (task: Task) => Promise<void>,
    onHeartbeat: (workerId: string) => void
  ): Promise<void> {
    this.status = 'idle'

    this.heartbeatInterval = setInterval(() => {
      this.lastHeartbeat = Date.now()
      onHeartbeat(this.id)
    }, this.heartbeatFrequency)

    while (!this.shouldStop) {
      try {
        const task = await getTask(this.taskQueue)

        if (!task) {
          this.status = 'idle'
          await this.sleep(1000)
          continue
        }

        this.status = 'busy'
        this.currentTask = task
        this.taskStartedAt = Date.now()

        await executeTask(task)

        this.tasksCompleted++
        this.currentTask = undefined
        this.taskStartedAt = undefined
        this.status = 'idle'
      } catch (err) {
        console.error(`worker ${this.id} task failed:`, err)
        this.currentTask = undefined
        this.taskStartedAt = undefined
        this.status = 'idle'
      }
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
    }

    this.status = 'stopped'
  }

  stop(): void {
    this.shouldStop = true
    this.status = 'stopping'
  }

  getInfo(): WorkerInfo {
    return {
      id: this.id,
      status: this.status,
      currentTask: this.currentTask ? {
        id: this.currentTask.id,
        name: this.currentTask.name,
        startedAt: this.taskStartedAt || Date.now(),
      } : undefined,
      lastHeartbeat: this.lastHeartbeat,
      taskQueue: this.taskQueue,
      tasksCompleted: this.tasksCompleted,
    }
  }

  isBusy(): boolean {
    return this.status === 'busy'
  }

  isIdle(): boolean {
    return this.status === 'idle'
  }

  isStopped(): boolean {
    return this.status === 'stopped'
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

