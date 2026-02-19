/**
 * saga pattern / compensation logic
 * 
 * when workflows fail partway through, you need to undo what you did.
 * sagas let you register compensation functions that run in reverse order
 * to clean up after failures.
 */

import type { CompensationState } from '../types/index.js'

export interface Compensation {
  id: string
  fn: () => Promise<void>
  executed: boolean
  error?: string
}

export class SagaCoordinator {
  private compensations: Compensation[] = []

  /**
   * add a compensation function
   * 
   * these run in reverse order (LIFO) if the workflow fails
   */
  addCompensation(id: string, fn: () => Promise<void>): void {
    this.compensations.push({
      id,
      fn,
      executed: false,
    })
  }

  /**
   * execute all compensations in reverse order
   * 
   * if a compensation fails, we log it but keep going with the rest.
   * the idea is to try to clean up as much as possible even if some parts fail.
   */
  async executeCompensations(
    onCompensationExecuted?: (id: string) => void,
    onCompensationFailed?: (id: string, error: string) => void
  ): Promise<void> {
    const compensationsToRun = [...this.compensations].reverse()

    for (const compensation of compensationsToRun) {
      if (compensation.executed) continue

      try {
        await compensation.fn()
        compensation.executed = true
        if (onCompensationExecuted) {
          onCompensationExecuted(compensation.id)
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        compensation.error = errorMsg
        if (onCompensationFailed) {
          onCompensationFailed(compensation.id, errorMsg)
        }
        // keep going even if this one failed
      }
    }
  }

  getCompensationStates(): CompensationState[] {
    return this.compensations.map(c => ({
      id: c.id,
      executed: c.executed,
      error: c.error,
    }))
  }

  hasCompensations(): boolean {
    return this.compensations.length > 0
  }

  clear(): void {
    this.compensations = []
  }
}

