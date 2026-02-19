/**
 * CLI dashboard
 * 
 * real-time TUI showing worker status, workload, and metrics. built with blessed
 * for that retro terminal feel.
 */

import blessed from 'blessed'
import type { World } from '../core/world.js'
import type { WorldMetrics, WorkerInfo } from '../types/index.js'

export class Dashboard {
  private screen: blessed.Widgets.Screen
  private titleBox: blessed.Widgets.BoxElement
  private workersBox: blessed.Widgets.BoxElement
  private workloadBox: blessed.Widgets.BoxElement
  private statsBox: blessed.Widgets.BoxElement
  private helpBox: blessed.Widgets.BoxElement
  private updateInterval: NodeJS.Timeout | undefined

  constructor(private world: World) {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'WORLDS-ENGINE',
    })

    // title bar
    this.titleBox = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: '',
      tags: true,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'cyan',
        },
      },
    })

    // workers display
    this.workersBox = blessed.box({
      top: 3,
      left: 0,
      width: '100%',
      height: '50%-3',
      content: '',
      tags: true,
      border: {
        type: 'line',
      },
      label: ' WORKERS ',
      style: {
        border: {
          fg: 'cyan',
        },
      },
    })

    // workload bar
    this.workloadBox = blessed.box({
      top: '50%',
      left: 0,
      width: '100%',
      height: 5,
      content: '',
      tags: true,
      border: {
        type: 'line',
      },
      label: ' WORKLOAD ',
      style: {
        border: {
          fg: 'cyan',
        },
      },
    })

    // stats
    this.statsBox = blessed.box({
      top: '50%+5',
      left: 0,
      width: '100%',
      height: '50%-8',
      content: '',
      tags: true,
      border: {
        type: 'line',
      },
      label: ' STATS ',
      style: {
        border: {
          fg: 'cyan',
        },
      },
    })

    // help
    this.helpBox = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: '{center}[q]uit  [s]cale  [p]ause  [r]esume  [l]ogs  [f]ilter{/center}',
      tags: true,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'cyan',
        },
      },
    })

    this.screen.append(this.titleBox)
    this.screen.append(this.workersBox)
    this.screen.append(this.workloadBox)
    this.screen.append(this.statsBox)
    this.screen.append(this.helpBox)

    // key bindings
    this.screen.key(['q', 'C-c'], () => {
      this.stop()
      process.exit(0)
    })

    this.screen.key(['s'], () => {
      // manual scale trigger (for demo purposes)
      this.screen.render()
    })
  }

  start(): void {
    // update display every 500ms
    this.updateInterval = setInterval(() => {
      this.update()
    }, 500)

    this.update()
    this.screen.render()
  }

  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval)
    }
  }

  private update(): void {
    const metrics = this.world.getMetrics()
    const workers = this.world.getWorkers()

    this.updateTitle(metrics)
    this.updateWorkers(workers)
    this.updateWorkload(metrics)
    this.updateStats(metrics)

    this.screen.render()
  }

  private updateTitle(metrics: WorldMetrics): void {
    const uptime = this.formatDuration(metrics.uptime)
    const title = `  {bold}{cyan-fg}WORLDS-ENGINE{/cyan-fg}{/bold}                    Uptime: {yellow-fg}${uptime}{/yellow-fg}  `
    this.titleBox.setContent(title)
  }

  private updateWorkers(workers: WorkerInfo[]): void {
    let content = `\n  {bold}WORKERS [{green-fg}${workers.length}{/green-fg}]{/bold}                          {bold}THROUGHPUT{/bold}\n\n`

    for (const worker of workers) {
      const statusColor = worker.status === 'busy' ? 'yellow' : 'green'
      const taskName = worker.currentTask?.name || 'idle'
      const timeSinceHeartbeat = Math.floor((Date.now() - worker.lastHeartbeat) / 1000)
      
      // create a progress bar for current task
      const barLength = 20
      let bar = ''
      if (worker.currentTask) {
        const elapsed = Date.now() - worker.currentTask.startedAt
        const progress = Math.min(elapsed / 10000, 1) // assume 10s tasks for visual
        const filled = Math.floor(progress * barLength)
        bar = '█'.repeat(filled) + '░'.repeat(barLength - filled)
      } else {
        bar = '░'.repeat(barLength)
      }

      content += `  {bold}${worker.id}{/bold} {${statusColor}-fg}${bar}{/${statusColor}-fg}  [${taskName}]     {${statusColor}-fg}${worker.status.toUpperCase()}{/${statusColor}-fg}  ♥ ${timeSinceHeartbeat}s\n`
    }

    this.workersBox.setContent(content)
  }

  private updateWorkload(metrics: WorldMetrics): void {
    const workloadPercent = Math.round(metrics.workload * 100)
    const barLength = 40
    const filled = Math.round((workloadPercent / 100) * barLength)
    const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled)

    const color = workloadPercent > 70 ? 'red' : workloadPercent > 40 ? 'yellow' : 'green'

    const content = `\n  {bold}WORKLOAD{/bold} {${color}-fg}${bar}{/${color}-fg}  {bold}${workloadPercent}%{/bold}\n`
    this.workloadBox.setContent(content)
  }

  private updateStats(metrics: WorldMetrics): void {
    const content = `
  {bold}QUEUED:{/bold} {yellow-fg}${metrics.workflows.queued}{/yellow-fg}  │  {bold}RUNNING:{/bold} {cyan-fg}${metrics.workflows.running}{/cyan-fg}  │  {bold}COMPLETED:{/bold} {green-fg}${metrics.workflows.completed}{/green-fg}  │  {bold}FAILED:{/bold} {red-fg}${metrics.workflows.failed}{/red-fg}

  {bold}THROUGHPUT:{/bold} {cyan-fg}${metrics.throughput.perMinute}/min{/cyan-fg}  ({cyan-fg}${metrics.throughput.perHour}/hour{/cyan-fg})

  {bold}WORKERS:{/bold} {green-fg}${metrics.workers.idle} idle{/green-fg} / {yellow-fg}${metrics.workers.busy} busy{/yellow-fg} / {bold}${metrics.workers.total} total{/bold}
`
    this.statsBox.setContent(content)
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`
    } else {
      return `${seconds}s`
    }
  }
}
