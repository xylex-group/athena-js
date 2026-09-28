import type { AthenaPrincipal } from "../../../runtime/data/principal.ts";
import {
  AthenaBillingCapabilityError,
  AthenaBillingError,
} from "../../errors.ts";
import type { BillingProviderConfigMap } from "../../providers/types.ts";
import { prepareBillingCommand } from "../../safety/prepare.ts";
import {
  type BillingSelfEnrollmentSetting,
  isBillingSelfEnrollmentEnabled,
} from "../../self-enrollment.ts";
import {
  billingConfiguredConnectionOwner,
  configuredProvidersForBillingConnection,
  resolveBillingConnectionAffinity,
} from "../../subject/connection-affinity.ts";
import { ensureActiveProviderCustomer } from "../../subject/ensure-provider-customer.ts";
import {
  billingSubjectConflict,
  billingSubscriptionAlreadyActive,
} from "../../subject/errors.ts";
import { requireBillingPrincipalUserId } from "../../subject/principal-user.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import type { BillingPrice, BillingSubscription } from "../../types.ts";
import { billingHalLinkHref } from "../hal-link-href.ts";
import { PROCESS_BILLING_INVOCATION } from "../invocation-authority.ts";
import { executeLocalBillingProductList } from "../local/execute/product-list.ts";
import { executeLocalBillingPriceList } from "../local/execute/price-list.ts";
import { executeLocalBillingSubscriptionCreate } from "../local/execute/subscriptions.ts";
import type { BillingProviderRegistry } from "../local/providers/registry.ts";
import type {
  BillingSelfSubscriptionEnrollmentStatus,
  BillingSelfSubscriptionEnrollResult,
} from "../types.ts";
import { resolveBillingCheckoutIntent } from "./checkout-intent.ts";
import { requireProviderPaymentFromCheckoutSnapshot } from "./checkout-payment.ts";
import {
  CHECKOUT_INTENT_HASH_METADATA_KEY,
  assertMatchingCheckoutIntent,
  hashCheckoutIntent,
} from "./checkout-intent-hash.ts";
import { freezeBillingPaymentPresentation } from "./checkout-presentation.ts";
import { selfDelegatedBillingPrincipal } from "./delegated-principal.ts";
import {
  markEnrollmentActive,
  recordEnrollmentJournal,
  reserveSubjectEnrollment,
  updateEnrollment,
} from "./enrollment-reservation.ts";
import {
  type BillingCheckoutSessionRecord,
  checkoutAttemptExpiresAtIso,
  getCheckoutSessionByIdempotency,
  insertCheckoutSession,
  insertCheckoutSessionLines,
  isCheckoutSessionResumeExpired,
  listUsableMandateSessions,
  updateCheckoutSession,
} from "./enrollment-session.ts";
import { resolveAllowedBillingRedirectUrl } from "./redirect-url.ts";
import {
  appendBillingReturnToken,
  createBillingReturnNonce,
} from "./return-token.ts";

const PERSIST_OWNED_SUBSCRIPTION_SQL = `
INSERT INTO billing.billing_subscriptions (
	connection_id,
	provider,
	provider_subscription_id,
	provider_customer_id,
	status,
	amount_currency,
	amount_value,
	interval,
	description,
	metadata,
	raw,
	subject_kind,
	subject_id,
	ownership_status
) VALUES (
	$1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, 'user', $12, 'resolved'
)
ON CONFLICT (connection_id, provider_subscription_id) WHERE connection_id IS NOT NULL DO UPDATE SET
	status = EXCLUDED.status,
	subject_kind = EXCLUDED.subject_kind,
	subject_id = EXCLUDED.subject_id,
	ownership_status = 'resolved',
	metadata = EXCLUDED.metadata,
	raw = EXCLUDED.raw
WHERE
	billing.billing_subscriptions.ownership_status IS DISTINCT FROM 'resolved'
	OR (
		billing.billing_subscriptions.subject_kind IS NOT DISTINCT FROM EXCLUDED.subject_kind
		AND billing.billing_subscriptions.subject_id IS NOT DISTINCT FROM EXCLUDED.subject_id
	)
RETURNING *
`;

const LIVE_SELF_SUBSCRIPTION_SQL = `
SELECT id
FROM billing.billing_subscriptions
WHERE subject_kind = $1
  AND subject_id = $2
  AND ownership_status = 'resolved'
  AND lower(status) NOT IN ('canceled', 'cancelled', 'expired', 'completed')
LIMIT 1
`;

function mollieInterval(interval: string): string {
  const trimmed = interval.trim();
  if (/^\d+\s+\S/.test(trimmed)) {
    return trimmed;
  }
  return `1 ${trimmed}`;
}

function sessionStatusToResult(
  status: BillingCheckoutSessionRecord["status"]
): BillingSelfSubscriptionEnrollmentStatus {
  if (status === "enrolled") {
    return "enrolled";
  }
  if (status === "first_payment_required") {
    return "first_payment_required";
  }
  if (
    status === "first_payment_failed" ||
    status === "first_payment_canceled" ||
    status === "late_paid" ||
    status === "refund_required"
  ) {
    return "failed";
  }
  return "pending";
}

function resultFromSession(
  session: BillingCheckoutSessionRecord,
  subscription?: BillingSubscription
): BillingSelfSubscriptionEnrollResult {
  return {
    checkoutUrl: session.checkoutUrl,
    enrollmentId: session.id,
    metadata: {
      ...session.metadata,
      priceId: session.priceId,
    },
    provider: session.provider,
    status: sessionStatusToResult(session.status),
    ...(subscription ? { subscription } : {}),
  };
}

export async function persistOwnedSubscription(input: {
  connectionId: string;
  interval: string;
  operation?: "self.subscription.change" | "self.subscription.enroll";
  principal: AthenaPrincipal;
  sql: BillingSqlExecutor;
  subscription: BillingSubscription;
}): Promise<BillingSubscription> {
  const operation = input.operation ?? "self.subscription.enroll";
  const connectionId = input.connectionId.trim();
  if (connectionId.length === 0) {
    throw new AthenaBillingCapabilityError({
      operation,
      reason: "provider_connection_missing",
    });
  }
  const result = await input.sql.query(PERSIST_OWNED_SUBSCRIPTION_SQL, [
    connectionId,
    input.subscription.provider,
    input.subscription.providerSubscriptionId,
    input.subscription.providerCustomerId,
    input.subscription.status,
    input.subscription.amount?.currency ?? null,
    input.subscription.amount?.value ?? null,
    input.interval,
    input.subscription.description ?? null,
    JSON.stringify(input.subscription.metadata ?? {}),
    JSON.stringify(input.subscription.raw ?? {}),
    requireBillingPrincipalUserId(input.principal),
  ]);
  const row = result.rows[0];
  if (!row) {
    throw billingSubjectConflict(
      "This provider subscription is already bound to another billing subject."
    );
  }
  return {
    ...input.subscription,
    id: String(row.id ?? input.subscription.id ?? ""),
  };
}

export async function hasUsableMandate(input: {
  providerCustomerId: string;
  sql: BillingSqlExecutor;
  subjectId: string;
}): Promise<boolean> {
  const sessions = await listUsableMandateSessions({
    providerCustomerId: input.providerCustomerId,
    sql: input.sql,
    subjectId: input.subjectId,
    subjectKind: "user",
  });
  return sessions.length > 0;
}

export async function createRecurringSubscriptionForPrice(input: {
  configuredProviders?: BillingProviderConfigMap;
  connectionId: string;
  customerId: string;
  enrollmentId?: string;
  idempotencyKey: string;
  interval: string;
  principal: AthenaPrincipal;
  price: BillingPrice;
  registry: BillingProviderRegistry;
  sql: BillingSqlExecutor;
  testMode?: boolean;
}): Promise<BillingSubscription> {
  const connectionId = input.connectionId.trim();
  if (connectionId.length === 0) {
    throw new AthenaBillingCapabilityError({
      operation: "self.subscription.enroll",
      reason: "provider_connection_missing",
    });
  }
  const providerKey = input.enrollmentId ?? input.idempotencyKey;
  if (input.enrollmentId) {
    await recordEnrollmentJournal({
      id: input.enrollmentId,
      intent: "subscription_create_requested",
      sql: input.sql,
    });
  }
  const created = await executeLocalBillingSubscriptionCreate({
    authority: PROCESS_BILLING_INVOCATION,
    configuredProviders: input.configuredProviders,
    payload: {
      amount: input.price.amount,
      customerId: input.customerId,
      description: `Athena plan ${input.price.id}`,
      idempotencyKey: `${providerKey}:subscription`,
      interval: mollieInterval(input.interval),
      metadata: {
        athenaSubjectId: requireBillingPrincipalUserId(input.principal),
        athenaSubjectKind: "user",
        priceId: input.price.id,
      },
    },
    principal: selfDelegatedBillingPrincipal(input.principal, [
      "subscriptions.create",
    ]),
    registry: input.registry,
    testMode: input.testMode,
  });
  return persistOwnedSubscription({
    connectionId,
    interval: input.interval,
    principal: input.principal,
    sql: input.sql,
    subscription: created,
  });
}

/**
 * Recurring first-installment enrollment. Without a usable mandate the
 * first provider payment equals the recurring price (not mixed add-ons).
 */
export async function enrollSelfSubscription(input: {
  allowedRedirectOrigins?: readonly string[];
  applicationId?: string;
  cancelUrl?: string;
  configuredProviders?: BillingProviderConfigMap;
  idempotencyKey: string;
  principal: AthenaPrincipal;
  priceId: string;
  registry?: BillingProviderRegistry;
  selfEnrollmentEnabled?: BillingSelfEnrollmentSetting;
  sql: BillingSqlExecutor;
  successUrl?: string;
  testMode?: boolean;
}): Promise<BillingSelfSubscriptionEnrollResult> {
  if (!isBillingSelfEnrollmentEnabled(input.selfEnrollmentEnabled)) {
    throw new AthenaBillingCapabilityError({
      operation: "self.subscription.enroll",
      reason: "self_enrollment_disabled",
    });
  }
  const command = prepareBillingCommand({
    operation: "self.subscription.enroll",
    payload: {
      cancelUrl: input.cancelUrl,
      idempotencyKey: input.idempotencyKey,
      priceId: input.priceId,
      successUrl: input.successUrl,
    },
  });
  const priceId = String(command.payload.priceId);
  const idempotencyKey = String(command.payload.idempotencyKey);
  const subjectUserId = requireBillingPrincipalUserId(input.principal);
  const allowedRedirectOrigins = input.allowedRedirectOrigins ?? [];
  const successUrl = resolveAllowedBillingRedirectUrl({
    allowedOrigins: allowedRedirectOrigins,
    field: "successUrl",
    url: input.successUrl,
  });
  const cancelUrl = resolveAllowedBillingRedirectUrl({
    allowedOrigins: allowedRedirectOrigins,
    field: "cancelUrl",
    url: input.cancelUrl,
  });
  if (input.registry == null) {
    throw new AthenaBillingCapabilityError({
      operation: "self.subscription.enroll",
      reason: "runtime_unavailable",
    });
  }
  const existing = await getCheckoutSessionByIdempotency({
    idempotencyKey,
    sql: input.sql,
    subjectId: subjectUserId,
    subjectKind: "user",
  });
  if (existing) {
    if (isCheckoutSessionResumeExpired(existing)) {
      throw new AthenaBillingError({
        body: { sessionId: existing.id },
        code: "ATHENA_BILLING_INVALID_REQUEST",
        endpoint: "",
        message:
          "Billing checkout session has expired. Retry enroll with a new idempotencyKey.",
        method: "POST",
        status: 400,
      });
    }
  }
  const live = await input.sql.query(LIVE_SELF_SUBSCRIPTION_SQL, [
    "user",
    subjectUserId,
  ]);
  if (!existing && live.rows[0]) {
    throw billingSubscriptionAlreadyActive();
  }
  const connectionAffinity = await resolveBillingConnectionAffinity({
    configuredProviders: input.configuredProviders,
    environment: input.testMode === false ? "live" : "test",
    operation: "self.subscription.enroll",
    provider: "mollie",
    sql: input.sql,
    subjectId: subjectUserId,
    subjectKind: "user",
    testMode: input.testMode,
    ...(billingConfiguredConnectionOwner(input.applicationId) ?? {}),
  });
  const connectionId = connectionAffinity.connectionId;
  const configuredProviders = configuredProvidersForBillingConnection({
    affinity: connectionAffinity,
    configuredProviders: input.configuredProviders,
    operation: "self.subscription.enroll",
  });
  const delegated = selfDelegatedBillingPrincipal(input.principal, [
    "prices.list",
    "products.list",
    "payments.create",
    "subscriptions.create",
  ]);
  const prices = await executeLocalBillingPriceList({
    authority: PROCESS_BILLING_INVOCATION,
    configuredProviders,
    payload: {},
    principal: delegated,
    registry: input.registry,
    testMode: input.testMode,
  });
  const price = prices.items.find((item) => item.id === priceId);
  if (price == null) {
    throw new AthenaBillingCapabilityError({
      operation: "self.subscription.enroll",
      reason: "missing_catalog",
    });
  }
  const intent = resolveBillingCheckoutIntent(price);
  if (intent.kind !== "recurring") {
    throw new AthenaBillingCapabilityError({
      message:
        "One-time catalog prices must use self.checkout.create, not recurring enrollment.",
      operation: "self.subscription.enroll",
      reason: "unsupported_operation",
    });
  }
  const intentHash = hashCheckoutIntent([
    {
      amountCurrency: price.amount.currency,
      amountValue: price.amount.value,
      interval: price.interval ?? null,
      priceId: price.id,
      productId: price.productId,
      quantity: 1,
      relationId: null,
    },
  ]);
  if (existing) {
    await assertMatchingCheckoutIntent({
      existing,
      intentHash,
      sql: input.sql,
    });
    return resultFromSession(existing);
  }
  const products = await executeLocalBillingProductList({
    authority: PROCESS_BILLING_INVOCATION,
    configuredProviders,
    payload: {},
    principal: delegated,
    registry: input.registry,
    testMode: input.testMode,
  });
  const paymentPresentation = freezeBillingPaymentPresentation({
    kind: "first_payment",
    lines: [
      {
        interval: price.interval,
        priceId: price.id,
        productId: price.productId,
        quantity: 1,
      },
    ],
    operation: "self.subscription.enroll",
    products: products.items,
  });
  const enrollment = await reserveSubjectEnrollment({
    connectionId,
    idempotencyKey,
    priceId: price.id,
    sql: input.sql,
    subjectId: subjectUserId,
    subjectKind: "user",
  });
  const customer = await ensureActiveProviderCustomer({
    applicationId: input.applicationId,
    configuredProviders: input.configuredProviders,
    connectionId,
    idempotencyKey,
    principal: input.principal,
    registry: input.registry,
    sql: input.sql,
    testMode: input.testMode,
  });
  const mandateReady = await hasUsableMandate({
    providerCustomerId: customer.customerId,
    sql: input.sql,
    subjectId: subjectUserId,
  });
  if (mandateReady) {
    const subscription = await createRecurringSubscriptionForPrice({
      configuredProviders,
      connectionId,
      customerId: customer.customerId,
      enrollmentId: enrollment.id,
      idempotencyKey,
      interval: intent.interval,
      price,
      principal: input.principal,
      registry: input.registry,
      sql: input.sql,
      testMode: input.testMode,
    });
    await markEnrollmentActive({
      id: enrollment.id,
      providerSubscriptionId: subscription.providerSubscriptionId,
      sql: input.sql,
    });
    const session = await insertCheckoutSession({
      checkoutUrl: null,
      connectionId,
      enrollmentId: enrollment.id,
      expiresAt: checkoutAttemptExpiresAtIso(),
      id: "",
      idempotencyKey,
      kind: "subscription_enrollment",
      metadata: {
        [CHECKOUT_INTENT_HASH_METADATA_KEY]: intentHash,
        paymentPresentation,
        priceId: price.id,
      },
      priceId: price.id,
      provider: customer.provider,
      providerCustomerId: customer.customerId,
      providerPaymentId: null,
      providerSubscriptionId: subscription.providerSubscriptionId,
      sql: input.sql,
      status: "enrolled",
      subjectId: subjectUserId,
      subjectKind: "user",
    });
    return resultFromSession(session, subscription);
  }
  const nonce = createBillingReturnNonce();
  const expiresAt = checkoutAttemptExpiresAtIso();
  const correlatedSuccess = successUrl
    ? appendBillingReturnToken(successUrl, nonce.token)
    : undefined;
  const correlatedCancel = cancelUrl
    ? appendBillingReturnToken(cancelUrl, nonce.token)
    : undefined;
  const normalizedSuccessUrl = correlatedSuccess ?? correlatedCancel;
  const normalizedCancelUrl = correlatedCancel ?? correlatedSuccess;
  if (normalizedSuccessUrl == null || normalizedCancelUrl == null) {
    throw new AthenaBillingCapabilityError({
      operation: "self.subscription.enroll",
      reason: "unsupported_operation",
    });
  }
  const sessionId = crypto.randomUUID();
  const paymentIdempotencyKey = enrollment.id;
  const session = await insertCheckoutSession({
    checkoutUrl: null,
    connectionId,
    enrollmentId: enrollment.id,
    expiresAt,
    id: sessionId,
    idempotencyKey,
    kind: "subscription_enrollment",
    metadata: {
      athenaCheckoutSessionId: sessionId,
      athenaCheckoutWorkflow: "subscription_enrollment",
      [CHECKOUT_INTENT_HASH_METADATA_KEY]: intentHash,
      athenaEnrollment: true,
      cancelUrl: normalizedCancelUrl,
      paymentIdempotencyKey,
      paymentPresentation,
      paymentSequenceType: "first",
      priceId: price.id,
      successUrl: normalizedSuccessUrl,
    },
    priceId: price.id,
    provider: customer.provider,
    providerCustomerId: customer.customerId,
    providerPaymentId: null,
    providerSubscriptionId: null,
    returnNonceHash: nonce.hash,
    sql: input.sql,
    status: "first_payment_required",
    subjectId: subjectUserId,
    subjectKind: "user",
  });
  await insertCheckoutSessionLines({
    checkoutSessionId: sessionId,
    lines: [
      {
        amountCurrency: price.amount.currency,
        amountValue: price.amount.value,
        interval: price.interval,
        ordinal: 0,
        priceId: price.id,
        productId: price.productId,
        quantity: 1,
      },
    ],
    sql: input.sql,
  });
  const payment = await requireProviderPaymentFromCheckoutSnapshot({
    configuredProviders,
    principal: input.principal,
    registry: input.registry,
    session,
    sql: input.sql,
    testMode: input.testMode,
  });
  const updatedSession = await updateCheckoutSession({
    checkoutUrl: billingHalLinkHref(payment.raw, "checkout"),
    id: sessionId,
    providerCustomerId: customer.customerId,
    providerPaymentId: payment.providerPaymentId,
    sql: input.sql,
    status: "first_payment_required",
  });
  await updateEnrollment({
    id: enrollment.id,
    providerPaymentId: payment.providerPaymentId,
    sql: input.sql,
    state: "first_payment_pending",
  });
  return resultFromSession(updatedSession);
}
