export type BillingImportRunStatus =
  | "cancelled"
  | "checkpointed"
  | "completed"
  | "completed_with_conflicts"
  | "failed"
  | "queued"
  | "running";

export type BillingReconciliationFailureKind =
  | "cursor_invalid"
  | "database_unavailable"
  | "internal"
  | "lease_lost"
  | "provider_auth_failed"
  | "provider_rate_limited"
  | "provider_unavailable";

export interface BillingReconciliationLimits {
  maxCustomers: number;
  maxDurationMs: number;
  maxPages: number;
  pageSize: number;
}

export const DEFAULT_BILLING_RECONCILIATION_LIMITS: BillingReconciliationLimits =
  {
    maxCustomers: 5000,
    maxDurationMs: 120_000,
    maxPages: 100,
    pageSize: 100,
  };

export interface ResolvedBillingProviderConnection {
  accountReference: string;
  credentialReference: string;
  environment: "live" | "test";
  id: string;
  provider: string;
  status: string;
  testMode: boolean;
  webhookIngressToken?: string;
}

export interface BillingImportPageResult {
  bindingsActivated: number;
  bindingsCreated: number;
  conflicts: number;
  cursorAfter: string | null;
  cursorBefore: string | null;
  customersScanned: number;
  hasMore: boolean;
  plans: readonly import("../import/types.ts").BillingImportPlan[];
  skipped: number;
}

export interface BillingReconciliationRunResult {
  bindingsActivated: number;
  bindingsCreated: number;
  conflicts: number;
  connectionId: string;
  correlationId: string;
  cursorAfter: string | null;
  cursorBefore: string | null;
  customersScanned: number;
  dryRun: boolean;
  environment: "live" | "test";
  errors: number;
  hasMore: boolean;
  pagesProcessed: number;
  plans: readonly import("../import/types.ts").BillingImportPlan[];
  provider: string;
  runId?: string;
  skipped: number;
  status: BillingImportRunStatus | "dry_run";
  traceId: string;
}

export interface BillingBackoffDecision {
  delayMs: number;
  kind: BillingReconciliationFailureKind;
  retry: boolean;
}
