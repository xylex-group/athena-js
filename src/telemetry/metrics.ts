/**
 * metrics tracking
 * 
 * keeps track of throughput, success rates, latencies, all that good stuff.
 * used by the CLI dashboard and for monitoring.
 */

import type { WorldMetrics } from '../types/index.js'

export class MetricsCollector {
  private startTime = Date.now()
  private workflowCompletions: number[] = []
  private workflowFailures: number[] = []
  private windowSize = 60000 // 1 minute window

  private counters = {
    workflowsQueued: 0,
    workflowsRunning: 0,
    workflowsCompleted: 0,
    workflowsFailed: 0,
    activitiesCompleted: 0,
    activitiesFailed: 0,
  }

  recordWorkflowQueued(): void {
    this.counters.workflowsQueued++
  }

  recordWorkflowStarted(): void {
    this.counters.workflowsQueued = Math.max(0, this.counters.workflowsQueued - 1)
    this.counters.workflowsRunning++
  }

  recordWorkflowCompleted(): void {
    this.counters.workflowsRunning = Math.max(0, this.counters.workflowsRunning - 1)
    this.counters.workflowsCompleted++
    this.workflowCompletions.push(Date.now())
    this.cleanOldMetrics()
  }

  recordWorkflowFailed(): void {
    this.counters.workflowsRunning = Math.max(0, this.counters.workflowsRunning - 1)
    this.counters.workflowsFailed++
    this.workflowFailures.push(Date.now())
    this.cleanOldMetrics()
  }

  recordActivityCompleted(): void {
    this.counters.activitiesCompleted++
  }

  recordActivityFailed(): void {
    this.counters.activitiesFailed++
  }

  getMetrics(workerStats: { total: number; idle: number; busy: number }): WorldMetrics {
    this.cleanOldMetrics()

    const now = Date.now()
    const uptime = now - this.startTime

    const recentCompletions = this.workflowCompletions.length
    const perMinute = recentCompletions
    const perHour = Math.round((recentCompletions / this.windowSize) * 3600000)

    // workload is ratio of busy workers to total workers
    const workload = workerStats.total > 0 ? workerStats.busy / workerStats.total : 0

    return {
      uptime,
      workers: workerStats,
      workflows: {
        queued: this.counters.workflowsQueued,
        running: this.counters.workflowsRunning,
        completed: this.counters.workflowsCompleted,
        failed: this.counters.workflowsFailed,
      },
      throughput: {
        perMinute,
        perHour,
      },
      workload,
    }
  }

  private cleanOldMetrics(): void {
    const cutoff = Date.now() - this.windowSize
    this.workflowCompletions = this.workflowCompletions.filter(t => t > cutoff)
    this.workflowFailures = this.workflowFailures.filter(t => t > cutoff)
  }

  reset(): void {
    this.startTime = Date.now()
    this.workflowCompletions = []
    this.workflowFailures = []
    this.counters = {
      workflowsQueued: 0,
      workflowsRunning: 0,
      workflowsCompleted: 0,
      workflowsFailed: 0,
      activitiesCompleted: 0,
      activitiesFailed: 0,
    }
  }
}
