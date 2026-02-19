/**
 * test harness
 * 
 * lets you test workflows deterministically. you can control time, skip ahead,
 * and wait for things to complete. makes testing way easier.
 */

import { World } from '../core/world.js'
import type { TestHarnessConfig, TestHarness } from '../types/index.js'

export function createTestHarness(config: TestHarnessConfig = {}): TestHarness {
  const world = new World({
    persistence: 'memory',
    minWorkers: 1,
    maxWorkers: 1,
  })

  let currentTime = config.initialTime || Date.now()

  // override Date.now for deterministic testing
  const originalNow = Date.now
  Date.now = () => currentTime

  const harness: TestHarness = {
    world,
    currentTime,

    async advance(ms: number): Promise<void> {
      currentTime += ms
      harness.currentTime = currentTime
      
      // give workflows time to process
      await new Promise(resolve => setTimeout(resolve, 100))
    },

    async advanceTo(timestamp: number): Promise<void> {
      if (timestamp < currentTime) {
        throw new Error('cannot go back in time')
      }
      await harness.advance(timestamp - currentTime)
    },

    async runUntilComplete(workflowId: string, timeout = 30000): Promise<void> {
      const startTime = Date.now()
      
      while (true) {
        const state = await world.query(workflowId)
        
        if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
          break
        }

        if (originalNow() - startTime > timeout) {
          throw new Error(`timeout waiting for workflow ${workflowId}`)
        }

        await new Promise(resolve => setTimeout(resolve, 100))
      }
    },
  }

  return harness
}

/**
 * restore original Date.now after testing
 */
export function cleanupTestHarness(): void {
  // this would need to be implemented properly to restore Date.now
  // for now its just a placeholder
}
