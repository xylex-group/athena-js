import type { AthenaPrincipal } from "../../../runtime/data/principal.ts";
import {
  AthenaBillingCapabilityError,
  AthenaBillingError,
  isAthenaBillingCapabilityError,
} from "../../errors.ts";
import type { BillingProviderConfigMap } from "../../providers/types.ts";
import { prepareBillingCommand } from "../../safety/prepare.ts";
import type { BillingSelfEnrollmentSetting } from "../../self-enrollment.ts";
import { isBillingSelfEnrollmentEnabled } from "../../self-enrollment.ts";
import {
  billingConfiguredConnectionOwner,
  configuredProvidersForBillingConnection,
  resolveBillingConnectionAffinity,
} from "../../subject/connection-affinity.ts";
import { ensureActiveProviderCustomer } from "../../subject/ensure-provider-customer.ts";
import { requireBillingPrincipalUserId } from "../../subject/principal-user.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import type { BillingCheckout } from "../../types.ts";
import { billingHalLinkHref } from "../hal-link-href.ts";
import { PROCESS_BILLING_INVOCATION } from "../invocation-authority.ts";
import { executeLocalBillingPriceList } from "../local/execute/price-list.ts";
import { executeLocalBillingProductList } from "../local/execute/product-list.ts";
import { executeLocalBillingRelationList } from "../local/execute/relation-list.ts";
import type { BillingProviderRegistry } from "../local/providers/registry.ts";
import {
  assertMatchingCheckoutIntent,
  assertMatchingCheckoutRequest,
  CHECKOUT_INTENT_HASH_METADATA_KEY,
  digestLinesFromComposition,
  hashCheckoutIntent,
} from "./checkout-intent-hash.ts";
import { resolveSelfCheckoutLineRequests } from "./checkout-lines.ts";
import { requireProviderPaymentFromCheckoutSnapshot } from "./checkout-payment.ts";
import { resolveCheckoutSettlement } from "./checkout-settlement.ts";
import {
  checkoutSessionKindForWorkflow,
  resolveCheckoutWorkflow,
} from "./checkout-workflow.ts";
import { planSelfCheckoutComposition } from "./composition.ts";
import { freezeBillingPaymentPresentation } from "./checkout-presentation.ts";
import { selfDelegatedBillingPrincipal } from "./delegated-principal.ts";
import { hasUsableMandate } from "./enroll.ts";
import {
  reserveSubjectEnrollment,
  updateEnrollment,
} from "./enrollment-reservation.ts";
import {
  billingSqlTransactionOrThrow,
  checkoutAttemptExpiresAtIso,
  getCheckoutSessionByIdempotency,
  insertCheckoutSession,
  insertCheckoutSessionLines,
  isCheckoutSessionResumeExpired,
  listCheckoutSessionLines,
  requireBillingSqlTransaction,
  updateCheckoutSession,
} from "./enrollment-session.ts";
import { resolveAllowedBillingRedirectUrl } from "./redirect-url.ts";
import { appendBillingReturnToken } from "./return-query.ts";
import { createBillingReturnNonce } from "./return-token.ts";

const OWNED_SUBSCRIPTION_RESOURCE_SQL = `
SELECT provider_customer_id, connection_id
FROM billing.billing_subscriptions
WHERE subject_kind = 'user'
  AND subject_id = $1
  AND ownership_status = 'resolved'
  AND lower(status) NOT IN ('canceled', 'cancelled', 'expired', 'completed')
ORDER BY ingested_at DESC
LIMIT 2
`;

const OWNED_PAYMENT_RESOURCE_SQL = `
SELECT provider_customer_id, connection_id
FROM billing.billing_payments
WHERE subject_kind = 'user'
  AND subject_id = $1
  AND ownership_status = 'resolved'
  AND provider_customer_id IS NOT NULL
  AND btrim(provider_customer_id) <> ''
ORDER BY ingested_at DESC
LIMIT 2
`;

function checkoutUrlFromRaw(raw: unknown): string | null {
  return billingHalLinkHref(raw, "checkout");
}

async function ownedBillingResource(input: {
  principal: AthenaPrincipal;
  sql: BillingSqlExecutor;
}): Promise<{ connectionId?: string; customerId?: string }> {
  const subjectUserId = requireBillingPrincipalUserId(input.principal);
  const fromSubscription = await input.sql.query(
    OWNED_SUBSCRIPTION_RESOURCE_SQL,
    [subjectUserId],
  );
  const subscription = uniqueOwnedResource(
    fromSubscription.rows,
    "self.checkout.create",
  );
  if (subscription) {
    return {
      ...(typeof subscription.connection_id === "string"
        ? { connectionId: subscription.connection_id }
        : {}),
      ...(typeof subscription.provider_customer_id === "string" &&
        subscription.provider_customer_id.trim()
        ? { customerId: subscription.provider_customer_id }
        : {}),
    };
  }
  const fromPayment = await input.sql.query(OWNED_PAYMENT_RESOURCE_SQL, [
    subjectUserId,
  ]);
  const payment = uniqueOwnedResource(fromPayment.rows, "self.checkout.create");
  if (payment) {
    return {
      ...(typeof payment.connection_id === "string"
        ? { connectionId: payment.connection_id }
        : {}),
      ...(typeof payment.provider_customer_id === "string" &&
        payment.provider_customer_id.trim()
        ? { customerId: payment.provider_customer_id }
        : {}),
    };
  }
  return {};
}

function uniqueOwnedResource(
  rows: readonly Record<string, unknown>[],
  operation: "self.checkout.create",
): Record<string, unknown> | undefined {
  if (rows.length === 0) {
    return;
  }
  const connectionIds = [
    ...new Set(
      rows
        .map((row) => row.connection_id)
        .filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0,
        ),
    ),
  ];
  if (connectionIds.length > 1) {
    throw new AthenaBillingCapabilityError({
      operation,
      reason: "provider_connection_ambiguous",
    });
  }
  const uniqueConnectionId = connectionIds[0];
  if (uniqueConnectionId == null) {
    return;
  }
  const provenance = rows.find((row) => row.connection_id === uniqueConnectionId);
  const customerId =
    typeof provenance?.provider_customer_id === "string" &&
    provenance.provider_customer_id.trim().length > 0
      ? provenance.provider_customer_id.trim()
      : undefined;
  return {
    connection_id: uniqueConnectionId,
    ...(customerId == null ? {} : { provider_customer_id: customerId }),
  };
}

/**
 * Customer checkout. Mixed carts (one recurring + one-off add-ons) use
 * setup/add-on settlement: the provider payment is add-ons only; the
 * subscription is created after that payment is paid. Recurring first
 * installment is collected by `enrollSelfSubscription`, not folded into
 * this payment.
 */
export async function createSelfCheckout(input: {
  allowedRedirectOrigins?: readonly string[];
  applicationId?: string;
  cancelUrl?: string;
  configuredProviders?: BillingProviderConfigMap;
  idempotencyKey: string;
  lines?: readonly { priceId: string; quantity?: number }[];
  principal: AthenaPrincipal;
  priceId?: string;
  registry?: BillingProviderRegistry;
  selfEnrollmentEnabled?: BillingSelfEnrollmentSetting;
  sql: BillingSqlExecutor;
  successUrl?: string;
  testMode?: boolean;
}): Promise<BillingCheckout> {
  const subjectUserId = requireBillingPrincipalUserId(input.principal);
  const command = prepareBillingCommand({
    operation: "self.checkout.create",
    payload: {
      cancelUrl: input.cancelUrl,
      idempotencyKey: input.idempotencyKey,
      lines: input.lines,
      priceId: input.priceId,
      successUrl: input.successUrl,
    },
  });
  const lineRequests = resolveSelfCheckoutLineRequests(command.payload);
  const priceId = lineRequests[0]?.priceId ?? "";
  const idempotencyKey = String(command.payload.idempotencyKey);
  if (input.registry == null) {
    throw new AthenaBillingCapabilityError({
      operation: "self.checkout.create",
      reason: "runtime_unavailable",
    });
  }
  billingSqlTransactionOrThrow(input.sql);
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
          "Billing checkout session has expired. Retry checkout with a new idempotencyKey.",
        method: "POST",
        status: 400,
      });
    }
  }
  const persistedLines = existing
    ? await listCheckoutSessionLines({
      checkoutSessionId: existing.id,
      sql: input.sql,
    })
    : [];
  if (existing && persistedLines.length > 0) {
    await assertMatchingCheckoutRequest({
      existing,
      requests: lineRequests,
      sql: input.sql,
    });
  }
  const owned = await ownedBillingResource({
    principal: input.principal,
    sql: input.sql,
  });
  const existingConnectionId =
    typeof existing?.metadata.billingConnectionId === "string"
      ? existing.metadata.billingConnectionId
      : undefined;
  const ownedConnectionId =
    owned.connectionId?.trim() || existingConnectionId?.trim() || undefined;
  const connectionAffinity = await resolveBillingConnectionAffinity({
    configuredProviders: input.configuredProviders,
    environment: input.testMode === false ? "live" : "test",
    operation: "self.checkout.create",
    ownedConnectionId,
    provider: "mollie",
    sql: input.sql,
    subjectId: subjectUserId,
    subjectKind: "user",
    testMode: input.testMode,
    ...(billingConfiguredConnectionOwner(input.applicationId) ?? {}),
  });
  const configuredProviders = configuredProvidersForBillingConnection({
    affinity: connectionAffinity,
    configuredProviders: input.configuredProviders,
    operation: "self.checkout.create",
  });
  if (existing && persistedLines.length > 0) {
    if (
      existing.providerPaymentId != null &&
      existing.providerPaymentId.trim() !== ""
    ) {
      return {
        checkoutUrl: existing.checkoutUrl,
        metadata: {
          paymentId: existing.providerPaymentId,
          priceId: existing.priceId,
          sessionId: existing.id,
        },
        provider: existing.provider,
        providerCheckoutId: existing.providerPaymentId,
        raw: {},
      };
    }
    const expiresAt = checkoutAttemptExpiresAtIso();
    const session = await updateCheckoutSession({
      expiresAt,
      id: existing.id,
      sql: input.sql,
      status: existing.status,
    });
    const payment = await requireProviderPaymentFromCheckoutSnapshot({
      configuredProviders,
      principal: input.principal,
      registry: input.registry,
      session,
      sql: input.sql,
      testMode: input.testMode,
    });
    const checkoutUrl = checkoutUrlFromRaw(payment.raw);
    await updateCheckoutSession({
      checkoutUrl,
      id: session.id,
      providerCustomerId:
        payment.providerCustomerId ?? session.providerCustomerId,
      providerPaymentId: payment.providerPaymentId,
      sql: input.sql,
      status: "first_payment_required",
    });
    if (session.enrollmentId != null && session.enrollmentId.trim() !== "") {
      await updateEnrollment({
        id: session.enrollmentId,
        providerPaymentId: payment.providerPaymentId,
        sql: input.sql,
        state: "first_payment_pending",
      });
    }
    return {
      checkoutUrl,
      metadata: {
        paymentId: payment.providerPaymentId,
        priceId: session.priceId,
        sessionId: session.id,
      },
      provider: payment.provider,
      providerCheckoutId: payment.providerPaymentId,
      raw: payment.raw,
    };
  }
  const mixed = lineRequests.length > 1;
  const delegated = selfDelegatedBillingPrincipal(input.principal, [
    "prices.list",
    "products.list",
    "relations.list",
    "payments.create",
    ...(mixed ? (["subscriptions.create", "customers.create"] as const) : []),
  ]);
  const prices = await executeLocalBillingPriceList({
    authority: PROCESS_BILLING_INVOCATION,
    configuredProviders,
    payload: {},
    principal: delegated,
    registry: input.registry,
    testMode: input.testMode,
  });
  let relationsItems: Awaited<
    ReturnType<typeof executeLocalBillingRelationList>
  >["items"] = [];
  try {
    const relationsPage = await executeLocalBillingRelationList({
      authority: PROCESS_BILLING_INVOCATION,
      configuredProviders,
      payload: {},
      principal: delegated,
      registry: input.registry,
      testMode: input.testMode,
    });
    relationsItems = relationsPage.items;
  } catch (error) {
    if (
      !isAthenaBillingCapabilityError(error) ||
      error.reason !== "missing_catalog"
    ) {
      throw error;
    }
  }
  const composition = planSelfCheckoutComposition({
    lines: lineRequests,
    prices: prices.items,
    relations: relationsItems,
  });
  const paymentPresentation =
    existing == null || persistedLines.length === 0
      ? freezeBillingPaymentPresentation({
          kind: "checkout",
          lines: [
            ...composition.oneOffLines,
            ...(composition.recurringLine
              ? [composition.recurringLine]
              : []),
          ].map((line) => ({
            interval: line.interval,
            priceId: line.price.id,
            productId: line.productId,
            quantity: line.quantity,
          })),
          operation: "self.checkout.create",
          products: (
            await executeLocalBillingProductList({
              authority: PROCESS_BILLING_INVOCATION,
              configuredProviders,
              payload: {},
              principal: delegated,
              registry: input.registry,
              testMode: input.testMode,
            })
          ).items,
        })
      : undefined;
  const intentHash = hashCheckoutIntent(
    digestLinesFromComposition(composition),
  );
  if (existing) {
    await assertMatchingCheckoutIntent({
      existing,
      intentHash,
      sql: input.sql,
    });
    if (
      existing.providerPaymentId != null &&
      existing.providerPaymentId.trim() !== ""
    ) {
      return {
        checkoutUrl: existing.checkoutUrl,
        metadata: {
          paymentId: existing.providerPaymentId,
          priceId: existing.priceId,
          sessionId: existing.id,
        },
        provider: existing.provider,
        providerCheckoutId: existing.providerPaymentId,
        raw: {},
      };
    }
  }
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
  if (successUrl == null && cancelUrl == null) {
    throw new AthenaBillingCapabilityError({
      operation: "self.checkout.create",
      reason: "unsupported_operation",
    });
  }
  const expiresAt = checkoutAttemptExpiresAtIso();
  const existingSuccess =
    typeof existing?.metadata.successUrl === "string"
      ? existing.metadata.successUrl
      : undefined;
  const existingCancel =
    typeof existing?.metadata.cancelUrl === "string"
      ? existing.metadata.cancelUrl
      : undefined;
  const nonce = existing == null ? createBillingReturnNonce() : null;
  const correlatedSuccess =
    existing != null
      ? existingSuccess
      : successUrl != null && nonce != null
        ? appendBillingReturnToken(successUrl, nonce.token)
        : undefined;
  const correlatedCancel =
    existing != null
      ? existingCancel
      : cancelUrl != null && nonce != null
        ? appendBillingReturnToken(cancelUrl, nonce.token)
        : undefined;
  const normalizedSuccessUrl = correlatedSuccess ?? correlatedCancel;
  const normalizedCancelUrl = correlatedCancel ?? correlatedSuccess;
  if (normalizedSuccessUrl == null || normalizedCancelUrl == null) {
    throw new AthenaBillingCapabilityError({
      operation: "self.checkout.create",
      reason: "unsupported_operation",
    });
  }

  let enrollmentId: string | null = null;
  let customerId = owned.customerId;
  let mandateReady = false;
  if (composition.recurringLine != null) {
    if (!isBillingSelfEnrollmentEnabled(input.selfEnrollmentEnabled)) {
      throw new AthenaBillingCapabilityError({
        operation: "self.checkout.create",
        reason: "self_enrollment_disabled",
      });
    }
    const enrollment = await reserveSubjectEnrollment({
      connectionId: connectionAffinity.connectionId,
      idempotencyKey,
      priceId: composition.recurringLine.price.id,
      sql: input.sql,
      subjectId: subjectUserId,
      subjectKind: "user",
    });
    enrollmentId = enrollment.id;
    const customer = await ensureActiveProviderCustomer({
      applicationId: input.applicationId,
      configuredProviders: input.configuredProviders,
      connectionId: connectionAffinity.connectionId,
      idempotencyKey,
      principal: input.principal,
      registry: input.registry,
      sql: input.sql,
      testMode: input.testMode,
    });
    customerId = customer.customerId;
    mandateReady = await hasUsableMandate({
      providerCustomerId: customer.customerId,
      sql: input.sql,
      subjectId: subjectUserId,
    });
  }

  const settlement = resolveCheckoutSettlement(composition);
  if (settlement == null) {
    throw new AthenaBillingCapabilityError({
      operation: "self.checkout.create",
      reason: "unsupported_operation",
    });
  }
  const sessionId = existing?.id ?? crypto.randomUUID();
  const workflow = resolveCheckoutWorkflow(composition);
  const sessionKind = checkoutSessionKindForWorkflow(workflow);
  const needsMandateEstablishment =
    composition.recurringLine != null && !mandateReady;
  const snapshotLines = [
    ...composition.oneOffLines,
    ...(composition.recurringLine ? [composition.recurringLine] : []),
  ].map((line, ordinal) => ({
    amountCurrency: line.amount.currency,
    amountValue: line.amount.value,
    interval: line.interval,
    ordinal,
    priceId: line.price.id,
    productId: line.productId,
    quantity: line.quantity,
    relationId: line.relationId,
  }));
  const session = await requireBillingSqlTransaction(input.sql, async (sql) => {
    if (existing) {
      const persisted = await updateCheckoutSession({
        enrollmentId,
        expiresAt,
        id: existing.id,
        metadata: {
          athenaCheckoutSessionId: existing.id,
          athenaCheckoutWorkflow: workflow,
          [CHECKOUT_INTENT_HASH_METADATA_KEY]: intentHash,
          billingConnectionId: connectionAffinity.connectionId,
          checkoutSettlement: settlement.model,
          oneOffAmountCurrency: settlement.providerPaymentAmount.currency,
          oneOffAmountValue: settlement.providerPaymentAmount.value,
          paymentIdempotencyKey: idempotencyKey,
          cancelUrl: normalizedCancelUrl,
          ...(needsMandateEstablishment
            ? { paymentSequenceType: "first" }
            : {}),
          priceId,
          successUrl: normalizedSuccessUrl,
          ...(paymentPresentation
            ? { paymentPresentation }
            : {}),
        },
        providerCustomerId: customerId ?? null,
        sql,
        status: existing.status,
      });
      await insertCheckoutSessionLines({
        checkoutSessionId: persisted.id,
        lines: snapshotLines,
        sql,
      });
      return persisted;
    }
    if (nonce == null) {
      throw new AthenaBillingCapabilityError({
        operation: "self.checkout.create",
        reason: "unsupported_operation",
      });
    }
    const persisted = await insertCheckoutSession({
      checkoutUrl: null,
      connectionId: connectionAffinity.connectionId,
      enrollmentId,
      expiresAt,
      id: sessionId,
      idempotencyKey,
      kind: sessionKind,
      metadata: {
        athenaCheckoutSessionId: sessionId,
        athenaCheckoutWorkflow: workflow,
        [CHECKOUT_INTENT_HASH_METADATA_KEY]: intentHash,
        billingConnectionId: connectionAffinity.connectionId,
        checkoutSettlement: settlement.model,
        oneOffAmountCurrency: settlement.providerPaymentAmount.currency,
        oneOffAmountValue: settlement.providerPaymentAmount.value,
        paymentIdempotencyKey: idempotencyKey,
        cancelUrl: normalizedCancelUrl,
        ...(needsMandateEstablishment ? { paymentSequenceType: "first" } : {}),
        paymentPresentation,
        priceId,
        successUrl: normalizedSuccessUrl,
      },
      priceId: composition.recurringLine?.price.id ?? priceId,
      provider: "mollie",
      providerCustomerId: customerId ?? null,
      providerPaymentId: null,
      providerSubscriptionId: null,
      returnNonceHash: nonce.hash,
      sql,
      status: "first_payment_required",
      subjectId: subjectUserId,
      subjectKind: "user",
    });
    await insertCheckoutSessionLines({
      checkoutSessionId: persisted.id,
      lines: snapshotLines,
      sql,
    });
    return persisted;
  });
  const payment = await requireProviderPaymentFromCheckoutSnapshot({
    configuredProviders,
    principal: input.principal,
    registry: input.registry,
    session,
    sql: input.sql,
    testMode: input.testMode,
  });
  const checkoutUrl = checkoutUrlFromRaw(payment.raw);
  await updateCheckoutSession({
    checkoutUrl,
    id: session.id,
    providerCustomerId: payment.providerCustomerId ?? customerId ?? null,
    providerPaymentId: payment.providerPaymentId,
    sql: input.sql,
    status: "first_payment_required",
  });
  if (enrollmentId != null) {
    await updateEnrollment({
      id: enrollmentId,
      providerPaymentId: payment.providerPaymentId,
      sql: input.sql,
      state: "first_payment_pending",
    });
  }
  return {
    checkoutUrl,
    metadata: {
      paymentId: payment.providerPaymentId,
      priceId,
      sessionId: session.id,
    },
    provider: payment.provider,
    providerCheckoutId: payment.providerPaymentId,
    raw: payment.raw,
  };
}
