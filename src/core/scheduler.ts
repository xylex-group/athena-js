/**
 * scheduler
 * 
 * handles cron-based recurring workflows and one-time scheduled executions.
 * keeps track of when things should run and triggers them at the right time.
 */

import cronParser from 'cron-parser'
import { v4 as uuid } from 'uuid'
import type { ScheduleConfig, Store, Workflow } from '../types/index.js'

export class Scheduler {
  private schedules = new Map<string, ScheduleConfig>()
  private checkInterval: NodeJS.Timeout | undefined
  private workflows = new Map<string, Workflow>()

  constructor(
    private store: Store,
    private executeWorkflow: (workflowName: string, input: any) => Promise<void>
  ) {}

  async initialize(): Promise<void> {
    // load schedules from store
    const schedules = await this.store.getAllSchedules()
    for (const schedule of schedules) {
      this.schedules.set(schedule.id, schedule)
    }

    // check for due schedules every 10 seconds
    this.checkInterval = setInterval(() => {
      this.checkSchedules().catch(err => {
        console.error('error checking schedules:', err)
      })
    }, 10000)
  }

  async shutdown(): Promise<void> {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
    }
  }

  registerWorkflow(workflow: Workflow): void {
    this.workflows.set(workflow.name, workflow)
  }

  /**
   * schedule a recurring workflow using cron expression
   * 
   * cronExpression examples:
   * - "0 9 * * *" every day at 9am
   * - "0 0 * * 1" every monday at midnight
   * - "0 12 * * 1-5" weekdays at noon
   */
  async schedule(
    id: string,
    workflowName: string,
    input: any | (() => any),
    cronExpression: string
  ): Promise<void> {
    // validate cron expression
    const parsed = cronParser.parseExpression(cronExpression)
    const nextExecution = parsed.next().getTime()

    const schedule: ScheduleConfig = {
      id,
      workflowName,
      input,
      cronExpression,
      paused: false,
      totalExecutions: 0,
      nextExecution,
    }

    this.schedules.set(id, schedule)
    await this.store.saveSchedule(schedule)
  }

  /**
   * schedule a one-time workflow execution at a specific time
   */
  async scheduleOnce(
    workflowName: string,
    input: any,
    executeAt: number
  ): Promise<string> {
    const id = `once-${uuid()}`
    
    // use a cron expression that only matches the specific time
    // for simplicity, we just store the timestamp and check it manually
    const schedule: ScheduleConfig = {
      id,
      workflowName,
      input,
      cronExpression: '', // empty means one-time
      paused: false,
      totalExecutions: 0,
      nextExecution: executeAt,
    }

    this.schedules.set(id, schedule)
    await this.store.saveSchedule(schedule)
    
    return id
  }

  async pause(id: string): Promise<void> {
    const schedule = this.schedules.get(id)
    if (!schedule) {
      throw new Error(`schedule ${id} not found`)
    }

    schedule.paused = true
    await this.store.saveSchedule(schedule)
  }

  async resume(id: string): Promise<void> {
    const schedule = this.schedules.get(id)
    if (!schedule) {
      throw new Error(`schedule ${id} not found`)
    }

    schedule.paused = false
    
    // recalculate next execution if its a cron schedule
    if (schedule.cronExpression) {
      const parsed = cronParser.parseExpression(schedule.cronExpression)
      schedule.nextExecution = parsed.next().getTime()
    }

    await this.store.saveSchedule(schedule)
  }

  async delete(id: string): Promise<void> {
    this.schedules.delete(id)
    await this.store.deleteSchedule(id)
  }

  getSchedule(id: string): ScheduleConfig | undefined {
    return this.schedules.get(id)
  }

  getAllSchedules(): ScheduleConfig[] {
    return Array.from(this.schedules.values())
  }

  private async checkSchedules(): Promise<void> {
    const now = Date.now()

    for (const schedule of this.schedules.values()) {
      if (schedule.paused) continue
      if (schedule.nextExecution > now) continue

      // time to execute
      await this.executeSchedule(schedule)
    }
  }

  private async executeSchedule(schedule: ScheduleConfig): Promise<void> {
    try {
      // get input - could be a value or a function that returns a value
      const input = typeof schedule.input === 'function' ? schedule.input() : schedule.input

      // execute the workflow
      await this.executeWorkflow(schedule.workflowName, input)

      schedule.totalExecutions++
      schedule.lastExecution = Date.now()

      // calculate next execution
      if (schedule.cronExpression) {
        // recurring schedule
        const parsed = cronParser.parseExpression(schedule.cronExpression, {
          currentDate: new Date(schedule.lastExecution),
        })
        schedule.nextExecution = parsed.next().getTime()
      } else {
        // one-time schedule - delete it
        await this.delete(schedule.id)
        return
      }

      await this.store.saveSchedule(schedule)
    } catch (err) {
      console.error(`failed to execute schedule ${schedule.id}:`, err)
      // still update next execution so we dont get stuck
      if (schedule.cronExpression) {
        const parsed = cronParser.parseExpression(schedule.cronExpression)
        schedule.nextExecution = parsed.next().getTime()
        await this.store.saveSchedule(schedule)
      }
    }
  }
}

