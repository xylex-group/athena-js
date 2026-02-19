/**
 * the world
 * 
 * main orchestrator managing worker pool task routing and workflow execution
 * now supports backend abstraction for pluggable backends
 */

import { LocalBackend } from '../world/local-world.js'
import { WorkflowExecutor, workflow } from './workflow.js'
import { activity } from './activity.js'
import { Worker } from './worker.js'
import { TaskQueue } from './task-queue.js'
import { Scheduler } from './scheduler.js'
import { Logger } from '../telemetry/logger.js'
import { MetricsCollector } from '../telemetry/metrics.js'
import { HeartbeatMonitor } from '../telemetry/heartbeat.js'
import type {
  WorldConfig,
  WorldMetrics,
  Workflow,
  Activity,
  WorkflowHandle,
  WorkflowOptions,
  WorkflowState,
  WorkflowQueryFilter,
  Task,
  ScheduleConfig,
} from '../types/index.js'
import type { Backend } from '../world/world-interface.js'

export class World {
  private config: Required<WorldConfig>
  private backend: Backend
  private workflowExecutor: WorkflowExecutor
  private taskQueue: TaskQueue
  private scheduler: Scheduler
  private logger: Logger
  private metrics: MetricsCollector
  private heartbeat: HeartbeatMonitor
  private workers: Worker[] = []
  private scaleCheckInterval: NodeJS.Timeout | undefined
  private started = false

  constructor(config: WorldConfig = {}, backend?: Backend) {
    this.config = {
      minWorkers: config.minWorkers || 2,
      maxWorkers: config.maxWorkers || 10,
      scaleThreshold: config.scaleThreshold || 0.7,
      scaleDownThreshold: config.scaleDownThreshold || 0.3,
      persistence: config.persistence || 'hybrid',
      persistencePath: config.persistencePath || '.athena-js',
      failureStrategy: config.failureStrategy || 'retry',
      heartbeatInterval: config.heartbeatInterval || 5000,
      heartbeatTimeout: config.heartbeatTimeout || 30000,
      taskQueues: config.taskQueues || [],
    }

    // use provided backend or create local backend
    this.backend = backend || new LocalBackend({ webhookBaseUrl: 'http://localhost:3000/webhooks' })

    this.workflowExecutor = new WorkflowExecutor(this.backend.storage)
    this.taskQueue = new TaskQueue(this.backend.storage)
    this.scheduler = new Scheduler(this.backend.storage, this.executeWorkflowByName.bind(this))
    this.logger = new Logger(this.config.persistencePath)
    this.metrics = new MetricsCollector()
    this.heartbeat = new HeartbeatMonitor(this.config.heartbeatTimeout)
  }

  /**
   * register workflows and activities
   */
  register(...items: (Workflow | Activity)[]): void {
    for (const item of items) {
      if ('handler' in item && 'name' in item) {
        if ('options' in item && 'retry' in (item.options || {})) {
          this.workflowExecutor.registerActivity(item as Activity)
        } else {
          this.workflowExecutor.registerWorkflow(item as Workflow)
          this.scheduler.registerWorkflow(item as Workflow)
        }
      }
    }
  }

  /**
   * start the world
   */
  async start(): Promise<void> {
    if (this.started) return

    this.logger.info('world', 'starting the world')

    await this.backend.initialize()
    await this.logger.initialize()
    await this.scheduler.initialize()

    // spawn initial workers
    for (let i = 0; i < this.config.minWorkers; i++) {
      await this.spawnWorker()
    }

    // start auto scaling checks
    this.scaleCheckInterval = setInterval(() => {
      this.checkScaling().catch(err => {
        this.logger.error('world', 'scaling check failed', { error: err.message })
      })
    }, 10000)

    this.started = true
    this.logger.info('world', `world started with ${this.workers.length} workers`)
  }

  /**
   * stop the world gracefully
   */
  async shutdown(): Promise<void> {
    if (!this.started) return

    this.logger.info('world', 'shutting down the world')

    if (this.scaleCheckInterval) {
      clearInterval(this.scaleCheckInterval)
    }

    // stop all workers
    for (const worker of this.workers) {
      worker.stop()
    }

    // wait for workers to finish
    const timeout = Date.now() + 30000
    while (this.workers.some(w => !w.isStopped()) && Date.now() < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    await this.scheduler.shutdown()
    await this.logger.shutdown()
    await this.backend.shutdown()

    this.started = false
    this.logger.info('world', 'world shut down')
  }

  /**
   * execute a workflow
   */
  async execute<T, R>(
    workflowName: string,
    input: T,
    options?: WorkflowOptions
  ): Promise<WorkflowHandle<R>> {
    this.metrics.recordWorkflowQueued()

    const workflow = this.findWorkflow(workflowName)
    if (!workflow) {
      throw new Error(`workflow ${workflowName} not found`)
    }

    return await this.workflowExecutor.execute(workflow, input, options)
  }

  /**
   * query workflow state
   */
  async query(workflowId: string): Promise<WorkflowState> {
    const state = await this.backend.storage.getWorkflow(workflowId)
    if (!state) {
      throw new Error(`workflow ${workflowId} not found`)
    }
    return state
  }

  /**
   * query multiple workflows
   */
  async queryWorkflows(filters: WorkflowQueryFilter): Promise<WorkflowState[]> {
    return await this.backend.storage.queryWorkflows(filters)
  }

  /**
   * schedule a recurring workflow
   */
  async schedule(
    id: string,
    workflowName: string,
    input: any | (() => any),
    cronExpression: string
  ): Promise<void> {
    await this.scheduler.schedule(id, workflowName, input, cronExpression)
    this.logger.info('world', `scheduled workflow ${workflowName}`, { id, cron: cronExpression })
  }

  /**
   * schedule a one time workflow execution
   */
  async scheduleOnce(workflowName: string, input: any, executeAt: number): Promise<string> {
    const id = await this.scheduler.scheduleOnce(workflowName, input, executeAt)
    this.logger.info('world', `scheduled one time workflow ${workflowName}`, { id, executeAt })
    return id
  }

  /**
   * pause a schedule
   */
  async pauseSchedule(id: string): Promise<void> {
    await this.scheduler.pause(id)
  }

  /**
   * resume a schedule
   */
  async resumeSchedule(id: string): Promise<void> {
    await this.scheduler.resume(id)
  }

  /**
   * delete a schedule
   */
  async deleteSchedule(id: string): Promise<void> {
    await this.scheduler.delete(id)
  }

  /**
   * get all schedules
   */
  getSchedules(): ScheduleConfig[] {
    return this.scheduler.getAllSchedules()
  }

  /**
   * get world metrics
   */
  getMetrics(): WorldMetrics {
    const workerStats = {
      total: this.workers.length,
      idle: this.workers.filter(w => w.isIdle()).length,
      busy: this.workers.filter(w => w.isBusy()).length,
    }

    return this.metrics.getMetrics(workerStats)
  }

  /**
   * get info about all workers
   */
  getWorkers() {
    return this.workers.map(w => w.getInfo())
  }

  /**
   * get backend instance
   */
  getBackend(): Backend {
    return this.backend
  }

  private async spawnWorker(taskQueue?: string): Promise<void> {
    const worker = new Worker(taskQueue, this.config.heartbeatInterval)
    this.workers.push(worker)

    this.logger.debug('world', `spawned worker ${worker.id}`, { taskQueue })

    worker.start(
      async (queue) => await this.taskQueue.dequeue(queue),
      async (task) => await this.executeTask(task),
      (workerId) => this.heartbeat.beat(workerId)
    ).catch(err => {
      this.logger.error('world', `worker ${worker.id} crashed`, { error: err.message })
    })
  }

  private async killWorker(): Promise<void> {
    const idleWorker = this.workers.find(w => w.isIdle())
    if (!idleWorker) return

    idleWorker.stop()
    this.workers = this.workers.filter(w => w.id !== idleWorker.id)

    this.logger.debug('world', `killed worker ${idleWorker.id}`)
  }

  private async checkScaling(): Promise<void> {
    const metrics = this.getMetrics()
    const workload = metrics.workload

    if (workload >= this.config.scaleThreshold && this.workers.length < this.config.maxWorkers) {
      const needed = Math.min(
        Math.ceil((this.config.maxWorkers - this.workers.length) / 2),
        this.config.maxWorkers - this.workers.length
      )
      
      for (let i = 0; i < needed; i++) {
        await this.spawnWorker()
      }
      
      this.logger.info('world', `scaled up spawned ${needed} workers`, { 
        total: this.workers.length,
        workload,
      })
    }

    if (workload <= this.config.scaleDownThreshold && this.workers.length > this.config.minWorkers) {
      const toKill = Math.min(
        Math.floor((this.workers.length - this.config.minWorkers) / 2),
        this.workers.length - this.config.minWorkers
      )
      
      for (let i = 0; i < toKill; i++) {
        await this.killWorker()
      }
      
      this.logger.info('world', `scaled down killed ${toKill} workers`, { 
        total: this.workers.length,
        workload,
      })
    }
  }

  private async executeTask(task: Task): Promise<void> {
    this.metrics.recordWorkflowStarted()

    try {
      if (task.type === 'workflow') {
        const workflow = this.findWorkflow(task.name)
        if (workflow) {
          await this.workflowExecutor.execute(workflow, task.input, task.options as WorkflowOptions)
        }
      }

      this.metrics.recordWorkflowCompleted()
    } catch (err) {
      this.metrics.recordWorkflowFailed()
      this.logger.error('world', `task ${task.id} failed`, { 
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  private async executeWorkflowByName(workflowName: string, input: any): Promise<void> {
    const workflow = this.findWorkflow(workflowName)
    if (!workflow) {
      throw new Error(`workflow ${workflowName} not found`)
    }

    await this.workflowExecutor.execute(workflow, input)
  }

  private findWorkflow(name: string): Workflow | undefined {
    return (this.workflowExecutor as any).workflows.get(name)
  }
}

export { workflow, activity }

