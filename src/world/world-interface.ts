/**
 * backend interface
 * 
 * adapter responsible for workflow storage queuing auth streaming
 * through a given backend like local backend or vercel backend
 * 
 * inspired by workflow dev kit terminology
 */

import type { Store, Task } from '../types/index.js'

/**
 * backend configuration
 */
export interface BackendConfig {
  storage?: Store
  queue?: QueueProvider
  auth?: AuthProvider
  stream?: StreamProvider
  webhookBaseUrl?: string
}

/**
 * queue provider interface
 */
export interface QueueProvider {
  enqueue(task: Task): Promise<void>
  dequeue(taskQueue?: string): Promise<Task | undefined>
  getSize(taskQueue?: string): Promise<number>
  peek(limit?: number): Promise<Task[]>
}

/**
 * auth provider interface
 */
export interface AuthProvider {
  verifyToken(token: string): Promise<boolean>
  generateToken(workflowId: string, type: 'hook' | 'webhook'): Promise<string>
}

/**
 * stream provider interface
 */
export interface StreamProvider {
  createStream(workflowId: string): WritableStream<any>
  getStream(workflowId: string): ReadableStream<any> | undefined
  closeStream(workflowId: string): void
}

/**
 * backend abstract class
 * 
 * extend this to create custom backend implementations
 */
export abstract class Backend {
  public readonly storage: Store
  public readonly queue: QueueProvider
  public readonly auth: AuthProvider
  public readonly stream: StreamProvider
  public readonly webhookBaseUrl: string

  constructor(config: BackendConfig) {
    if (!config.storage) {
      throw new Error('backend requires storage provider')
    }
    
    this.storage = config.storage
    this.queue = config.queue || this.createDefaultQueue()
    this.auth = config.auth || this.createDefaultAuth()
    this.stream = config.stream || this.createDefaultStream()
    this.webhookBaseUrl = config.webhookBaseUrl || 'http://localhost:3000/webhooks'
  }

  /**
   * initialize backend resources
   */
  abstract initialize(): Promise<void>

  /**
   * shutdown backend resources
   */
  abstract shutdown(): Promise<void>

  /**
   * generate webhook url
   */
  generateWebhookUrl(webhookId: string, token: string): string {
    return `${this.webhookBaseUrl}/${webhookId}?token=${token}`
  }

  /**
   * default queue implementation
   */
  protected createDefaultQueue(): QueueProvider {
    const queue: Task[] = []
    
    return {
      async enqueue(task: Task): Promise<void> {
        queue.push(task)
        queue.sort((a, b) => (b.priority || 0) - (a.priority || 0))
      },
      
      async dequeue(taskQueue?: string): Promise<Task | undefined> {
        if (taskQueue) {
          const idx = queue.findIndex(t => t.taskQueue === taskQueue)
          if (idx >= 0) {
            return queue.splice(idx, 1)[0]
          }
          return undefined
        }
        return queue.shift()
      },
      
      async getSize(taskQueue?: string): Promise<number> {
        if (taskQueue) {
          return queue.filter(t => t.taskQueue === taskQueue).length
        }
        return queue.length
      },
      
      async peek(limit = 10): Promise<Task[]> {
        return queue.slice(0, limit)
      }
    }
  }

  /**
   * default auth implementation
   */
  protected createDefaultAuth(): AuthProvider {
    const tokens = new Map<string, { workflowId: string; type: 'hook' | 'webhook' }>()
    
    return {
      async verifyToken(token: string): Promise<boolean> {
        return tokens.has(token)
      },
      
      async generateToken(workflowId: string, type: 'hook' | 'webhook'): Promise<string> {
        const token = `${type}_${workflowId}_${Math.random().toString(36).substring(2, 15)}`
        tokens.set(token, { workflowId, type })
        return token
      }
    }
  }

  /**
   * default stream implementation
   */
  protected createDefaultStream(): StreamProvider {
    const streams = new Map<string, { writable: WritableStream<any>; readable: ReadableStream<any> }>()
    
    return {
      createStream(workflowId: string): WritableStream<any> {
        let controller: ReadableStreamDefaultController

        const readable = new ReadableStream({
          start(c) {
            controller = c
          }
        })

        const writable = new WritableStream({
          write(chunk) {
            controller.enqueue(chunk)
          },
          close() {
            controller.close()
          }
        })

        streams.set(workflowId, { writable, readable })
        return writable
      },
      
      getStream(workflowId: string): ReadableStream<any> | undefined {
        return streams.get(workflowId)?.readable
      },
      
      closeStream(workflowId: string): void {
        streams.delete(workflowId)
      }
    }
  }
}
