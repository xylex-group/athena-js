/**
 * file-based storage
 * 
 * persists everything to .worlds-engine folder. survives process restarts.
 * uses json files for simplicity. not super efficient for huge scale but
 * good enough for most cases.
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import { BaseStore } from './store.js'
import type {
  WorkflowState,
  ActivityState,
  ScheduleConfig,
  Task,
  WorkflowQueryFilter,
} from '../types/index.js'

export class FileStore extends BaseStore {
  private basePath: string
  private workflowsPath: string
  private schedulesPath: string
  private queuePath: string

  constructor(basePath = '.worlds-engine') {
    super()
    this.basePath = basePath
    this.workflowsPath = join(basePath, 'workflows')
    this.schedulesPath = join(basePath, 'schedules')
    this.queuePath = join(basePath, 'queue.json')
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true })
    await fs.mkdir(this.workflowsPath, { recursive: true })
    await fs.mkdir(this.schedulesPath, { recursive: true })
    await fs.mkdir(join(this.basePath, 'logs'), { recursive: true })
    await fs.mkdir(join(this.basePath, 'state'), { recursive: true })

    // initialize queue file if it doesnt exist
    try {
      await fs.access(this.queuePath)
    } catch {
      await fs.writeFile(this.queuePath, JSON.stringify([]))
    }
  }

  async shutdown(): Promise<void> {
    // nothing to do for file store
  }

  async saveWorkflow(state: WorkflowState): Promise<void> {
    const filePath = join(this.workflowsPath, `${state.workflowId}.json`)
    await fs.writeFile(filePath, JSON.stringify(state, null, 2))
  }

  async getWorkflow(workflowId: string): Promise<WorkflowState | undefined> {
    const filePath = join(this.workflowsPath, `${workflowId}.json`)
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      return JSON.parse(content)
    } catch (err: any) {
      if (err.code === 'ENOENT') return undefined
      throw err
    }
  }

  async queryWorkflows(filters: WorkflowQueryFilter): Promise<WorkflowState[]> {
    const files = await fs.readdir(this.workflowsPath)
    const workflows: WorkflowState[] = []

    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const content = await fs.readFile(join(this.workflowsPath, file), 'utf-8')
      const workflow = JSON.parse(content) as WorkflowState
      if (this.matchesFilter(workflow, filters)) {
        workflows.push(workflow)
      }
    }

    workflows.sort((a, b) => b.startedAt - a.startedAt)

    let results = workflows
    if (filters.offset) {
      results = results.slice(filters.offset)
    }
    if (filters.limit) {
      results = results.slice(0, filters.limit)
    }

    return results
  }

  async deleteWorkflow(workflowId: string): Promise<void> {
    const filePath = join(this.workflowsPath, `${workflowId}.json`)
    try {
      await fs.unlink(filePath)
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err
    }
  }

  async saveActivity(workflowId: string, activity: ActivityState): Promise<void> {
    const workflow = await this.getWorkflow(workflowId)
    if (!workflow) {
      throw new Error(`workflow ${workflowId} not found`)
    }

    const existingIdx = workflow.activities.findIndex(a => a.activityId === activity.activityId)
    if (existingIdx >= 0) {
      workflow.activities[existingIdx] = activity
    } else {
      workflow.activities.push(activity)
    }

    await this.saveWorkflow(workflow)
  }

  async getActivity(workflowId: string, activityId: string): Promise<ActivityState | undefined> {
    const workflow = await this.getWorkflow(workflowId)
    if (!workflow) return undefined
    return workflow.activities.find(a => a.activityId === activityId)
  }

  async saveSchedule(schedule: ScheduleConfig): Promise<void> {
    const filePath = join(this.schedulesPath, `${schedule.id}.json`)
    await fs.writeFile(filePath, JSON.stringify(schedule, null, 2))
  }

  async getSchedule(id: string): Promise<ScheduleConfig | undefined> {
    const filePath = join(this.schedulesPath, `${id}.json`)
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      return JSON.parse(content)
    } catch (err: any) {
      if (err.code === 'ENOENT') return undefined
      throw err
    }
  }

  async getAllSchedules(): Promise<ScheduleConfig[]> {
    const files = await fs.readdir(this.schedulesPath)
    const schedules: ScheduleConfig[] = []

    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const content = await fs.readFile(join(this.schedulesPath, file), 'utf-8')
      schedules.push(JSON.parse(content))
    }

    return schedules
  }

  async deleteSchedule(id: string): Promise<void> {
    const filePath = join(this.schedulesPath, `${id}.json`)
    try {
      await fs.unlink(filePath)
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err
    }
  }

  async enqueueTask(task: Task): Promise<void> {
    const queue = await this.readQueue()
    queue.push(task)
    queue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return (b.priority || 0) - (a.priority || 0)
      }
      return a.scheduledAt - b.scheduledAt
    })
    await this.writeQueue(queue)
  }

  async dequeueTask(taskQueue?: string): Promise<Task | undefined> {
    const queue = await this.readQueue()
    
    if (taskQueue) {
      const idx = queue.findIndex(t => t.taskQueue === taskQueue || !t.taskQueue)
      if (idx >= 0) {
        const task = queue.splice(idx, 1)[0]
        await this.writeQueue(queue)
        return task
      }
      return undefined
    }

    const task = queue.shift()
    if (task) {
      await this.writeQueue(queue)
    }
    return task
  }

  async peekQueue(limit = 10): Promise<Task[]> {
    const queue = await this.readQueue()
    return queue.slice(0, limit)
  }

  async getQueueSize(taskQueue?: string): Promise<number> {
    const queue = await this.readQueue()
    if (taskQueue) {
      return queue.filter(t => t.taskQueue === taskQueue || !t.taskQueue).length
    }
    return queue.length
  }

  private async readQueue(): Promise<Task[]> {
    try {
      const content = await fs.readFile(this.queuePath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return []
    }
  }

  private async writeQueue(queue: Task[]): Promise<void> {
    await fs.writeFile(this.queuePath, JSON.stringify(queue, null, 2))
  }
}

