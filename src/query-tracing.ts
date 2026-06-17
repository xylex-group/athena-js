import { attachAthenaDebugAst } from './query-debug-ast.ts'
import type {
  AthenaClientExperimentalOptions,
  AthenaQueryTraceCallsite,
  AthenaQueryTraceEvent,
  AthenaResult,
} from './client.ts'
import type {
  AthenaGatewayCallOptions,
  AthenaRpcCallOptions,
} from './gateway/types.ts'
import type { AthenaQueryDebugAst } from './query-debug-ast.ts'

const QUERY_TRACE_STACK_SKIP_PATTERNS = [
  'src\\client.ts',
  'src/client.ts',
  'src\\query-tracing.ts',
  'src/query-tracing.ts',
  'dist\\client.',
  'dist/client.',
  'dist\\query-tracing.',
  'dist/query-tracing.',
  'node_modules\\@xylex-group\\athena',
  'node_modules/@xylex-group/athena',
  'node:internal',
  'internal/process',
] as const

type AthenaTraceOperation = AthenaQueryTraceEvent['operation']
type AthenaTraceEndpoint = AthenaQueryTraceEvent['endpoint']

export interface AthenaTraceContext {
  operation: AthenaTraceOperation
  endpoint: AthenaTraceEndpoint
  table?: string
  functionName?: string
  sql: string
  payload: unknown
  ast?: AthenaQueryDebugAst
  options?: AthenaGatewayCallOptions | AthenaRpcCallOptions
}

export type AthenaQueryTracer = {
  captureCallsite: () => AthenaQueryTraceCallsite | null
  publishSuccess: <T>(
    context: AthenaTraceContext,
    result: AthenaResult<T>,
    durationMs: number,
    callsite: AthenaQueryTraceCallsite | null,
  ) => void
  publishFailure: (
    context: AthenaTraceContext,
    error: unknown,
    durationMs: number,
    callsite: AthenaQueryTraceCallsite | null,
  ) => void
}

export type AthenaTraceCallsiteStore = {
  resolve: (callsite?: AthenaQueryTraceCallsite | null) => AthenaQueryTraceCallsite | null
}

function parseQueryTraceCallsiteFrame(frame: string): AthenaQueryTraceCallsite | null {
  const trimmed = frame.trim()
  if (!trimmed) {
    return null
  }

  let body = trimmed.replace(/^at\s+/, '')
  if (body.startsWith('async ')) {
    body = body.slice(6)
  }

  let functionName: string | undefined
  let location = body
  const wrappedMatch = body.match(/^(.*?)\s+\((.*)\)$/)
  if (wrappedMatch) {
    functionName = wrappedMatch[1].trim() || undefined
    location = wrappedMatch[2].trim()
  }

  const locationMatch = location.match(/^(.*):(\d+):(\d+)$/)
  if (!locationMatch) {
    return null
  }

  const filePath = locationMatch[1].replace(/^file:\/\//, '')
  const line = Number(locationMatch[2])
  const column = Number(locationMatch[3])
  if (!Number.isFinite(line) || !Number.isFinite(column)) {
    return null
  }

  const normalizedPath = filePath.replace(/\\/g, '/')
  const fileName = normalizedPath.split('/').at(-1) ?? filePath
  return {
    filePath,
    fileName,
    line,
    column,
    frame: trimmed,
    functionName,
  }
}

function captureQueryTraceCallsite(): AthenaQueryTraceCallsite | null {
  const stack = new Error().stack
  if (!stack) return null
  const frames = stack
    .split('\n')
    .slice(2)
    .map(frame => frame.trim())
    .filter(Boolean)

  for (const frame of frames) {
    if (QUERY_TRACE_STACK_SKIP_PATTERNS.some(pattern => frame.includes(pattern))) {
      continue
    }
    const callsite = parseQueryTraceCallsiteFrame(frame)
    if (callsite) return callsite
  }

  const fallback = frames.find(frame => !frame.includes('captureQueryTraceCallsite'))
  return fallback ? parseQueryTraceCallsiteFrame(fallback) : null
}

function defaultQueryTraceLogger(event: AthenaQueryTraceEvent): void {
  const target = event.table ?? event.functionName ?? 'gateway'
  const outcomeState = event.outcome?.error ? 'error' : 'ok'
  const banner = `[athena-js][trace] ${event.operation.toUpperCase()} ${event.endpoint} ${target} ${event.durationMs}ms ${outcomeState}`
  console.info(banner, event)
}

export function captureTraceCallsite(tracer?: AthenaQueryTracer): AthenaQueryTraceCallsite | null {
  return tracer?.captureCallsite() ?? null
}

export function createTraceCallsiteStore(
  tracer?: AthenaQueryTracer,
  initialCallsite?: AthenaQueryTraceCallsite | null,
): AthenaTraceCallsiteStore {
  let storedCallsite = initialCallsite ?? undefined

  return {
    resolve(callsite) {
      if (callsite) {
        storedCallsite = callsite
        return callsite
      }
      if (storedCallsite !== undefined) {
        return storedCallsite
      }
      const capturedCallsite = captureTraceCallsite(tracer)
      if (capturedCallsite) {
        storedCallsite = capturedCallsite
      }
      return capturedCallsite
    },
  }
}

export function createQueryTracer(
  experimental?: AthenaClientExperimentalOptions,
): AthenaQueryTracer | undefined {
  const traceOption = experimental?.traceQueries
  if (!traceOption) {
    return undefined
  }

  const logger =
    typeof traceOption === 'object' && traceOption.logger ? traceOption.logger : defaultQueryTraceLogger

  const emit = (event: AthenaQueryTraceEvent) => {
    try {
      logger(event)
    } catch (error) {
      console.warn('[athena-js][trace] logger failed', error)
    }
  }

  return {
    captureCallsite: captureQueryTraceCallsite,
    publishSuccess<T>(
      context: AthenaTraceContext,
      result: AthenaResult<T>,
      durationMs: number,
      callsite: AthenaQueryTraceCallsite | null,
    ) {
      emit({
        timestamp: new Date().toISOString(),
        durationMs,
        operation: context.operation,
        endpoint: context.endpoint,
        table: context.table,
        functionName: context.functionName,
        sql: context.sql,
        payload: context.payload,
        ast: context.ast,
        options: context.options,
        callsite,
        outcome: {
          status: result.status,
          error: result.error,
          errorDetails: result.errorDetails ?? null,
          count: result.count ?? null,
          data: result.data,
          raw: result.raw,
        },
      })
    },
    publishFailure(
      context: AthenaTraceContext,
      error: unknown,
      durationMs: number,
      callsite: AthenaQueryTraceCallsite | null,
    ) {
      emit({
        timestamp: new Date().toISOString(),
        durationMs,
        operation: context.operation,
        endpoint: context.endpoint,
        table: context.table,
        functionName: context.functionName,
        sql: context.sql,
        payload: context.payload,
        ast: context.ast,
        options: context.options,
        callsite,
        thrownError: error,
      })
    },
  }
}

export async function executeWithQueryTrace<T>(
  tracer: AthenaQueryTracer | undefined,
  context: AthenaTraceContext,
  runner: () => Promise<AthenaResult<T>>,
  callsiteOverride?: AthenaQueryTraceCallsite | null,
): Promise<AthenaResult<T>> {
  const callsite = tracer ? (callsiteOverride ?? tracer.captureCallsite()) : null
  const startedAt = tracer ? Date.now() : 0
  try {
    const result = await runner()
    attachAthenaDebugAst(result, context.ast)
    if (tracer) {
      tracer.publishSuccess(context, result, Date.now() - startedAt, callsite)
    }
    return result
  } catch (error) {
    attachAthenaDebugAst(error, context.ast)
    if (tracer) {
      tracer.publishFailure(context, error, Date.now() - startedAt, callsite)
    }
    throw error
  }
}
