import { AsyncLocalStorage } from "node:async_hooks";
import type { BillingSqlExecutor } from "../subject/repository.ts";
import type {
  AthenaBillingTraceRecord,
  AthenaBillingTraceStart,
  BillingTracePhase,
} from "./types.ts";

export interface AthenaBillingActiveTrace {
  failure(error: unknown, phase?: BillingTracePhase): Promise<void>;
  phase(name: BillingTracePhase): { finish(): void };
  setCounters(input: {
    customersScanned?: number;
    pagesProcessed?: number;
  }): void;
  success(): Promise<void>;
}

export interface AthenaBillingTraceRecorder {
  start(input: AthenaBillingTraceStart): AthenaBillingActiveTrace;
}

const activeTraceStorage = new AsyncLocalStorage<AthenaBillingActiveTrace>();

export function currentBillingTrace(): AthenaBillingActiveTrace | undefined {
  return activeTraceStorage.getStore();
}

export function runWithBillingTrace<T>(
  trace: AthenaBillingActiveTrace,
  fn: () => Promise<T>
): Promise<T> {
  return activeTraceStorage.run(trace, fn);
}

export interface MemoryBillingTraceSink {
  records: AthenaBillingTraceRecord[];
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

function redactMetadata(
  value: Record<string, unknown>
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (
      normalized.includes("key") ||
      normalized.includes("secret") ||
      normalized.includes("token") ||
      normalized.includes("password") ||
      normalized.includes("authorization")
    ) {
      next[key] = "[REDACTED]";
      continue;
    }
    next[key] = entry;
  }
  return next;
}

function createActiveTrace(
  input: AthenaBillingTraceStart,
  persist: (record: AthenaBillingTraceRecord) => Promise<void>
): AthenaBillingActiveTrace {
  const startedAt = input.startedAt ?? new Date();
  const startedMs = performance.now();
  const timings: Partial<Record<BillingTracePhase, number>> = {};
  let pagesProcessed = 0;
  let customersScanned = 0;
  let finished = false;

  const persistSafe = async (record: AthenaBillingTraceRecord) => {
    if (finished) {
      return;
    }
    finished = true;
    try {
      await persist(record);
    } catch (error) {
      console.error("[athena-billing] trace persistence failed", {
        error: error instanceof Error ? error.message : String(error),
        traceId: record.traceId,
      });
    }
  };

  const complete = async (
    outcome: "failure" | "success",
    error?: unknown,
    errorPhase?: BillingTracePhase
  ) => {
    await persistSafe({
      causationId: input.causationId,
      checkpointMs: timings.checkpoint,
      completedAt: new Date(),
      connectionId: input.connectionId,
      correlationId: input.correlationId,
      customersScanned,
      errorCode: error ? errorCodeOf(error) : undefined,
      errorPhase,
      id: crypto.randomUUID(),
      leaseMs: timings.lease,
      metadata: redactMetadata({}),
      operation: input.operation,
      outcome,
      pagesProcessed,
      projectionMs: timings.document_projection,
      provider: input.provider,
      providerMs: timings.provider_fetch,
      resolveMs: timings.candidate_resolution,
      startedAt,
      totalMs: performance.now() - startedMs,
      traceId: input.traceId,
      transactionMs: timings.apply,
      trigger: input.trigger,
    });
  };

  return {
    async failure(error, phase) {
      await complete("failure", error, phase);
    },
    phase(name) {
      const started = performance.now();
      return {
        finish() {
          timings[name] = (timings[name] ?? 0) + (performance.now() - started);
        },
      };
    },
    setCounters(counters) {
      if (typeof counters.customersScanned === "number") {
        customersScanned = counters.customersScanned;
      }
      if (typeof counters.pagesProcessed === "number") {
        pagesProcessed = counters.pagesProcessed;
      }
    },
    async success() {
      await complete("success");
    },
  };
}

export function createNoopBillingTrace(): AthenaBillingActiveTrace {
  return {
    async failure() {},
    phase() {
      return { finish() {} };
    },
    setCounters() {},
    async success() {},
  };
}

export function createMemoryBillingTraceRecorder(
  sink: MemoryBillingTraceSink,
  sampleRate = 1
): AthenaBillingTraceRecorder {
  return {
    start(input) {
      if (!sampleAllows(sampleRate)) {
        return createNoopBillingTrace();
      }
      return createActiveTrace(input, async (record) => {
        sink.records.push(record);
      });
    },
  };
}

export function createDisabledBillingTraceRecorder(): AthenaBillingTraceRecorder {
  return {
    start() {
      return createNoopBillingTrace();
    },
  };
}

export function createPostgresBillingTraceRecorder(
  sql: BillingSqlExecutor,
  sampleRate = 1
): AthenaBillingTraceRecorder {
  return {
    start(input) {
      if (!sampleAllows(sampleRate)) {
        return createNoopBillingTrace();
      }
      return createActiveTrace(input, (record) =>
        insertTraceBilling(sql, record)
      );
    },
  };
}

export async function insertTraceBilling(
  sql: BillingSqlExecutor,
  record: AthenaBillingTraceRecord
): Promise<void> {
  await sql.query(
    `
INSERT INTO athena.traces_billing (
	id,
	trace_id,
	correlation_id,
	causation_id,
	operation,
	trigger,
	connection_id,
	provider,
	outcome,
	error_code,
	error_phase,
	lease_ms,
	provider_ms,
	resolve_ms,
	transaction_ms,
	projection_ms,
	checkpoint_ms,
	total_ms,
	pages_processed,
	customers_scanned,
	metadata,
	started_at,
	completed_at
) VALUES (
	$1, $2, $3, $4, $5, $6, $7::uuid, $8, $9, $10, $11,
	$12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb, $22, $23
)
`,
    [
      record.id,
      record.traceId,
      record.correlationId ?? null,
      record.causationId ?? null,
      record.operation,
      record.trigger,
      record.connectionId,
      record.provider,
      record.outcome,
      record.errorCode ?? null,
      record.errorPhase ?? null,
      record.leaseMs ?? null,
      record.providerMs ?? null,
      record.resolveMs ?? null,
      record.transactionMs ?? null,
      record.projectionMs ?? null,
      record.checkpointMs ?? null,
      record.totalMs,
      record.pagesProcessed ?? 0,
      record.customersScanned ?? 0,
      JSON.stringify(record.metadata ?? {}),
      record.startedAt,
      record.completedAt,
    ]
  );
}

export function billingTraceToDevtoolsEvent(record: AthenaBillingTraceRecord): {
  connectionId: string;
  correlationId?: string;
  domain: "billing";
  errorPhase?: string;
  event: string;
  operation: string;
  outcome: string;
  provider: string;
  timings: {
    billing: {
      phaseTimings: {
        checkpointMs?: number;
        projectionMs?: number;
        providerMs?: number;
        resolveMs?: number;
        transactionMs?: number;
      };
      providerResourceId?: string;
      resourceId?: string;
      resourceKind?: string;
    };
    totalMs: number;
  };
  traceId: string;
} {
  return {
    connectionId: record.connectionId,
    correlationId: record.correlationId,
    domain: "billing",
    errorPhase: record.errorPhase,
    event: record.operation,
    operation: record.operation,
    outcome: record.outcome,
    provider: record.provider,
    timings: {
      billing: {
        phaseTimings: {
          checkpointMs: record.checkpointMs ?? undefined,
          projectionMs: record.projectionMs ?? undefined,
          providerMs: record.providerMs ?? undefined,
          resolveMs: record.resolveMs ?? undefined,
          transactionMs: record.transactionMs ?? undefined,
        },
        providerResourceId:
          typeof record.metadata?.providerResourceId === "string"
            ? record.metadata.providerResourceId
            : undefined,
        resourceId:
          typeof record.metadata?.resourceId === "string"
            ? record.metadata.resourceId
            : undefined,
        resourceKind:
          typeof record.metadata?.resourceKind === "string"
            ? record.metadata.resourceKind
            : undefined,
      },
      totalMs: record.totalMs,
    },
    traceId: record.traceId,
  };
}
