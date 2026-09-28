import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { isDebugEnabled } from "../debug.ts";
import { ensureCliErrorId } from "../errors.ts";
import type { AthenaCliLogger, CliTraceContext } from "./types.ts";

function spanId(): string {
  return randomBytes(8).toString("hex");
}

function validSpanId(value: string | undefined): value is string {
  return (
    value !== undefined &&
    /^[0-9a-f]{16}$/i.test(value) &&
    !/^[0]+$/i.test(value)
  );
}

export interface CliAsyncContext {
  readonly activeSpanId?: string;
  readonly commandId?: string;
  readonly debugEnabled: boolean;
  readonly invocationId: string;
  readonly traceId: string;
}

const asyncContext = new AsyncLocalStorage<CliAsyncContext>();

export function getCliAsyncContext(): CliAsyncContext | undefined {
  return asyncContext.getStore();
}

export function getCliActiveSpanId(
  invocationId?: string,
  traceId?: string
): string | undefined {
  const context = asyncContext.getStore();
  if (
    context &&
    (invocationId === undefined || context.invocationId === invocationId) &&
    (traceId === undefined || context.traceId === traceId)
  ) {
    return context.activeSpanId;
  }
}

export function runCliAsyncContext<T>(
  context: CliAsyncContext,
  operation: () => Promise<T> | T
): Promise<T> {
  return asyncContext.run(context, async () => operation());
}

function createTrace(
  logger: AthenaCliLogger,
  parentSpanId?: string
): CliTraceContext {
  return {
    invocationId: logger.invocationId,
    async span<T>(
      name: string,
      metadata: Record<string, unknown> | undefined,
      operation: () => Promise<T> | T
    ): Promise<T> {
      const currentSpanId = spanId();
      const activeContext = asyncContext.getStore();
      const inheritedParent =
        activeContext?.invocationId === logger.invocationId &&
        activeContext.traceId === logger.traceId
          ? activeContext.activeSpanId
          : undefined;
      const currentParent =
        inheritedParent ??
        (validSpanId(parentSpanId) ? parentSpanId : undefined);
      const startedAt = Date.now();
      logger.record({
        data: { name, ...metadata },
        kind: "call.start",
        level: "debug",
        parentSpanId: currentParent,
        spanId: currentSpanId,
      });
      const context: CliAsyncContext = {
        activeSpanId: currentSpanId,
        debugEnabled: isDebugEnabled(),
        invocationId: logger.invocationId,
        traceId: logger.traceId,
      };
      return asyncContext.run(context, async () => {
        try {
          const result = await operation();
          logger.record({
            data: { name, success: true },
            durationMs: Math.max(0, Date.now() - startedAt),
            kind: "call.finish",
            level: "debug",
            parentSpanId: currentParent,
            spanId: currentSpanId,
          });
          return result;
        } catch (error) {
          const errorId = ensureCliErrorId(error);
          logger.record({
            data: { name },
            durationMs: Math.max(0, Date.now() - startedAt),
            error,
            errorId,
            kind: "error",
            level: "error",
            message: `CLI operation failed: ${name}`,
            parentSpanId: currentParent,
            spanId: currentSpanId,
          });
          logger.record({
            data: { errorId, name, success: false },
            durationMs: Math.max(0, Date.now() - startedAt),
            kind: "call.finish",
            level: "error",
            parentSpanId: currentParent,
            spanId: currentSpanId,
          });
          throw error;
        }
      });
    },
    traceId: logger.traceId,
  };
}

export function createCliTraceContext(
  logger: AthenaCliLogger
): CliTraceContext {
  return createTrace(logger);
}

export function createChildCliTraceContext(
  logger: AthenaCliLogger,
  parentSpanId: string
): CliTraceContext {
  return createTrace(logger, parentSpanId);
}
