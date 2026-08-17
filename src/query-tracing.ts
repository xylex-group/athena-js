import type {
  AthenaQueryTraceCallsite,
  AthenaQueryTraceEvent,
  InternalClientBehaviorOptions,
} from "./client.ts";
import type { AthenaResult } from "./client-result.ts";
import type {
  AthenaGatewayCallOptions,
  AthenaRpcCallOptions,
} from "./gateway/types.ts";
import type { AthenaQueryDebugAst } from "./query-debug-ast.ts";
import { attachAthenaDebugAst } from "./query-debug-ast.ts";

const QUERY_TRACE_STACK_SKIP_PATTERNS = [
  "src\\client.ts",
  "src/client.ts",
  "src\\query-tracing.ts",
  "src/query-tracing.ts",
  "src\\v3-client.ts",
  "src/v3-client.ts",
  "src\\v3-client-core.ts",
  "src/v3-client-core.ts",
  "dist\\client.",
  "dist/client.",
  "dist\\query-tracing.",
  "dist/query-tracing.",
  "dist\\v3-client.",
  "dist/v3-client.",
  "node_modules\\@xylex-group\\athena",
  "node_modules/@xylex-group/athena",
  "node:internal",
  "internal/process",
] as const;

type AthenaTraceOperation = AthenaQueryTraceEvent["operation"];
type AthenaTraceEndpoint = AthenaQueryTraceEvent["endpoint"];

export interface AthenaTraceContext {
  ast?: AthenaQueryDebugAst;
  endpoint: AthenaTraceEndpoint;
  functionName?: string;
  operation: AthenaTraceOperation;
  options?: AthenaGatewayCallOptions | AthenaRpcCallOptions;
  payload: unknown;
  sql: string;
  table?: string;
}

export interface AthenaQueryTracer {
  captureCallsite: () => AthenaQueryTraceCallsite | null;
  publishFailure: (
    context: AthenaTraceContext,
    error: unknown,
    durationMs: number,
    callsite: AthenaQueryTraceCallsite | null
  ) => void;
  publishSuccess: <T>(
    context: AthenaTraceContext,
    result: AthenaResult<T>,
    durationMs: number,
    callsite: AthenaQueryTraceCallsite | null
  ) => void;
}

export interface AthenaTraceCallsiteStore {
  resolve: (
    callsite?: AthenaQueryTraceCallsite | null
  ) => AthenaQueryTraceCallsite | null;
}

function parseQueryTraceCallsiteFrame(
  frame: string
): AthenaQueryTraceCallsite | null {
  const trimmed = frame.trim();
  if (!trimmed) {
    return null;
  }

  let body = trimmed.replace(/^at\s+/, "");
  if (body.startsWith("async ")) {
    body = body.slice(6);
  }

  let functionName: string | undefined;
  let location = body;
  const wrappedMatch = body.match(/^(.*?)\s+\((.*)\)$/);
  if (wrappedMatch) {
    functionName = wrappedMatch[1].trim() || undefined;
    location = wrappedMatch[2].trim();
  }

  const locationMatch = location.match(/^(.*):(\d+):(\d+)$/);
  if (!locationMatch) {
    return null;
  }

  const filePath = locationMatch[1].replace(/^file:\/\//, "");
  const line = Number(locationMatch[2]);
  const column = Number(locationMatch[3]);
  if (!(Number.isFinite(line) && Number.isFinite(column))) {
    return null;
  }

  const normalizedPath = filePath.replace(/\\/g, "/");
  const fileName = normalizedPath.split("/").at(-1) ?? filePath;
  return {
    column,
    fileName,
    filePath,
    frame: trimmed,
    functionName,
    line,
  };
}

function captureQueryTraceCallsite(): AthenaQueryTraceCallsite | null {
  const stack = new Error("query trace stack capture").stack;
  if (!stack) {
    return null;
  }
  const frames = stack
    .split("\n")
    .slice(2)
    .map((frame) => frame.trim())
    .filter(Boolean);

  for (const frame of frames) {
    if (
      QUERY_TRACE_STACK_SKIP_PATTERNS.some((pattern) => frame.includes(pattern))
    ) {
      continue;
    }
    const callsite = parseQueryTraceCallsiteFrame(frame);
    if (callsite) {
      return callsite;
    }
  }

  const fallback = frames.find(
    (frame) => !frame.includes("captureQueryTraceCallsite")
  );
  return fallback ? parseQueryTraceCallsiteFrame(fallback) : null;
}

function defaultQueryTraceLogger(event: AthenaQueryTraceEvent): void {
  const target = event.table ?? event.functionName ?? "gateway";
  const outcomeState = event.outcome?.error ? "error" : "ok";
  const banner = `[athena-js][trace] ${event.operation.toUpperCase()} ${event.endpoint} ${target} ${event.durationMs}ms ${outcomeState}`;
  console.info(banner, event);
}

export function captureTraceCallsite(
  tracer?: AthenaQueryTracer
): AthenaQueryTraceCallsite | null {
  return tracer?.captureCallsite() ?? null;
}

export function createTraceCallsiteStore(
  tracer?: AthenaQueryTracer,
  initialCallsite?: AthenaQueryTraceCallsite | null
): AthenaTraceCallsiteStore {
  let storedCallsite = initialCallsite ?? undefined;

  return {
    resolve(callsite) {
      if (callsite) {
        storedCallsite = callsite;
        return callsite;
      }
      if (storedCallsite !== undefined) {
        return storedCallsite;
      }
      const capturedCallsite = captureTraceCallsite(tracer);
      if (capturedCallsite) {
        storedCallsite = capturedCallsite;
      }
      return capturedCallsite;
    },
  };
}

export function createQueryTracer(
  behavior?: InternalClientBehaviorOptions
): AthenaQueryTracer | undefined {
  const traceOption = behavior?.traceQueries;
  if (!traceOption) {
    return;
  }

  const logger =
    typeof traceOption === "object" && traceOption.logger
      ? traceOption.logger
      : defaultQueryTraceLogger;

  const emit = (event: AthenaQueryTraceEvent) => {
    try {
      logger(event);
    } catch (error) {
      console.warn("[athena-js][trace] logger failed", error);
    }
  };

  return {
    captureCallsite: captureQueryTraceCallsite,
    publishFailure(
      context: AthenaTraceContext,
      error: unknown,
      durationMs: number,
      callsite: AthenaQueryTraceCallsite | null
    ) {
      emit({
        ast: context.ast,
        callsite,
        durationMs,
        endpoint: context.endpoint,
        functionName: context.functionName,
        operation: context.operation,
        options: context.options,
        payload: context.payload,
        sql: context.sql,
        table: context.table,
        thrownError: error,
        timestamp: new Date().toISOString(),
      });
    },
    publishSuccess<T>(
      context: AthenaTraceContext,
      result: AthenaResult<T>,
      durationMs: number,
      callsite: AthenaQueryTraceCallsite | null
    ) {
      emit({
        ast: context.ast,
        callsite,
        durationMs,
        endpoint: context.endpoint,
        functionName: context.functionName,
        operation: context.operation,
        options: context.options,
        outcome: {
          count: result.count ?? null,
          data: result.data,
          error: result.error,
          errorDetails: result.errorDetails ?? null,
          raw: result.raw,
          status: result.status,
        },
        payload: context.payload,
        sql: context.sql,
        table: context.table,
        timestamp: new Date().toISOString(),
      });
    },
  };
}

export async function executeWithQueryTrace<T>(
  tracer: AthenaQueryTracer | undefined,
  context: AthenaTraceContext,
  runner: () => Promise<AthenaResult<T>>,
  callsiteOverride?: AthenaQueryTraceCallsite | null
): Promise<AthenaResult<T>> {
  const callsite = tracer
    ? (callsiteOverride ?? tracer.captureCallsite())
    : null;
  const startedAt = tracer ? Date.now() : 0;
  try {
    const result = await runner();
    attachAthenaDebugAst(result, context.ast);
    if (tracer) {
      tracer.publishSuccess(context, result, Date.now() - startedAt, callsite);
    }
    return result;
  } catch (error) {
    attachAthenaDebugAst(error, context.ast);
    if (tracer) {
      tracer.publishFailure(context, error, Date.now() - startedAt, callsite);
    }
    throw error;
  }
}
