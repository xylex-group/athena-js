/**
 * local backend implementation
 * 
 * backend adapter for local development and testing
 * uses hybrid storage for persistence
 */

import { Backend, type BackendConfig } from './world-interface.js'
import { HybridStore } from '../persistence/hybrid-store.js'
import { Logger } from '../telemetry/logger.js'

/**
 * local backend for development
 */
export class LocalBackend extends Backend {
  private logger: Logger

  constructor(config: Partial<BackendConfig> = {}) {
    const storage = config.storage || new HybridStore()
    
    super({
      ...config,
      storage,
      webhookBaseUrl: config.webhookBaseUrl || 'http://localhost:3000/webhooks'
    })

    this.logger = new Logger('local-backend')
  }

  async initialize(): Promise<void> {
    this.logger.info('system', 'initializing local backend')
    await this.storage.initialize()
    this.logger.info('system', 'local backend initialized')
  }

  async shutdown(): Promise<void> {
    this.logger.info('system', 'shutting down local backend')
    await this.storage.shutdown()
    this.logger.info('system', 'local backend shutdown complete')
  }
}
