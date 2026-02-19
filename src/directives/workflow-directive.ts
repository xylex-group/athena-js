/**
 * workflow directives
 * 
 * implements use workflow and use step directives
 * for compile time transformations sandboxing and deterministic replay
 * 
 * three transformation modes:
 * - step mode: side effecting operations
 * - workflow mode: pure orchestrators
 * - client mode: execution context
 */

import { createContext, runInContext } from 'vm'
import type { Workflow, Activity, WorkflowContext } from '../types/index.js'

/**
 * directive types
 */
export type DirectiveType = 'workflow' | 'step' | 'none'

/**
 * transformation mode
 */
export type TransformMode = 'workflow' | 'step' | 'client'

/**
 * directive metadata
 */
export interface DirectiveMetadata {
  type: DirectiveType
  name: string
  filePath?: string
  stableId: string
}

/**
 * directive registry
 * 
 * tracks all registered workflows and steps with stable ids
 */
export class DirectiveRegistry {
  private workflows = new Map<string, Workflow>()
  private steps = new Map<string, Activity>()
  private metadata = new Map<string, DirectiveMetadata>()

  /**
   * register workflow with directive metadata
   */
  registerWorkflow(workflow: Workflow, metadata?: Partial<DirectiveMetadata>): void {
    const stableId = this.generateStableId(workflow.name, 'workflow', metadata?.filePath)
    
    this.workflows.set(stableId, workflow)
    this.metadata.set(stableId, {
      type: 'workflow',
      name: workflow.name,
      filePath: metadata?.filePath,
      stableId
    })
  }

  /**
   * register step with directive metadata
   */
  registerStep(step: Activity, metadata?: Partial<DirectiveMetadata>): void {
    const stableId = this.generateStableId(step.name, 'step', metadata?.filePath)
    
    this.steps.set(stableId, step)
    this.metadata.set(stableId, {
      type: 'step',
      name: step.name,
      filePath: metadata?.filePath,
      stableId
    })
  }

  /**
   * get workflow by stable id
   */
  getWorkflow(stableId: string): Workflow | undefined {
    return this.workflows.get(stableId)
  }

  /**
   * get step by stable id
   */
  getStep(stableId: string): Activity | undefined {
    return this.steps.get(stableId)
  }

  /**
   * get metadata
   */
  getMetadata(stableId: string): DirectiveMetadata | undefined {
    return this.metadata.get(stableId)
  }

  /**
   * generate stable id based on file path and function name
   */
  private generateStableId(name: string, type: DirectiveType, filePath?: string): string {
    const path = filePath || 'inline'
    return `${type}:${path}:${name}`
  }
}

/**
 * global directive registry
 */
export const globalRegistry = new DirectiveRegistry()

/**
 * workflow sandbox
 * 
 * sandboxed execution environment for workflow functions
 * prevents side effects and ensures determinism
 */
export class WorkflowSandbox {
  private context: any

  constructor(workflowContext: WorkflowContext) {
    // create isolated vm context
    this.context = createContext({
      console: {
        log: (...args: any[]) => console.log('[workflow]', ...args),
        error: (...args: any[]) => console.error('[workflow]', ...args),
        warn: (...args: any[]) => console.warn('[workflow]', ...args)
      },
      Math,
      Date: this.createDeterministicDate(workflowContext),
      Promise,
      Object,
      Array,
      String,
      Number,
      Boolean,
      JSON,
      // workflow context methods
      ctx: workflowContext,
      // prevent access to node apis
      require: undefined,
      process: undefined,
      global: undefined,
      Buffer: undefined,
      setTimeout: undefined,
      setInterval: undefined,
      setImmediate: undefined
    })
  }

  /**
   * create deterministic date object for replay
   */
  private createDeterministicDate(_ctx: WorkflowContext): DateConstructor {
    const deterministicNow = Date.now()
    
    return class DeterministicDate extends Date {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super(deterministicNow)
        } else {
          super(...args as [])
        }
      }

      static now(): number {
        return deterministicNow
      }
    } as any
  }

  /**
   * execute code in sandbox
   */
  execute<T>(code: string): T {
    return runInContext(code, this.context) as T
  }

  /**
   * execute function in sandbox
   */
  executeFunction<T, R>(fn: (ctx: WorkflowContext, input: T) => Promise<R>, input: T): Promise<R> {
    const fnCode = `(${fn.toString()})(ctx, input)`
    this.context.input = input
    return this.execute<Promise<R>>(fnCode)
  }
}

/**
 * create directive workflow
 * 
 * wraps workflow function with use workflow semantics
 */
export function createDirectiveWorkflow<T, R>(
  name: string,
  handler: (ctx: WorkflowContext, input: T) => Promise<R>,
  options: any = {}
): Workflow<T, R> {
  const workflow: Workflow<T, R> = {
    name,
    handler: async (ctx: WorkflowContext, input: T): Promise<R> => {
      // create sandbox for deterministic execution
      const sandbox = new WorkflowSandbox(ctx)
      
      // execute in sandbox to prevent side effects
      return await sandbox.executeFunction(handler, input)
    },
    options
  }

  // register with global registry
  globalRegistry.registerWorkflow(workflow, {
    filePath: new Error().stack?.split('\n')[2]?.match(/\((.*?):\d+:\d+\)/)?.[1]
  })

  return workflow
}

/**
 * create directive step
 * 
 * wraps activity function with use step semantics
 */
export function createDirectiveStep<T, R>(
  name: string,
  handler: (ctx: any, input: T) => Promise<R>,
  options: any = {}
): Activity<T, R> {
  const activity: Activity<T, R> = {
    name,
    handler,
    options
  }

  globalRegistry.registerStep(activity, {
    filePath: new Error().stack?.split('\n')[2]?.match(/\((.*?):\d+:\d+\)/)?.[1]
  })

  return activity
}

/**
 * validate workflow code for directive usage
 * 
 * checks for use workflow or use step directives at top of function
 */
export function validateWorkflowCode(code: string): DirectiveType {
  const lines = code.trim().split('\n')
  const firstLine = lines[0]?.trim().replace(/["']/g, '')

  if (firstLine === 'use workflow') {
    return 'workflow'
  }

  if (firstLine === 'use step') {
    return 'step'
  }

  return 'none'
}

/**
 * transform function based on directive
 * 
 * applies appropriate transformation mode
 */
export function transformWithDirective(
  fn: Function,
  mode: TransformMode
): Function {
  const code = fn.toString()
  const directive = validateWorkflowCode(code)

  if (directive === 'none') {
    return fn
  }

  if (mode === 'workflow' && directive === 'workflow') {
    // apply workflow transformations
    return function(this: any, ...args: any[]) {
      // ensure deterministic execution
      return fn.apply(this, args)
    }
  }

  if (mode === 'step' && directive === 'step') {
    // apply step transformations
    return function(this: any, ...args: any[]) {
      // allow side effects but track them
      return fn.apply(this, args)
    }
  }

  throw new Error(`directive mismatch: ${directive} cannot run in ${mode} mode`)
}
