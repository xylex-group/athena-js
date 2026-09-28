import { AsyncLocalStorage } from "node:async_hooks";
import type { AthenaAuthActor } from "../domain/context.ts";
import type { AthenaAuthImplementedDomainEvent } from "../hooks/events.ts";
import type { AthenaAuthDatabase } from "../local/database.ts";
import { currentAuthRequestTiming } from "../local/request-timing.ts";
import type {
  AthenaAuthTracePhase,
  AthenaAuthTraceRecord,
  AthenaAuthTraceStart,
} from "./types.ts";

export interface AthenaAuthActiveTrace {
  failure(error: unknown, statusCode: number, totalMs?: number): Promise<void>;
  phase(name: AthenaAuthTracePhase): { finish(): void };
  setActor(actor: AthenaAuthActor): void;
  setEvent(event: AthenaAuthImplementedDomainEvent, eventId: string): void;
  success(statusCode: number, totalMs?: number): Promise<void>;
}

export interface AthenaAuthTraceRecorder {
  start(input: AthenaAuthTraceStart): AthenaAuthActiveTrace;
}

const activeTraceStorage = new AsyncLocalStorage<AthenaAuthActiveTrace>();

export function currentAuthTrace(): AthenaAuthActiveTrace | undefined {
  return activeTraceStorage.getStore();
}

export function runWithAuthTrace<T>(
  trace: AthenaAuthActiveTrace,
  fn: () => Promise<T>
): Promise<T> {
  return activeTraceStorage.run(trace, fn);
}

export interface MemoryAuthTraceSink {
  records: AthenaAuthTraceRecord[];
}

function sampleAllows(sampleRate: number): boolean {
  if (sampleRate >= 1) {
    return true;
  }
  if (sampleRate <= 0) {
    return false;
  }
  return Math.random() < sampleRate;
}

function errorCodeOf(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code : undefined;
}

function createActiveTrace(
  input: AthenaAuthTraceStart,
  persist: (record: AthenaAuthTraceRecord) => Promise<void>
): AthenaAuthActiveTrace {
  const startedAt = input.startedAt ?? new Date();
  const startedMs = performance.now();
  const timings: Partial<Record<AthenaAuthTracePhase, number>> = {};
  let actor: AthenaAuthActor | undefined;
  let eventId: string | undefined;
  let operation = input.operation;
  let finished = false;

  const persistSafe = async (record: AthenaAuthTraceRecord) => {
    if (finished) {
      return;
    }
    finished = true;
    try {
      await persist(record);
    } catch (error) {
      console.error("[athena-auth] trace persistence failed", {
        error: error instanceof Error ? error.message : String(error),
        traceId: record.traceId,
      });
    }
  };

  const complete = async (
    outcome: "failure" | "success",
    statusCode: number,
    error?: unknown,
    totalMs?: number
  ) => {
    const completedAt = new Date();
    const requestTiming = currentAuthRequestTiming()?.copy();
    await persistSafe({
      actorKind: actor?.kind,
      actorUserId: actor?.userId,
      afterHooksMs: timings.after_hooks,
      authorizeMs: timings.authorize ?? requestTiming?.authzMs,
      beforeHooksMs: timings.before_hooks,
      completedAt,
      errorCode: error ? errorCodeOf(error) : undefined,
      errorPhase: error ? "request" : undefined,
      eventId,
      id: crypto.randomUUID(),
      metadata: requestTiming ? { requestTiming } : {},
      method: input.method,
      operation,
      organizationId: actor?.organizationId,
      outcome,
      path: input.path,
      requestTiming,
      startedAt,
      statusCode,
      totalMs: totalMs ?? performance.now() - startedMs,
      traceId: input.traceId,
      transactionMs: timings.transaction,
      validateMs: timings.validate,
    });
  };

  return {
    async failure(error, statusCode, totalMs) {
      await complete("failure", statusCode, error, totalMs);
    },
    phase(name) {
      const started = performance.now();
      return {
        finish() {
          timings[name] = (timings[name] ?? 0) + (performance.now() - started);
        },
      };
    },
    setActor(next) {
      actor = next;
    },
    setEvent(event, nextEventId) {
      operation = event;
      eventId = nextEventId;
    },
    async success(statusCode, totalMs) {
      await complete("success", statusCode, undefined, totalMs);
    },
  };
}

export function createMemoryAuthTraceRecorder(
  sink: MemoryAuthTraceSink,
  sampleRate = 1
): AthenaAuthTraceRecorder {
  return {
    start(input) {
      if (!sampleAllows(sampleRate)) {
        return createNoopTrace();
      }
      return createActiveTrace(input, async (record) => {
        sink.records.push(record);
      });
    },
  };
}

export function createPostgresAuthTraceRecorder(
  database: AthenaAuthDatabase,
  sampleRate = 1
): AthenaAuthTraceRecorder {
  return {
    start(input) {
      if (!sampleAllows(sampleRate)) {
        return createNoopTrace();
      }
      return createActiveTrace(input, (record) =>
        insertTraceAuth(database, record)
      );
    },
  };
}

export function createNoopTrace(): AthenaAuthActiveTrace {
  return {
    async failure() {},
    phase() {
      return { finish() {} };
    },
    setActor() {},
    setEvent() {},
    async success() {},
  };
}

export async function insertTraceAuth(
  db: AthenaAuthDatabase,
  record: AthenaAuthTraceRecord
): Promise<void> {
  await db.query(
    `
INSERT INTO athena.traces_auth (
	id,
	trace_id,
	event_id,
	operation,
	method,
	path,
	actor_kind,
	actor_user_id,
	organization_id,
	outcome,
	status_code,
	authorize_ms,
	validate_ms,
	before_hooks_ms,
	transaction_ms,
	after_hooks_ms,
	total_ms,
	error_code,
	error_phase,
	metadata,
	started_at,
	completed_at
) VALUES (
	$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
)
`,
    [
      record.id,
      record.traceId,
      record.eventId ?? null,
      record.operation ?? null,
      record.method,
      record.path,
      record.actorKind ?? null,
      record.actorUserId ?? null,
      record.organizationId ?? null,
      record.outcome,
      record.statusCode ?? null,
      record.authorizeMs ?? null,
      record.validateMs ?? null,
      record.beforeHooksMs ?? null,
      record.transactionMs ?? null,
      record.afterHooksMs ?? null,
      record.totalMs,
      record.errorCode ?? null,
      record.errorPhase ?? null,
      record.metadata,
      record.startedAt,
      record.completedAt,
    ]
  );
}
