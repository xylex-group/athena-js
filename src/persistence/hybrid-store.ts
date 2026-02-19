/**
 * hybrid storage
 * 
 * keeps everything in memory for speed, but backs it up to files for durability.
 * on startup, it loads everything from disk. on save, writes to both memory and disk.
 * this gives you the best of both worlds.
 */

import { BaseStore } from './store.js'
import { MemoryStore } from './memory-store.js'
import { FileStore } from './file-store.js'
import type {
  WorkflowState,
  ActivityState,
  ScheduleConfig,
  Task,
  WorkflowQueryFilter,
} from '../types/index.js'

export class HybridStore extends BaseStore {
  private memoryStore: MemoryStore
  private fileStore: FileStore
  private syncInterval: NodeJS.Timeout | undefined
  private syncFrequency = 5000 // sync every 5 seconds

  constructor(basePath = '.worlds-engine') {
    super()
    this.memoryStore = new MemoryStore()
    this.fileStore = new FileStore(basePath)
  }

  async initialize(): Promise<void> {
    await this.fileStore.initialize()
    await this.memoryStore.initialize()

    // load everything from disk into memory
    await this.loadFromDisk()

    // start periodic sync
    this.syncInterval = setInterval(() => {
      this.syncToDisk().catch(err => {
        console.error('failed to sync to disk:', err)
      })
    }, this.syncFrequency)
  }

  async shutdown(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
    }

    // final sync before shutdown
    await this.syncToDisk()
    
    await this.memoryStore.shutdown()
    await this.fileStore.shutdown()
  }

  async saveWorkflow(state: WorkflowState): Promise<void> {
    await this.memoryStore.saveWorkflow(state)
    await this.fileStore.saveWorkflow(state)
  }

  async getWorkflow(workflowId: string): Promise<WorkflowState | undefined> {
    return this.memoryStore.getWorkflow(workflowId)
  }

  async queryWorkflows(filters: WorkflowQueryFilter): Promise<WorkflowState[]> {
    return this.memoryStore.queryWorkflows(filters)
  }

  async deleteWorkflow(workflowId: string): Promise<void> {
    await this.memoryStore.deleteWorkflow(workflowId)
    await this.fileStore.deleteWorkflow(workflowId)
  }

  async saveActivity(workflowId: string, activity: ActivityState): Promise<void> {
    await this.memoryStore.saveActivity(workflowId, activity)
    // workflow is saved to file when we save it to memory
    const workflow = await this.memoryStore.getWorkflow(workflowId)
    if (workflow) {
      await this.fileStore.saveWorkflow(workflow)
    }
  }

  async getActivity(workflowId: string, activityId: string): Promise<ActivityState | undefined> {
    return this.memoryStore.getActivity(workflowId, activityId)
  }

  async saveSchedule(schedule: ScheduleConfig): Promise<void> {
    await this.memoryStore.saveSchedule(schedule)
    await this.fileStore.saveSchedule(schedule)
  }

  async getSchedule(id: string): Promise<ScheduleConfig | undefined> {
    return this.memoryStore.getSchedule(id)
  }

  async getAllSchedules(): Promise<ScheduleConfig[]> {
    return this.memoryStore.getAllSchedules()
  }

  async deleteSchedule(id: string): Promise<void> {
    await this.memoryStore.deleteSchedule(id)
    await this.fileStore.deleteSchedule(id)
  }

  async enqueueTask(task: Task): Promise<void> {
    await this.memoryStore.enqueueTask(task)
    // queue is synced periodically
  }

  async dequeueTask(taskQueue?: string): Promise<Task | undefined> {
    const task = await this.memoryStore.dequeueTask(taskQueue)
    // queue is synced periodically
    return task
  }

  async peekQueue(limit?: number): Promise<Task[]> {
    return this.memoryStore.peekQueue(limit)
  }

  async getQueueSize(taskQueue?: string): Promise<number> {
    return this.memoryStore.getQueueSize(taskQueue)
  }

  private async loadFromDisk(): Promise<void> {
    // load workflows
    const workflows = await this.fileStore.queryWorkflows({})
    for (const workflow of workflows) {
      await this.memoryStore.saveWorkflow(workflow)
    }

    // load schedules
    const schedules = await this.fileStore.getAllSchedules()
    for (const schedule of schedules) {
      await this.memoryStore.saveSchedule(schedule)
    }

    // load queue
    const tasks = await this.fileStore.peekQueue(1000)
    for (const task of tasks) {
      await this.memoryStore.enqueueTask(task)
    }
  }

  private async syncToDisk(): Promise<void> {
    // sync queue to disk
    const tasks = await this.memoryStore.peekQueue(1000)
    
    // clear file queue and write current state
    await this.fileStore.initialize()
    for (const task of tasks) {
      await this.fileStore.enqueueTask(task)
    }
  }
}

