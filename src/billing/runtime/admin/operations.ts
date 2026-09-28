import type { BillingAdminOperation } from "../capabilities.ts";

export type AdminBillingOperation = BillingAdminOperation;

export const ADMIN_BILLING_OPERATIONS = [
  "admin.connections.materialize",
  "admin.bootstrap.retry",
  "admin.reconciliation.run",
  "admin.reconciliation.retry",
  "admin.webhooks.reconcile",
  "admin.webhooks.verify",
  "admin.webhooks.status",
  "admin.ingestion.health",
  "admin.conflicts.resolve",
  "admin.conflicts.list",
] as const satisfies readonly AdminBillingOperation[];

export const ADMIN_OP = {
  conflictsList: "admin.conflicts.list",
  conflictsResolve: "admin.conflicts.resolve",
  connectionsMaterialize: "admin.connections.materialize",
  bootstrapRetry: "admin.bootstrap.retry",
  ingestionHealth: "admin.ingestion.health",
  reconciliationRetry: "admin.reconciliation.retry",
  reconciliationRun: "admin.reconciliation.run",
  webhooksReconcile: "admin.webhooks.reconcile",
  webhooksStatus: "admin.webhooks.status",
  webhooksVerify: "admin.webhooks.verify",
} as const satisfies Record<string, AdminBillingOperation>;

export function isAdminBillingOperation(
  operation: string
): operation is AdminBillingOperation {
  return (ADMIN_BILLING_OPERATIONS as readonly string[]).includes(operation);
}
