/**
 * heartbeat monitor
 * 
 * tracks heartbeats from workers and activities. if something stops beating,
 * we know its dead or stuck and can take action.
 */

export interface HeartbeatEntry {
  id: string
  lastBeat: number
  message?: string
}

export class HeartbeatMonitor {
  private heartbeats = new Map<string, HeartbeatEntry>()
  private timeout: number

  constructor(timeout = 30000) {
    this.timeout = timeout
  }

  beat(id: string, message?: string): void {
    this.heartbeats.set(id, {
      id,
      lastBeat: Date.now(),
      message,
    })
  }

  check(id: string): boolean {
    const entry = this.heartbeats.get(id)
    if (!entry) return false
    return Date.now() - entry.lastBeat < this.timeout
  }

  getLastBeat(id: string): number | undefined {
    return this.heartbeats.get(id)?.lastBeat
  }

  getMessage(id: string): string | undefined {
    return this.heartbeats.get(id)?.message
  }

  remove(id: string): void {
    this.heartbeats.delete(id)
  }

  findDead(): string[] {
    const now = Date.now()
    const dead: string[] = []

    for (const [id, entry] of this.heartbeats.entries()) {
      if (now - entry.lastBeat >= this.timeout) {
        dead.push(id)
      }
    }

    return dead
  }

  getAllHeartbeats(): HeartbeatEntry[] {
    return Array.from(this.heartbeats.values())
  }

  clear(): void {
    this.heartbeats.clear()
  }
}

