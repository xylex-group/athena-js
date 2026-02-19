/**
 * time skipper
 * 
 * utilities for controlling time in tests. useful for testing scheduled
 * workflows, timeouts, and retries without waiting around.
 */

export class TimeSkipper {
  private originalNow: () => number
  private originalSetTimeout: typeof setTimeout
  private originalSetInterval: typeof setInterval
  private currentTime: number
  private timers: Array<{
    id: number
    callback: () => void
    executeAt: number
    interval?: number
  }> = []
  private nextTimerId = 1

  constructor(initialTime?: number) {
    this.originalNow = Date.now
    this.originalSetTimeout = global.setTimeout
    this.originalSetInterval = global.setInterval
    this.currentTime = initialTime || Date.now()
  }

  install(): void {
    const self = this

    // override Date.now
    Date.now = () => self.currentTime

    // override setTimeout
    global.setTimeout = ((callback: () => void, delay: number) => {
      const id = self.nextTimerId++
      self.timers.push({
        id,
        callback,
        executeAt: self.currentTime + delay,
      })
      return id as any
    }) as any

    // override setInterval
    global.setInterval = ((callback: () => void, delay: number) => {
      const id = self.nextTimerId++
      self.timers.push({
        id,
        callback,
        executeAt: self.currentTime + delay,
        interval: delay,
      })
      return id as any
    }) as any
  }

  uninstall(): void {
    Date.now = this.originalNow
    global.setTimeout = this.originalSetTimeout
    global.setInterval = this.originalSetInterval
  }

  advance(ms: number): void {
    const targetTime = this.currentTime + ms
    
    while (this.currentTime < targetTime) {
      // find next timer to execute
      const nextTimer = this.timers
        .filter(t => t.executeAt <= targetTime)
        .sort((a, b) => a.executeAt - b.executeAt)[0]

      if (!nextTimer) {
        // no timers, just skip to target
        this.currentTime = targetTime
        break
      }

      // advance to timer time
      this.currentTime = nextTimer.executeAt

      // execute the timer
      nextTimer.callback()

      // if its an interval, reschedule it
      if (nextTimer.interval) {
        nextTimer.executeAt = this.currentTime + nextTimer.interval
      } else {
        // one-time timer, remove it
        this.timers = this.timers.filter(t => t.id !== nextTimer.id)
      }
    }
  }

  now(): number {
    return this.currentTime
  }

  clearTimers(): void {
    this.timers = []
  }
}

