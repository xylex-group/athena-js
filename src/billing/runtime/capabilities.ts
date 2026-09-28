import { AthenaBillingCapabilityError } from "../errors.ts";
import type { BillingProviderName, BillingRuntimeMode } from "../types.ts";

export type BillingPortName =
  | "payments"
  | "customers"
  | "refunds"
  | "paymentLinks"
  | "subscriptions"
  | "invoices"
  | "webhooks"
  | "products"
  | "prices"
  | "relations"
  | "checkout"
  | "self";

export type BillingAdminOperation =
  | "admin.connections.materialize"
  | "admin.bootstrap.retry"
  | "admin.reconciliation.run"
  | "admin.reconciliation.retry"
  | "admin.webhooks.reconcile"
  | "admin.webhooks.verify"
  | "admin.webhooks.status"
  | "admin.ingestion.health"
  | "admin.conflicts.resolve"
  | "admin.conflicts.list";

export type BillingOperation =
  | "payments.list"
  | "payments.create"
  | "payments.get"
  | "payments.cancel"
  | "customers.list"
  | "customers.create"
  | "customers.get"
  | "customers.update"
  | "customers.delete"
  | "refunds.list"
  | "refunds.create"
  | "refunds.get"
  | "refunds.cancel"
  | "paymentLinks.list"
  | "paymentLinks.create"
  | "paymentLinks.get"
  | "paymentLinks.update"
  | "paymentLinks.delete"
  | "subscriptions.list"
  | "subscriptions.create"
  | "subscriptions.get"
  | "subscriptions.update"
  | "subscriptions.cancel"
  | "invoices.list"
  | "invoices.get"
  | "webhooks.list"
  | "webhooks.create"
  | "webhooks.get"
  | "webhooks.update"
  | "webhooks.delete"
  | "webhooks.test"
  | "products.list"
  | "prices.list"
  | "relations.list"
  | "checkout.create"
  | "self.invoices.list"
  | "self.invoices.get"
  | "self.payments.list"
  | "self.payments.get"
  | "self.subscription.get"
  | "self.subscription.cancel"
  | "self.subscription.enroll"
  | "self.subscription.change"
  | "self.checkout.create"
  | "self.checkout.resume"
  | "self.customer.get"
  | "self.entitlements"
  | BillingAdminOperation;

export type BillingOperationCapabilityReason =
  | "unsupported_provider"
  | "unsupported_operation"
  | "unsupported_by_provider"
  | "missing_catalog"
  | "missing_connection"
  | "missing_permission"
  | "missing_provider_scope"
  | "credential_scope_insufficient"
  | "connection_disabled"
  | "profile_target_missing"
  | "provider_runtime_unavailable"
  | "configuration_invalid"
  | "runtime_initializing"
  | "runtime_unavailable"
  | "bootstrap_failed"
  | "provider_not_configured"
  | "provider_connection_missing"
  | "provider_connection_ambiguous"
  | "provider_operation_unsupported"
  | "missing_credential"
  | "operator_only"
  | "self_enrollment_disabled";

export type BillingOperationSafety = "disabled" | "preview" | "stable";

/**
 * Per-operation snapshot from `billing.getCapabilities`. `available` is
 * provider/runtime support. Optional `safety` is workflow exposure:
 * `stable`, `preview`, or `disabled`. Plan change is `stable` only when
 * durable recovery is ready. Older snapshots may omit `safety`.
 */
export interface BillingOperationCapability {
  actualAuthority?: "organization" | "profile";
  authorized?: boolean;
  available: boolean;
  connectionId?: string;
  effectiveAvailable?: boolean;
  missingRights?: readonly string[];
  operation?: BillingOperation;
  provider?: string;
  providerSupported?: boolean;
  reason?: BillingOperationCapabilityReason;
  remediation?: string;
  requiredAuthority?: "organization" | "profile";
  runtimeAvailable?: boolean;
  /**
   * Workflow guarantee, distinct from provider/runtime availability.
   * `stable` is production-ready, `preview` is not finality-complete,
   * `disabled` must stay hidden. Omitted on older snapshots.
   */
  safety?: BillingOperationSafety;
  unavailableReason?: BillingOperationCapabilityReason;
}

export interface BillingCapabilityTarget {
  connectionId?: string;
  kind: "configured" | "connection";
  provider: BillingProviderName;
}

/**
 * Snapshot from `billing.getCapabilities`. Operation rows may include
 * optional `safety` (`stable` / `preview` / `disabled`).
 */
export interface BillingCapabilities {
  authority?: {
    source: "derived" | "declared" | "provider";
    modes: {
      test: boolean;
      live: boolean;
    };
    scope?: {
      kind: "organization" | "profile";
      profileId?: string;
    };
    permissions?: Record<string, boolean>;
  };
  /**
   * True when Athena has a unique usable provider connection for this
   * target. Session probes honor owned resources and subject bindings
   * (not filtered by application `owner_*`). Configured fallback is
   * tenant-owned by application id. Credential presence alone is
   * `credentials.configured`. `connectionId` is set only when connected.
   */
  connected: boolean;
  connectionId?: string;
  credentials?: {
    configured: boolean;
    selectedEnvironment?: "test" | "live";
    availableEnvironments?: Array<"test" | "live">;
    credentialKind?: string;
  };
  diagnostics?: {
    attentionRequiredOperations?: number;
    billingSchemaReady?: boolean;
    connectionSource?: string;
    connectionAffinitySource?: string;
    eligibleConnectionCount?: number;
    ingressAdmissionControl?: "disabled" | "enabled" | "unknown";
    initializationFailed?: boolean;
    initializationMessage?: string;
    lastRecoveryBatch?: {
      attentionRequired: number;
      completed: number;
      failed: number;
      retried: number;
      scanned: number;
    };
    planChangeConfigured?: boolean;
    planChangeSafety?: BillingOperationSafety;
    providerRegistrationSource?: string;
    recoveryCoordinatorEnabled?: boolean;
    recoverableOperationBacklog?: number;
    runtimeSource?: string;
    selectedConnectionId?: string | null;
    unfinishedRecoverableOperations?: number;
    verifiedBillingContact?: "available" | "unavailable" | "unknown";
    webhookIngressUrlTemplates?: readonly {
      classic: string;
      connectionId: string;
      events: string;
    }[];
    webhookSecretLifecycle?: "degraded" | "healthy" | "unknown";
  };
  environment?: "test" | "live";
  initialized?: boolean;
  operations: Partial<Record<BillingOperation, BillingOperationCapability>>;
  ports: {
    customers: boolean;
    invoices: boolean;
    paymentLinks: boolean;
    payments: boolean;
    refunds: boolean;
    subscriptions: boolean;
    webhooks: boolean;
    products: boolean;
    prices: boolean;
    relations: boolean;
    checkout: boolean;
    self: boolean;
  };
  provider: string;
  runtime: BillingRuntimeMode;
  target: BillingCapabilityTarget;
  testMode?: boolean;
}

/**
 * Fail-closed: a method existing on AthenaBillingModule does not mean the
 * resolved runtime/provider supports it. Never route an unsupported local
 * operation to remote HTTP.
 */
export function assertBillingOperationAvailable(
  capabilities: BillingCapabilities,
  operation: BillingOperation
): void {
  const capability = capabilities.operations[operation];
  if (capability?.available === true) {
    return;
  }
  throw new AthenaBillingCapabilityError({
    operation,
    reason: capability?.reason ?? "unsupported_operation",
  });
}
