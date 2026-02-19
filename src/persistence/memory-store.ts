/**
 * in-memory storage
 * 
 * fast but ephemeral. everything disappears when the process dies.
 * good for testing or when you dont care about durability.
 */

import { BaseStore } from './store.js'
import type {
  WorkflowState,
  ActivityState,
  ScheduleConfig,
  Task,
  WorkflowQueryFilter,
} from '../types/index.js'

export class MemoryStore extends BaseStore {
  private workflows = new Map<string, WorkflowState>()
  private schedules = new Map<string, ScheduleConfig>()
  private taskQueue: Task[] = []

  async initialize(): Promise<void> {
    // nothing to do for memory store
  }

  async shutdown(): Promise<void> {
    this.workflows.clear()
    this.schedules.clear()
    this.taskQueue = []
  }

  async saveWorkflow(state: WorkflowState): Promise<void> {
    this.workflows.set(state.workflowId, { ...state })
  }

  async getWorkflow(workflowId: string): Promise<WorkflowState | undefined> {
    const workflow = this.workflows.get(workflowId)
    return workflow ? { ...workflow } : undefined
  }

  async queryWorkflows(filters: WorkflowQueryFilter): Promise<WorkflowState[]> {
    let results = Array.from(this.workflows.values())
      .filter(wf => this.matchesFilter(wf, filters))
      .sort((a, b) => b.startedAt - a.startedAt)

    if (filters.offset) {
      results = results.slice(filters.offset)
    }

    if (filters.limit) {
      results = results.slice(0, filters.limit)
    }

    return results.map(wf => ({ ...wf }))
  }

  async deleteWorkflow(workflowId: string): Promise<void> {
    this.workflows.delete(workflowId)
  }

  async saveActivity(workflowId: string, activity: ActivityState): Promise<void> {
    const workflow = this.workflows.get(workflowId)
    if (!workflow) {
      throw new Error(`workflow ${workflowId} not found`)
    }

    const existingIdx = workflow.activities.findIndex(a => a.activityId === activity.activityId)
    if (existingIdx >= 0) {
      workflow.activities[existingIdx] = { ...activity }
    } else {
      workflow.activities.push({ ...activity })
    }

    await this.saveWorkflow(workflow)
  }

  async getActivity(workflowId: string, activityId: string): Promise<ActivityState | undefined> {
    const workflow = this.workflows.get(workflowId)
    if (!workflow) return undefined

    const activity = workflow.activities.find(a => a.activityId === activityId)
    return activity ? { ...activity } : undefined
  }

  async saveSchedule(schedule: ScheduleConfig): Promise<void> {
    this.schedules.set(schedule.id, { ...schedule })
  }

  async getSchedule(id: string): Promise<ScheduleConfig | undefined> {
    const schedule = this.schedules.get(id)
    return schedule ? { ...schedule } : undefined
  }

  async getAllSchedules(): Promise<ScheduleConfig[]> {
    return Array.from(this.schedules.values()).map(s => ({ ...s }))
  }

  async deleteSchedule(id: string): Promise<void> {
    this.schedules.delete(id)
  }

  async enqueueTask(task: Task): Promise<void> {
    this.taskQueue.push({ ...task })
    this.taskQueue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return (b.priority || 0) - (a.priority || 0)
      }
      return a.scheduledAt - b.scheduledAt
    })
  }

  async dequeueTask(taskQueue?: string): Promise<Task | undefined> {
    if (taskQueue) {
      const idx = this.taskQueue.findIndex(t => t.taskQueue === taskQueue || !t.taskQueue)
      if (idx >= 0) {
        return this.taskQueue.splice(idx, 1)[0]
      }
      return undefined
    }

    return this.taskQueue.shift()
  }

  async peekQueue(limit = 10): Promise<Task[]> {
    return this.taskQueue.slice(0, limit).map(t => ({ ...t }))
  }

  async getQueueSize(taskQueue?: string): Promise<number> {
    if (taskQueue) {
      return this.taskQueue.filter(t => t.taskQueue === taskQueue || !t.taskQueue).length
    }
    return this.taskQueue.length
  }
}

