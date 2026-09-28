import {
  ATHENA_INGRESS_OPERATION_HEADER,
  type AthenaIngressIR,
  type AthenaIngressStatus,
} from "./ir.ts";
import type {
  EventIngressDatabase,
  EventIngressPersistence,
  EventIngressQueryResult,
  EventIngressRecord,
} from "./persistence.ts";

export class MemoryEventIngressDatabase implements EventIngressDatabase {
  readonly ingress = new Map<string, EventIngressRecord>();

  async query<T = Record<string, unknown>>(): Promise<
    EventIngressQueryResult<T>
  > {
    return { rowCount: 0, rows: [] };
  }

  async transaction<T>(
    fn: (tx: EventIngressDatabase) => Promise<T>
  ): Promise<T> {
    return fn(this);
  }
}

function cloneBody(body: Uint8Array): Uint8Array {
  return Uint8Array.from(body);
}

export function createMemoryEventIngressPersistence(
  store: MemoryEventIngressDatabase
): EventIngressPersistence {
  return {
    async insertReceived(_tx, ingress, meta) {
      if (meta.providerEventId) {
        for (const row of store.ingress.values()) {
          if (
            row.id !== ingress.id &&
            row.domain === ingress.domain &&
            row.provider === (meta.provider ?? null) &&
            row.providerEventId === meta.providerEventId
          ) {
            return {
              duplicate: true,
              ingressId: row.id,
            };
          }
        }
      }
      const existing = store.ingress.get(ingress.id);
      if (existing) {
        if (meta.providerEventId) {
          existing.providerEventId = meta.providerEventId;
        }
        return {
          duplicate: false,
          ingressId: existing.id,
        };
      }
      store.ingress.set(ingress.id, {
        attemptCount: 0,
        body: cloneBody(ingress.body),
        connectionId: ingress.connectionId ?? null,
        correlationId: ingress.correlationId ?? null,
        domain: ingress.domain,
        headers: ingress.headers,
        id: ingress.id,
        operation: ingress.operation,
        provider: meta.provider ?? null,
        providerEventId: meta.providerEventId ?? null,
        receivedAt: ingress.receivedAt,
        status: "received",
        traceId: ingress.traceId ?? null,
      });
      return {
        duplicate: false,
        ingressId: ingress.id,
      };
    },
    async lock(_tx, ingressId) {
      return store.ingress.get(ingressId);
    },
    async markProcessed(_tx, input) {
      const row = store.ingress.get(input.ingressId);
      if (row) {
        row.status = "processed";
      }
    },
    async markStatus(_tx, input) {
      const row = store.ingress.get(input.ingressId);
      if (row) {
        row.status = input.status;
        if (
          input.status === "retryable_failure" ||
          input.status === "terminal_failure"
        ) {
          row.attemptCount += 1;
        }
        if (input.error !== undefined) {
          row.error = input.error;
        }
        row.failureStage = input.failureStage ?? row.failureStage;
        row.firstFailedAt = input.firstFailedAt ?? row.firstFailedAt;
        row.nextAttemptAt = input.nextAttemptAt ?? row.nextAttemptAt;
        row.leaseExpiresAt =
          input.status === "retryable_failure" ||
          input.status === "terminal_failure" ||
          input.status === "processed" ||
          input.status === "ignored"
            ? null
            : (input.leaseExpiresAt ?? row.leaseExpiresAt);
      }
    },
  };
}

export function memoryIngressFromRecord(
  record: EventIngressRecord,
  operation?: string
): AthenaIngressIR {
  const resolved =
    operation ??
    record.operation ??
    record.headers[ATHENA_INGRESS_OPERATION_HEADER];
  if (resolved == null || resolved.length === 0) {
    throw new Error(
      "Ingress replay requires the persisted channel operation; do not infer it from the body."
    );
  }
  return {
    body: record.body,
    domain: record.domain,
    headers: record.headers,
    id: record.id,
    operation: resolved,
    receivedAt: record.receivedAt,
    transport: { kind: "direct" },
    ...(record.correlationId ? { correlationId: record.correlationId } : {}),
    ...(record.traceId ? { traceId: record.traceId } : {}),
    ...(record.connectionId ? { connectionId: record.connectionId } : {}),
  };
}

export type { AthenaIngressStatus };
