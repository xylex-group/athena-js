import type { AthenaPrincipal } from "../../../runtime/data/principal.ts";
import { AthenaBillingCapabilityError } from "../../errors.ts";
import type { BillingProviderConfigMap } from "../../providers/types.ts";
import { billingSubjectNotFound } from "../../subject/errors.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import type { BillingSubscription } from "../../types.ts";
import { PROCESS_BILLING_INVOCATION } from "../invocation-authority.ts";
import { executeLocalBillingSubscriptionCancel } from "../local/execute/subscriptions.ts";
import type { BillingProviderRegistry } from "../local/providers/registry.ts";
import { selfDelegatedBillingPrincipal } from "./delegated-principal.ts";

const GET_OWNED_SUBSCRIPTION_SQL = `
SELECT *
FROM billing.billing_subscriptions
WHERE ($1::uuid IS NULL OR id = $1)
  AND subject_kind = $2
  AND subject_id = $3
  AND ownership_status = 'resolved'
ORDER BY ingested_at DESC
LIMIT 1
`;

const CANCEL_OWNED_SUBSCRIPTION_SQL = `
UPDATE billing.billing_subscriptions
SET status = 'canceled',
    canceled_at = now()
WHERE id = $1
  AND subject_kind = $2
  AND subject_id = $3
  AND ownership_status = 'resolved'
RETURNING *
`;

function asSubscription(row: Record<string, unknown>): BillingSubscription {
  return {
    id: String(row.id ?? ""),
    metadata: row.metadata ?? {},
    provider: row.provider === "stripe" ? "stripe" : "mollie",
    providerCustomerId: String(row.provider_customer_id ?? ""),
    providerSubscriptionId: String(row.provider_subscription_id ?? ""),
    raw: row.raw ?? {},
    status: String(row.status ?? "active"),
  } as BillingSubscription;
}

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function optionalCanonicalUuid(value: string | undefined): string | null {
  if (value == null || value.trim() === "") {
    return null;
  }
  if (!CANONICAL_UUID.test(value.trim())) {
    throw billingSubjectNotFound();
  }
  return value.trim();
}

export async function getSelfSubscription(input: {
  principal: AthenaPrincipal;
  sql: BillingSqlExecutor;
  subscriptionId?: string;
}): Promise<BillingSubscription> {
  const subscriptionId = optionalCanonicalUuid(input.subscriptionId);
  const result = await input.sql.query(GET_OWNED_SUBSCRIPTION_SQL, [
    subscriptionId,
    "user",
    input.principal.userId,
  ]);
  const row = result.rows[0];
  if (!row) {
    throw billingSubjectNotFound();
  }
  return asSubscription(row);
}

export async function cancelSelfSubscription(input: {
  configuredProviders?: BillingProviderConfigMap;
  principal: AthenaPrincipal;
  registry?: BillingProviderRegistry;
  sql: BillingSqlExecutor;
  subscriptionId: string;
  testMode?: boolean;
}): Promise<BillingSubscription> {
  const owned = await input.sql.query(GET_OWNED_SUBSCRIPTION_SQL, [
    input.subscriptionId,
    "user",
    input.principal.userId,
  ]);
  const ownedRow = owned.rows[0];
  if (!ownedRow) {
    throw billingSubjectNotFound();
  }
  if (input.registry == null) {
    throw new AthenaBillingCapabilityError({
      operation: "self.subscription.cancel",
      reason: "runtime_unavailable",
    });
  }
  const ownedSubscription = asSubscription(ownedRow);
  await executeLocalBillingSubscriptionCancel({
    authority: PROCESS_BILLING_INVOCATION,
    configuredProviders: input.configuredProviders,
    payload: {
      customerId: ownedSubscription.providerCustomerId,
      subscriptionId: ownedSubscription.providerSubscriptionId,
    },
    principal: selfDelegatedBillingPrincipal(input.principal, [
      "subscriptions.cancel",
    ]),
    registry: input.registry,
    testMode: input.testMode,
  });
  const result = await input.sql.query(CANCEL_OWNED_SUBSCRIPTION_SQL, [
    input.subscriptionId,
    "user",
    input.principal.userId,
  ]);
  const row = result.rows[0];
  if (!row) {
    throw billingSubjectNotFound();
  }
  return asSubscription(row);
}
