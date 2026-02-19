/**
 * logging system
 * 
 * writes logs to console and to .athena-js/logs directory. supports different
 * log levels and categories so you can filter whats important.
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import type { LogEntry } from '../types/index.js'

export class Logger {
  private basePath: string
  private logFile: string
  private writeQueue: LogEntry[] = []
  private flushInterval: NodeJS.Timeout | undefined
  private minLevel: LogEntry['level'] = 'info'

  constructor(basePath = '.athena-js') {
    this.basePath = join(basePath, 'logs')
    const date = new Date().toISOString().split('T')[0]
    this.logFile = join(this.basePath, `${date}.log`)
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true })

    // flush logs every 2 seconds
    this.flushInterval = setInterval(() => {
      this.flush().catch(err => {
        console.error('failed to flush logs:', err)
      })
    }, 2000)
  }

  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval)
    }
    await this.flush()
  }

  setMinLevel(level: LogEntry['level']): void {
    this.minLevel = level
  }

  debug(category: LogEntry['category'], message: string, metadata?: Record<string, any>): void {
    this.log('debug', category, message, metadata)
  }

  info(category: LogEntry['category'], message: string, metadata?: Record<string, any>): void {
    this.log('info', category, message, metadata)
  }

  warn(category: LogEntry['category'], message: string, metadata?: Record<string, any>): void {
    this.log('warn', category, message, metadata)
  }

  error(category: LogEntry['category'], message: string, metadata?: Record<string, any>): void {
    this.log('error', category, message, metadata)
  }

  private log(
    level: LogEntry['level'],
    category: LogEntry['category'],
    message: string,
    metadata?: Record<string, any>
  ): void {
    const levelOrder = { debug: 0, info: 1, warn: 2, error: 3 }
    if (levelOrder[level] < levelOrder[this.minLevel]) {
      return
    }

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      category,
      message,
      metadata,
    }

    this.writeQueue.push(entry)

    // also write to console
    const prefix = `[${category}]`
    const msg = metadata ? `${message} ${JSON.stringify(metadata)}` : message

    switch (level) {
      case 'debug':
        console.debug(prefix, msg)
        break
      case 'info':
        console.info(prefix, msg)
        break
      case 'warn':
        console.warn(prefix, msg)
        break
      case 'error':
        console.error(prefix, msg)
        break
    }
  }

  private async flush(): Promise<void> {
    if (this.writeQueue.length === 0) return

    const entries = this.writeQueue.splice(0)
    const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n'

    try {
      await fs.appendFile(this.logFile, lines)
    } catch (err) {
      console.error('failed to write logs to file:', err)
    }
  }

  async queryLogs(filters: {
    level?: LogEntry['level']
    category?: LogEntry['category']
    since?: number
    limit?: number
  }): Promise<LogEntry[]> {
    try {
      const content = await fs.readFile(this.logFile, 'utf-8')
      const lines = content.trim().split('\n')
      
      let entries = lines
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as LogEntry)

      if (filters.level) {
        entries = entries.filter(e => e.level === filters.level)
      }

      if (filters.category) {
        entries = entries.filter(e => e.category === filters.category)
      }

      if (filters.since) {
        entries = entries.filter(e => e.timestamp >= filters.since)
      }

      if (filters.limit) {
        entries = entries.slice(-filters.limit)
      }

      return entries
    } catch (err: any) {
      if (err.code === 'ENOENT') return []
      throw err
    }
  }
}

