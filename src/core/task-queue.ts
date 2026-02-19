/**
 * task queue
 * 
 * manages the queue of tasks waiting to be executed. supports multiple named
 * queues for routing tasks to specific workers.
 */

import type { Task, Store } from '../types/index.js'

export class TaskQueue {
  constructor(private store: Store) {}

  async enqueue(task: Task): Promise<void> {
    await this.store.enqueueTask(task)
  }

  async dequeue(taskQueue?: string): Promise<Task | undefined> {
    return await this.store.dequeueTask(taskQueue)
  }

  async peek(limit = 10): Promise<Task[]> {
    return await this.store.peekQueue(limit)
  }

  async size(taskQueue?: string): Promise<number> {
    return await this.store.getQueueSize(taskQueue)
  }
}

