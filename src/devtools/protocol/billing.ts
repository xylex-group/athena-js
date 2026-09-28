/**
 * DevTools Billing V2 inspector protocol (Athena topology, not a Mollie object viewer).
 */

type AthenaDevtoolsRedactedFact =
  | { kind: "structural"; value: string | boolean | number | null }
  | { kind: "secret"; configured: boolean }
  | { kind: "unset" };

export type AthenaDevtoolsBillingInspectorStatus =
  | "ready"
  | "initializing"
  | "failed"
  | "unconfigured";

export type AthenaDevtoolsBillingRuntimePhase =
  | "unconfigured"
  | "provider-registry"
  | "materializing-connections"
  | "attaching-ingress"
  | "registering-schedulers"
  | "ready"
  | "failed";

export type AthenaDevtoolsBillingDiagnosticCode =
  | "BILLING_CONNECTION_AMBIGUOUS"
  | "BILLING_SUBJECT_UNBOUND"
  | "BILLING_SUBJECT_CONFLICT"
  | "BILLING_PROVIDER_CREDENTIAL_MISSING"
  | "BILLING_PROVIDER_AUTHORITY_INSUFFICIENT"
  | "BILLING_WEBHOOK_DRIFT"
  | "BILLING_WEBHOOK_NO_RECENT_DELIVERY"
  | "BILLING_INGRESS_REJECTING"
  | "BILLING_RECONCILIATION_STALLED"
  | "BILLING_SCHEMA_OUTDATED"
  | "BILLING_RUNTIME_FAILED";

export type AthenaDevtoolsBillingHealthTone =
  | "healthy"
  | "degraded"
  | "failed"
  | "unknown";

export type AthenaDevtoolsBillingCapabilityInspector = {
  available: boolean;
  operation: string;
  reason?: string;
};

export type AthenaDevtoolsBillingConnectionInspector = {
  accountReference: string;
  authority: {
    liveAllowed: boolean;
    scopeKind: string | null;
    testAllowed: boolean;
  };
  capabilities: AthenaDevtoolsBillingCapabilityInspector[];
  credential: {
    configured: AthenaDevtoolsRedactedFact;
    kind: string | null;
    secret: AthenaDevtoolsRedactedFact;
  };
  credentialReference: string;
  environment: "test" | "live";
  id: string | null;
  provider: string;
  providerAccountId: string | null;
  providerProfileId: string | null;
  source: "application_config" | "materialized";
  status: "configured" | "active" | "pending" | "failed";
  webhookUrlTemplates?: {
    classic: string;
    events: string;
  };
};

export type AthenaDevtoolsBillingSubjectBindingInspector = {
  bindingId: string | null;
  connectionId: string | null;
  provider: string | null;
  providerSubjectId: string | null;
  providerSubjectKind: string | null;
  source: string | null;
  status: string | null;
  subjectId: string;
  subjectKind: "user" | "organization" | "unknown";
};

export type AthenaDevtoolsBillingIdentityConflict = {
  code: AthenaDevtoolsBillingDiagnosticCode;
  detail: string;
  subjectId?: string;
};

export type AthenaDevtoolsBillingIdentityRoute = {
  binding?: {
    id: string;
    source: string;
    status: string;
  };
  connection?: {
    id: string;
    provider: string;
  };
  diagnostics: readonly string[];
  providerSubject?: {
    id: string;
    kind: string;
  };
  resolution: "bound" | "unbound" | "ambiguous" | "conflict";
  subject: {
    id: string;
    kind: "user";
  };
};

export type AthenaDevtoolsBillingPaymentInspector = {
  amount: string | null;
  checkoutId: string | null;
  connectionId: string | null;
  createdAt: string | null;
  currency: string | null;
  customerId: string | null;
  id: string;
  provider: string | null;
  providerPaymentId: string | null;
  reconciliationStatus: string | null;
  status: string | null;
  subjectId: string | null;
  traceId: string | null;
  updatedAt: string | null;
};

export type AthenaDevtoolsBillingSubscriptionInspector = {
  cancelAt: string | null;
  cancelledAt: string | null;
  connectionId: string | null;
  customerId: string | null;
  id: string;
  latestInvoiceId: string | null;
  latestPaymentId: string | null;
  nextBillingAt: string | null;
  priceId: string | null;
  productId: string | null;
  provider: string | null;
  providerSubscriptionId: string | null;
  startAt: string | null;
  status: string | null;
  subjectId: string | null;
};

export type AthenaDevtoolsBillingInvoiceInspector = {
  amount: string | null;
  canonicalId: string;
  connectionId: string | null;
  provider: string | null;
  providerInvoiceId: string | null;
  reconciliationStatus: string | null;
  status: string | null;
  subjectId: string | null;
};

export type AthenaDevtoolsBillingCheckoutInspector = {
  connectionId: string | null;
  customerId: string | null;
  finality: string | null;
  id: string;
  providerPaymentId: string | null;
  resultingSubscriptionId: string | null;
  status: string | null;
  subjectId: string | null;
};

export type AthenaDevtoolsBillingWebhookDesiredInspector = {
  classicEnabled: boolean;
  connectionId: string | null;
  nextGenEnabled: boolean;
  publicUrl: string | null;
};

export type AthenaDevtoolsBillingWebhookProviderInspector = {
  providerWebhookId: string | null;
  registration: "unknown" | "active" | "missing" | "drift";
  status: string | null;
  target: string | null;
};

export type AthenaDevtoolsBillingWebhookIngressInspector = {
  bindingToken: AthenaDevtoolsRedactedFact;
  duplicateCount: number | null;
  lastReceivedAt: string | null;
  lastRejectedAt: string | null;
  lastVerifiedAt: string | null;
  signingSecret: AthenaDevtoolsRedactedFact;
};

export type AthenaDevtoolsBillingWebhookInspector = {
  desired: AthenaDevtoolsBillingWebhookDesiredInspector;
  ingress: AthenaDevtoolsBillingWebhookIngressInspector;
  provider: AthenaDevtoolsBillingWebhookProviderInspector;
};

export type AthenaDevtoolsBillingIngressStageInspector = {
  code?: string;
  connectionId?: string;
  correlationId?: string;
  durationMs?: number;
  occurredAt: string | null;
  stage: string;
  status: "ok" | "failed" | "skipped" | "unknown";
  traceId?: string;
};

export type AthenaDevtoolsBillingIngressInspector = {
  duplicate: number | null;
  normalized: number | null;
  received: number | null;
  reconciled: number | null;
  rejected: number | null;
  stages: AthenaDevtoolsBillingIngressStageInspector[];
  verified: number | null;
};

export type AthenaDevtoolsBillingReconciliationInspector = {
  checkpoints: readonly string[];
  conflicts: number | null;
  failedDocuments: number | null;
  lastRunAt: string | null;
  providerLatencyMs: number | null;
  retries: number | null;
  runs: number | null;
};

export type AthenaDevtoolsBillingHealthFinding = {
  code: AthenaDevtoolsBillingDiagnosticCode;
  detail: string;
  tone: AthenaDevtoolsBillingHealthTone;
};

export type AthenaDevtoolsBillingHealthInspector = {
  canonicalIdentities: AthenaDevtoolsBillingHealthTone;
  connectionMaterialized: AthenaDevtoolsBillingHealthTone;
  credentials: AthenaDevtoolsBillingHealthTone;
  findings: AthenaDevtoolsBillingHealthFinding[];
  ingress: AthenaDevtoolsBillingHealthTone;
  migrations: AthenaDevtoolsBillingHealthTone;
  provider: AthenaDevtoolsBillingHealthTone;
  reconciliation: AthenaDevtoolsBillingHealthTone;
  runtime: AthenaDevtoolsBillingHealthTone;
  scheduler: AthenaDevtoolsBillingHealthTone;
  webhookRegistration: AthenaDevtoolsBillingHealthTone;
};

export type AthenaDevtoolsBillingInspector = {
  capabilities: AthenaDevtoolsBillingCapabilityInspector[];
  checkouts: AthenaDevtoolsBillingCheckoutInspector[];
  connections: AthenaDevtoolsBillingConnectionInspector[];
  health: AthenaDevtoolsBillingHealthInspector;
  ingress: AthenaDevtoolsBillingIngressInspector;
  invoices: AthenaDevtoolsBillingInvoiceInspector[];
  payments: AthenaDevtoolsBillingPaymentInspector[];
  reconciliation: AthenaDevtoolsBillingReconciliationInspector;
  runtime: {
    bootstrapEvents: readonly string[];
    environment: "test" | "live";
    failureCode?: string;
    initialized: boolean;
    mode: "local" | "remote";
    phase: AthenaDevtoolsBillingRuntimePhase;
    provider: string | null;
  };
  status: AthenaDevtoolsBillingInspectorStatus;
  subjects: {
    bindings: AthenaDevtoolsBillingSubjectBindingInspector[];
    conflicts: AthenaDevtoolsBillingIdentityConflict[];
    routes: AthenaDevtoolsBillingIdentityRoute[];
  };
  subscriptions: AthenaDevtoolsBillingSubscriptionInspector[];
  webhooks: AthenaDevtoolsBillingWebhookInspector;
};

export type AthenaDevtoolsBillingEventTimings = {
  checkpointMs?: number;
  projectionMs?: number;
  providerMs?: number;
  resolveMs?: number;
  resourceId?: string;
  resourceKind?: string;
  providerResourceId?: string;
  transactionMs?: number;
};
