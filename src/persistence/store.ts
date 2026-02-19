/**
 * abstract store interface
 * 
 * defines the contract for persistence implementations. you can swap between
 * memory, file, or hybrid depending on your needs.
 */

import type {
  Store,
  WorkflowState,
  ActivityState,
  ScheduleConfig,
  Task,
  WorkflowQueryFilter,
} from '../types/index.js'

export abstract class BaseStore implements Store {
  abstract initialize(): Promise<void>
  abstract shutdown(): Promise<void>

  abstract saveWorkflow(state: WorkflowState): Promise<void>
  abstract getWorkflow(workflowId: string): Promise<WorkflowState | undefined>
  abstract queryWorkflows(filters: WorkflowQueryFilter): Promise<WorkflowState[]>
  abstract deleteWorkflow(workflowId: string): Promise<void>

  abstract saveActivity(workflowId: string, activity: ActivityState): Promise<void>
  abstract getActivity(workflowId: string, activityId: string): Promise<ActivityState | undefined>

  abstract saveSchedule(schedule: ScheduleConfig): Promise<void>
  abstract getSchedule(id: string): Promise<ScheduleConfig | undefined>
  abstract getAllSchedules(): Promise<ScheduleConfig[]>
  abstract deleteSchedule(id: string): Promise<void>

  abstract enqueueTask(task: Task): Promise<void>
  abstract dequeueTask(taskQueue?: string): Promise<Task | undefined>
  abstract peekQueue(limit?: number): Promise<Task[]>
  abstract getQueueSize(taskQueue?: string): Promise<number>

  /**
   * helper to match a workflow against filters
   */
  protected matchesFilter(workflow: WorkflowState, filters: WorkflowQueryFilter): boolean {
    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status]
      if (!statuses.includes(workflow.status)) return false
    }

    if (filters.workflowName && !workflow.workflowId.includes(filters.workflowName)) {
      return false
    }

    if (filters.parentId && workflow.parentId !== filters.parentId) {
      return false
    }

    if (filters.startedAfter && workflow.startedAt < filters.startedAfter) {
      return false
    }

    if (filters.startedBefore && workflow.startedAt > filters.startedBefore) {
      return false
    }

    return true
  }
}

