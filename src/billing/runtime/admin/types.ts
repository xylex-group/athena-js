import type { BillingImportRunReport } from "../../import/types.ts";
import type { BillingWebhookOperatorHealth } from "../../ingestion/observability/health.ts";
import type { BillingWebhookOperationalStatus } from "../../ingestion/observability/operational-status.ts";
import type { BillingWebhookReconciliationPlan } from "../../ingestion/reconciliation/types.ts";
import type { BillingConnectionIngestionHealth } from "../../ingestion/types.ts";
import type { BillingSubjectRef } from "../../types.ts";

export interface BillingAdminConnectionInput {
  connectionId?: string;
  provider?: string;
}

export interface BillingAdminReconciliationRunInput
  extends BillingAdminConnectionInput {
  dryRun?: boolean;
}

export interface BillingAdminReconciliationRetryInput {
  runId: string;
}

export interface BillingAdminWebhookReconcileInput
  extends BillingAdminConnectionInput {
  dryRun?: boolean;
}

export interface BillingAdminConflictListItem {
  candidateProviderCustomerId: string;
  confidence: string;
  connectionId: string;
  id: string;
  lastObservedAt?: string;
  observationCount?: number;
  reason: string;
  status: string;
  subjectId?: string;
  subjectKind?: string;
}

export interface BillingAdminConflictListResult {
  items: readonly BillingAdminConflictListItem[];
}

export type BillingAdminConflictAction = "bind" | "keep" | "reassign";

export interface BillingAdminConflictResolveInput {
  action: BillingAdminConflictAction;
  confirmReassign?: boolean;
  connectionId: string;
  providerCustomerId: string;
  subject?: BillingSubjectRef;
}

export interface BillingWebhookDesiredActualRow {
  actual: string | number | boolean | null;
  desired: string | number | boolean | null;
  key: string;
}

export interface BillingAdminWebhookStatus {
  channels: {
    classic: BillingWebhookOperationalStatus;
    nextGen: BillingWebhookOperationalStatus;
  };
  classic: BillingConnectionIngestionHealth["classic"];
  configSource: "application_configuration";
  connectionId: string;
  delivery: BillingWebhookOperatorHealth;
  drift: boolean;
  environment: "test" | "live";
  management: "automatic" | "manual";
  nextGen: BillingConnectionIngestionHealth["nextGen"];
  provider: string;
  rows: readonly BillingWebhookDesiredActualRow[];
  secret: {
    configured: boolean;
    fingerprint?: string;
    version?: number;
  };
  strategy: "hybrid" | "classic" | "next_gen";
  traceId?: string;
}

export interface BillingAdminIngestionHealth {
  classic: BillingConnectionIngestionHealth["classic"];
  conflicts: number;
  connectionId?: string;
  connectionStatus: string;
  drift: boolean;
  enabled: boolean;
  healthy: boolean;
  lastDeliveryAt?: string;
  lastFailureAt?: string;
  lastIngressAt?: string;
  lastReconcileAt?: string;
  lastSuccessfulIngressAt?: string;
  lastVerifiedAt?: string;
  nextGen: BillingConnectionIngestionHealth["nextGen"];
  provider: string;
  recent?: {
    accepted: number;
    duplicates: number;
    received: number;
    reconciliationFailures: number;
    rejected: number;
    window: "1h" | "24h";
  };
  reconciliation: "caught_up" | "behind" | "unknown";
  routes?: {
    classic: { expected: string; mounted: true | false | "unknown" };
    nextGen: { expected: string; mounted: true | false | "unknown" };
  };
  warnings: readonly string[];
  webhookIngestion: BillingConnectionIngestionHealth["classic"] | "degraded";
}

export interface BillingAdminConflictResolveResult {
  action: BillingAdminConflictAction;
  bindingId?: string;
  traceId: string;
}

export interface BillingAdminMaterializedConnection {
  accountReference: string;
  classicWebhookUrl?: string;
  credentialReference: string;
  eventsWebhookUrl?: string;
  id: string;
  provider: string;
}

export interface BillingAdminConnectionMaterializeResult {
  connections: readonly BillingAdminMaterializedConnection[];
}

export interface BillingAdminBootstrapRetryResult
  extends BillingAdminConnectionMaterializeResult {
  generation: number;
  phase: "ready";
  recoveredAt: string;
}

export interface BillingAdminPort {
  readonly bootstrap: {
    retry(): Promise<BillingAdminBootstrapRetryResult>;
  };
  readonly conflicts: {
    list(
      input?: BillingAdminConnectionInput
    ): Promise<BillingAdminConflictListResult>;
    resolve(
      input: BillingAdminConflictResolveInput
    ): Promise<BillingAdminConflictResolveResult>;
  };
  readonly connections: {
    materialize: (
      input?: BillingAdminConnectionInput
    ) => Promise<BillingAdminConnectionMaterializeResult>;
  };
  readonly ingestion: {
    health(
      input?: BillingAdminConnectionInput
    ): Promise<BillingAdminIngestionHealth>;
  };
  readonly reconciliation: {
    retry(
      input: BillingAdminReconciliationRetryInput
    ): Promise<BillingImportRunReport>;
    run(
      input: BillingAdminReconciliationRunInput
    ): Promise<BillingImportRunReport>;
  };
  readonly webhooks: {
    reconcile(input: BillingAdminWebhookReconcileInput): Promise<{
      foreignUntouched: number;
      plans: readonly BillingWebhookReconciliationPlan[];
      traceId: string;
    }>;
    status(
      input?: BillingAdminConnectionInput
    ): Promise<BillingAdminWebhookStatus>;
    verify(
      input?: BillingAdminConnectionInput
    ): Promise<BillingAdminWebhookStatus>;
  };
}
