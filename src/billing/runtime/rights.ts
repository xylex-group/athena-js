import { type AthenaRightKey, parseAthenaRightKey } from "../../rights/key.ts";
import { missingRequiredRights } from "../../rights/matching.ts";
import { recordAthenaAuthorizationDecisionFromPrincipal } from "../../runtime/authorization/decisions.ts";
import type { AthenaPrincipal } from "../../runtime/data/principal.ts";
import { AthenaBillingAuthorizationError } from "../errors.ts";
import type {
  BillingCapabilities,
  BillingOperation,
  BillingOperationCapability,
} from "./capabilities.ts";
import type { BillingInvocationAuthority } from "./invocation-authority.ts";
import {
  isProcessBillingInvocation,
  SESSION_BILLING_INVOCATION,
} from "./invocation-authority.ts";
import {
  billingOperationPolicy,
  isSessionSubjectBillingOperation,
  listBillingOperationPolicies,
} from "./operation-policy.ts";

const CATALOG_READ = parseAthenaRightKey("billing.catalog.read");
const PAYMENTS_READ = parseAthenaRightKey("billing.payments.read");
const PAYMENTS_WRITE = parseAthenaRightKey("billing.payments.write");
const CUSTOMERS_READ = parseAthenaRightKey("billing.customers.read");
const CUSTOMERS_WRITE = parseAthenaRightKey("billing.customers.write");
const REFUNDS_READ = parseAthenaRightKey("billing.refunds.read");
const REFUNDS_WRITE = parseAthenaRightKey("billing.refunds.write");
const SUBSCRIPTIONS_READ = parseAthenaRightKey("billing.subscriptions.read");
const SUBSCRIPTIONS_WRITE = parseAthenaRightKey("billing.subscriptions.write");
const PAYMENT_LINKS_READ = parseAthenaRightKey("billing.payment-links.read");
const PAYMENT_LINKS_WRITE = parseAthenaRightKey("billing.payment-links.write");
const SALES_INVOICES_READ = parseAthenaRightKey("billing.sales-invoices.read");
const WEBHOOKS_READ = parseAthenaRightKey("billing.webhooks.read");
const WEBHOOKS_WRITE = parseAthenaRightKey("billing.webhooks.write");
const SELF_INVOICES_READ = parseAthenaRightKey("billing.self.invoices.read");
const SELF_PAYMENTS_READ = parseAthenaRightKey("billing.self.payments.read");
const SELF_SUBSCRIPTION_READ = parseAthenaRightKey(
  "billing.self.subscription.read"
);
const SELF_SUBSCRIPTION_WRITE = parseAthenaRightKey(
  "billing.self.subscription.write"
);
const SELF_CHECKOUT_WRITE = parseAthenaRightKey("billing.self.checkout.write");
const ADMIN_RECONCILIATION_WRITE = parseAthenaRightKey(
  "billing.admin.reconciliation.write"
);
const ADMIN_WEBHOOKS_READ = parseAthenaRightKey("billing.admin.webhooks.read");
const ADMIN_WEBHOOKS_WRITE = parseAthenaRightKey(
  "billing.admin.webhooks.write"
);
const ADMIN_INGESTION_READ = parseAthenaRightKey(
  "billing.admin.ingestion.read"
);
const ADMIN_CONFLICTS_WRITE = parseAthenaRightKey(
  "billing.admin.conflicts.write"
);

/** Process-owned overlay Rights — dialect execute keys, not grant-catalog. */
export const BILLING_DIALECT_RIGHTS: readonly AthenaRightKey[] = Object.freeze([
  CATALOG_READ,
  PAYMENTS_READ,
  PAYMENTS_WRITE,
  CUSTOMERS_READ,
  CUSTOMERS_WRITE,
  REFUNDS_READ,
  REFUNDS_WRITE,
  SUBSCRIPTIONS_READ,
  SUBSCRIPTIONS_WRITE,
  PAYMENT_LINKS_READ,
  PAYMENT_LINKS_WRITE,
  SALES_INVOICES_READ,
  WEBHOOKS_READ,
  WEBHOOKS_WRITE,
  SELF_INVOICES_READ,
  SELF_PAYMENTS_READ,
  SELF_SUBSCRIPTION_READ,
  SELF_SUBSCRIPTION_WRITE,
  SELF_CHECKOUT_WRITE,
  ADMIN_RECONCILIATION_WRITE,
  ADMIN_WEBHOOKS_READ,
  ADMIN_WEBHOOKS_WRITE,
  ADMIN_INGESTION_READ,
  ADMIN_CONFLICTS_WRITE,
]);

/** In-process dialect Rights bag. Not an HTTP identity and not detected by userId. */
export const PROCESS_OWNED_BILLING_PRINCIPAL: AthenaPrincipal = {
  authenticated: true,
  grants: [],
  rights: BILLING_DIALECT_RIGHTS,
  userId: "athena.billing.process",
};

export const BILLING_OPERATION_RIGHTS: Record<
  BillingOperation,
  readonly AthenaRightKey[]
> = Object.fromEntries(
  listBillingOperationPolicies().map((entry) => [
    entry.operation,
    entry.requiredRights,
  ])
) as Record<BillingOperation, readonly AthenaRightKey[]>;

export function isProcessOwnedBillingPrincipal(
  principal: AthenaPrincipal
): boolean {
  return principal === PROCESS_OWNED_BILLING_PRINCIPAL;
}

export function requiredBillingRights(
  operation: BillingOperation
): readonly AthenaRightKey[] {
  return BILLING_OPERATION_RIGHTS[operation];
}

/**
 * Rights gate for local Billing. Grants are never consulted.
 * Returns a deny error, or undefined when the principal holds the Rights.
 */
export function authorizeBillingOperation(
  principal: AthenaPrincipal,
  operation: BillingOperation
): AthenaBillingAuthorizationError | undefined {
  const required = requiredBillingRights(operation);
  const missing = missingRequiredRights(principal.rights, required);
  recordAthenaAuthorizationDecisionFromPrincipal({
    domain: "billing",
    operation,
    principal,
    required,
    resource: "billing",
  });
  if (missing.length === 0) {
    return;
  }
  return new AthenaBillingAuthorizationError({
    missing,
    operation,
  });
}

/**
 * Session principals cannot run merchant-wide Billing. Process invocation
 * authority is the operator path — never a forgeable principal userId.
 */
export function authorizeBillingSubjectBinding(
  principal: AthenaPrincipal,
  operation: BillingOperation | string,
  authority: BillingInvocationAuthority = SESSION_BILLING_INVOCATION
): AthenaBillingAuthorizationError | undefined {
  void principal;
  if (isProcessBillingInvocation(authority)) {
    return;
  }
  if (
    typeof operation === "string" &&
    isSessionSubjectBillingOperation(operation as BillingOperation)
  ) {
    return;
  }
  if (typeof operation === "string" && operation.startsWith("self.")) {
    return;
  }
  return new AthenaBillingAuthorizationError({
    missing: [],
    operation,
  });
}

function sessionMerchantWrite(operation: BillingOperation): boolean {
  const policy = billingOperationPolicy(operation);
  return (
    policy.subjectScope !== "self" &&
    policy.requiredRights.some((right) => !right.endsWith(".read"))
  );
}

export function denyBillingInvocation(
  principal: AthenaPrincipal,
  operation: BillingOperation,
  authority: BillingInvocationAuthority = SESSION_BILLING_INVOCATION
): AthenaBillingAuthorizationError | undefined {
  const rightsDenied = authorizeBillingOperation(principal, operation);
  if (isProcessBillingInvocation(authority) || !sessionMerchantWrite(operation)) {
    return rightsDenied;
  }
  return (
    rightsDenied ??
    authorizeBillingSubjectBinding(principal, operation, authority)
  );
}

const RUNTIME_UNAVAILABLE_REASONS = new Set<
  NonNullable<BillingOperationCapability["reason"]>
>([
  "runtime_unavailable",
  "runtime_initializing",
  "bootstrap_failed",
  "provider_runtime_unavailable",
  "provider_not_configured",
  "configuration_invalid",
]);

const PROVIDER_UNSUPPORTED_REASONS = new Set<
  NonNullable<BillingOperationCapability["reason"]>
>([
  "unsupported_provider",
  "unsupported_operation",
  "unsupported_by_provider",
  "provider_operation_unsupported",
]);

function overlayBillingOperationCapability(input: {
  capability: BillingOperationCapability;
  operation: BillingOperation;
  principal: AthenaPrincipal;
}): BillingOperationCapability {
  const policy = billingOperationPolicy(input.operation);
  const missing = missingRequiredRights(
    input.principal.rights,
    policy.requiredRights
  );
  const authorized = missing.length === 0;
  const runtimeReason = input.capability.reason;
  const runtimeAvailable =
    input.capability.available === true ||
    (runtimeReason != null && !RUNTIME_UNAVAILABLE_REASONS.has(runtimeReason));
  const providerSupported =
    input.capability.available === true ||
    (runtimeReason != null && !PROVIDER_UNSUPPORTED_REASONS.has(runtimeReason));
  const available = input.capability.available === true;
  const effectiveAvailable = authorized && available;
  const unavailableReason = authorized
    ? runtimeReason
    : ("missing_permission" as const);
  return {
    ...input.capability,
    authorized,
    available,
    effectiveAvailable,
    missingRights: missing.map(String),
    providerSupported,
    reason: available ? undefined : runtimeReason,
    runtimeAvailable,
    unavailableReason,
  };
}

export function overlayCallerBillingCapabilities(
  capabilities: BillingCapabilities,
  principal: AthenaPrincipal
): BillingCapabilities {
  const operations = { ...capabilities.operations };
  for (const [operation, capability] of Object.entries(operations) as [
    BillingOperation,
    BillingOperationCapability | undefined,
  ][]) {
    if (capability == null) {
      continue;
    }
    operations[operation] = overlayBillingOperationCapability({
      capability,
      operation,
      principal,
    });
  }
  return { ...capabilities, operations };
}

export function callerEffectiveBillingCapability(input: {
  authority?: BillingInvocationAuthority;
  capability: BillingOperationCapability;
  operation: BillingOperation;
  principal: AthenaPrincipal;
}): BillingOperationCapability {
  void input.authority;
  return overlayBillingOperationCapability(input);
}
