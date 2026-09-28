import type { AthenaAuthActor } from "../domain/context.ts";
import type { AthenaAuthImplementedDomainEvent } from "../hooks/events.ts";
import type { AuthRequestTimingSnapshot } from "../local/request-timing.ts";

export type { AthenaAuthActor } from "../domain/context.ts";

export type AthenaAuthTracePhase =
  | "after_hooks"
  | "authorize"
  | "before_hooks"
  | "transaction"
  | "validate";

export type AthenaAuthTraceOutcome = "failure" | "success";

export interface AthenaAuthAuditSubject {
  id: string;
  type: string;
}

export interface AthenaAuthAuditEntry {
  actor: AthenaAuthActor;
  event: AthenaAuthImplementedDomainEvent;
  eventId: string;
  id: string;
  organizationId?: string;
  outcome: "success";
  previous?: unknown;
  request: {
    ipAddress?: string;
    userAgent?: string;
  };
  result?: unknown;
  subject?: AthenaAuthAuditSubject;
  traceId: string;
}

export interface AthenaAuthTraceStart {
  method: string;
  operation?: string;
  path: string;
  startedAt?: Date;
  traceId: string;
}

export interface AthenaAuthTraceRecord {
  actorKind?: AthenaAuthActor["kind"];
  actorUserId?: string;
  afterHooksMs?: number;
  authorizeMs?: number;
  beforeHooksMs?: number;
  completedAt: Date;
  errorCode?: string;
  errorPhase?: string;
  eventId?: string;
  id: string;
  metadata: Record<string, unknown>;
  method: string;
  operation?: string;
  organizationId?: string;
  outcome: AthenaAuthTraceOutcome;
  path: string;
  requestTiming?: AuthRequestTimingSnapshot;
  startedAt: Date;
  statusCode?: number;
  totalMs: number;
  traceId: string;
  transactionMs?: number;
  validateMs?: number;
}

export interface AthenaAuthTracesSamplingConfig {
  retentionDays?: number;
  sampleRate?: number;
}

export type AthenaAuthTracesConfig = boolean | AthenaAuthTracesSamplingConfig;

export interface AthenaAuthObservabilityConfig {
  auditLog?: boolean;
  traces?: AthenaAuthTracesConfig;
}

export interface NormalizedAthenaAuthObservability {
  auditLog: boolean;
  traces: {
    enabled: boolean;
    retentionDays?: number;
    sampleRate: number;
  };
}
