export type BillingReconciliationTrigger =
  | "bootstrap"
  | "scheduled"
  | "manual"
  | "webhook";

export type BillingTracePhase =
  | "lease"
  | "connection"
  | "provider_fetch"
  | "candidate_resolution"
  | "apply"
  | "document_projection"
  | "audit"
  | "checkpoint"
  | "diff"
  | "verify";

export type BillingTraceOutcome = "failure" | "success";

export type BillingAuditOutcome = BillingTraceOutcome;

export interface BillingReconciliationContext {
  causationId?: string;
  connectionId: string;
  correlationId: string;
  provider: string;
  traceId: string;
  trigger: BillingReconciliationTrigger;
}

export interface BillingObservabilityActor {
  kind: "service" | "system" | "user";
  userId?: string;
}

export type AthenaBillingAuditEvent =
  | "billing.document.ownership.conflict"
  | "billing.document.ownership.resolved"
  | "billing.reconciliation.cursor.reset"
  | "billing.reconciliation.failed"
  | "billing.subject.binding.activated"
  | "billing.subject.binding.conflict"
  | "billing.subject.binding.created"
  | "billing.subject.binding.revoked"
  | "billing.webhook.registration.created"
  | "billing.webhook.registration.disabled"
  | "billing.webhook.registration.drift_detected"
  | "billing.webhook.registration.secret_rotated"
  | "billing.webhook.registration.updated";

export interface BillingSubjectRefAudit {
  id: string;
  kind: "organization" | "user";
}

export interface AthenaBillingAuditEntry {
  actor: BillingObservabilityActor;
  causationId?: string;
  connectionId: string;
  correlationId?: string;
  event: AthenaBillingAuditEvent;
  eventId: string;
  id: string;
  outcome: BillingAuditOutcome;
  previous?: unknown;
  provider: string;
  providerSubject?: {
    id: string;
    kind: "customer" | "webhook";
  };
  result?: unknown;
  subject?: BillingSubjectRefAudit;
  traceId: string;
}

export interface AthenaBillingTraceStart {
  causationId?: string;
  connectionId: string;
  correlationId?: string;
  operation: string;
  provider: string;
  startedAt?: Date;
  traceId: string;
  trigger: BillingReconciliationTrigger;
}

export interface AthenaBillingTraceRecord {
  causationId?: string;
  checkpointMs?: number;
  completedAt: Date;
  connectionId: string;
  correlationId?: string;
  customersScanned?: number;
  errorCode?: string;
  errorPhase?: string;
  id: string;
  leaseMs?: number;
  metadata: Record<string, unknown>;
  operation: string;
  outcome: BillingTraceOutcome;
  pagesProcessed?: number;
  projectionMs?: number;
  provider: string;
  providerMs?: number;
  resolveMs?: number;
  startedAt: Date;
  totalMs: number;
  traceId: string;
  transactionMs?: number;
  trigger: BillingReconciliationTrigger;
}

export interface AthenaBillingTracesSamplingConfig {
  retentionDays?: number;
  sampleRate?: number;
}

export type AthenaBillingTracesConfig =
  | boolean
  | AthenaBillingTracesSamplingConfig;

export interface AthenaBillingObservabilityConfig {
  auditLog?: boolean;
  auditRetentionDays?: number;
  traces?: AthenaBillingTracesConfig;
  webhookIngressRetentionDays?: number;
}

export interface NormalizedAthenaBillingObservability {
  auditLog: boolean;
  auditRetentionDays?: number;
  traces: {
    enabled: boolean;
    retentionDays?: number;
    sampleRate: number;
  };
  webhookIngressRetentionDays: number;
}
