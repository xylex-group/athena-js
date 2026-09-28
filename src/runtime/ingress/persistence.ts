import type { AthenaIngressIR, AthenaIngressStatus } from "./ir.ts";

export interface EventIngressQueryResult<T = Record<string, unknown>> {
  rowCount: number;
  rows: T[];
}

export interface EventIngressDatabase {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<EventIngressQueryResult<T>>;
  transaction<T>(fn: (tx: EventIngressDatabase) => Promise<T>): Promise<T>;
}

export interface EventIngressRecord {
  attemptCount: number;
  body: Uint8Array;
  connectionId: string | null;
  correlationId: string | null;
  domain: string;
  error?: unknown;
  failureStage?: string | null;
  firstFailedAt?: Date | null;
  headers: Readonly<Record<string, string>>;
  id: string;
  leaseExpiresAt?: Date | null;
  nextAttemptAt?: Date | null;
  operation: string | null;
  provider: string | null;
  providerEventId: string | null;
  receivedAt: Date;
  status: AthenaIngressStatus;
  traceId: string | null;
}

export interface EventIngressInsertReceivedResult {
  duplicate: boolean;
  ingressId: string;
}

export interface EventIngressPersistence {
  insertReceived(
    tx: EventIngressDatabase,
    ingress: AthenaIngressIR,
    meta: { provider?: string; providerEventId?: string }
  ): Promise<EventIngressInsertReceivedResult>;
  lock(
    tx: EventIngressDatabase,
    ingressId: string
  ): Promise<EventIngressRecord | undefined>;
  markProcessed(
    tx: EventIngressDatabase,
    input: { ingressId: string; eventIds: readonly string[] }
  ): Promise<void>;
  markStatus(
    tx: EventIngressDatabase,
    input: {
      error?: unknown;
      failureStage?: string;
      firstFailedAt?: Date;
      ingressId: string;
      lastFailedAt?: Date;
      leaseExpiresAt?: Date;
      nextAttemptAt?: Date;
      status: AthenaIngressStatus;
    }
  ): Promise<void>;
}
