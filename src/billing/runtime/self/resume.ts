import type { AthenaPrincipal } from "../../../runtime/data/principal.ts";
import type { CanonicalPayment } from "../../canonical/document.ts";
import { AthenaBillingCapabilityError } from "../../errors.ts";
import type { BillingProviderConfigMap } from "../../providers/types.ts";
import { prepareBillingCommand } from "../../safety/prepare.ts";
import {
  billingSubjectNotFound,
  isAthenaBillingSubjectError,
} from "../../subject/errors.ts";
import { requireBillingPrincipalUserId } from "../../subject/principal-user.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import type { BillingPayment, BillingPaymentStatus } from "../../types.ts";
import { PROCESS_BILLING_INVOCATION } from "../invocation-authority.ts";
import { executeLocalBillingPaymentGet } from "../local/execute/payments.ts";
import type { BillingProviderRegistry } from "../local/providers/registry.ts";
import type {
  BillingSelfCheckoutResumeResult,
  BillingSelfPaymentView,
} from "../types.ts";
import { advanceSelfSubscriptionEnrollment } from "./advance-enrollment.ts";
import { createProviderPaymentFromCheckoutSnapshot } from "./checkout-payment.ts";
import { checkoutSessionNeedsEnrollmentAdvance } from "./checkout-workflow.ts";
import { selfDelegatedBillingPrincipal } from "./delegated-principal.ts";
import {
  type BillingCheckoutSessionStatus,
  getCheckoutSessionByReturnNonce,
  isCheckoutSessionResumeExpired,
  updateCheckoutSession,
} from "./enrollment-session.ts";
import { persistOwnedPayment } from "./persist-owned-payment.ts";
import { hashBillingReturnNonce } from "./return-token.ts";

function asPaymentStatus(value: string): BillingPaymentStatus {
  if (
    value === "authorized" ||
    value === "paid" ||
    value === "failed" ||
    value === "canceled" ||
    value === "refunded"
  ) {
    return value;
  }
  return "pending";
}

function sessionStatusFromPayment(
  status: BillingPaymentStatus,
  current: BillingCheckoutSessionStatus
): BillingCheckoutSessionStatus {
  if (current === "enrolled") {
    return "enrolled";
  }
  if (status === "paid" || status === "authorized" || status === "refunded") {
    return "first_payment_paid";
  }
  if (status === "failed") {
    return "first_payment_failed";
  }
  if (status === "canceled") {
    return "first_payment_canceled";
  }
  return "first_payment_required";
}

function paymentToCanonical(payment: BillingPayment): CanonicalPayment {
  return {
    amount: payment.amount,
    createdAt: payment.createdAt,
    description: payment.description,
    kind: "payment",
    metadata: payment.metadata ?? {},
    paidAt: payment.paidAt,
    provider: payment.provider === "stripe" ? "stripe" : "mollie",
    providerCustomerId: payment.providerCustomerId,
    providerPaymentId: payment.providerPaymentId,
    raw: payment.raw,
    status: asPaymentStatus(payment.status),
  };
}

export async function resumeSelfCheckout(input: {
  configuredProviders?: BillingProviderConfigMap;
  principal: AthenaPrincipal;
  registry?: BillingProviderRegistry;
  returnToken: string;
  sql: BillingSqlExecutor;
  testMode?: boolean;
}): Promise<BillingSelfCheckoutResumeResult> {
  const subjectUserId = requireBillingPrincipalUserId(input.principal);
  const command = prepareBillingCommand({
    operation: "self.checkout.resume",
    payload: { returnToken: input.returnToken },
  });
  const returnToken = String(command.payload.returnToken);
  const session = await getCheckoutSessionByReturnNonce({
    returnNonceHash: hashBillingReturnNonce(returnToken),
    sql: input.sql,
    subjectId: subjectUserId,
    subjectKind: "user",
  });
  if (session == null || isCheckoutSessionResumeExpired(session)) {
    throw billingSubjectNotFound();
  }
  if (input.registry == null) {
    throw new AthenaBillingCapabilityError({
      operation: "self.checkout.resume",
      reason: "runtime_unavailable",
    });
  }
  const delegated = selfDelegatedBillingPrincipal(input.principal, [
    "payments.get",
  ]);
  let paymentId = session.providerPaymentId;
  if (paymentId == null || paymentId.trim() === "") {
    const recovered = await createProviderPaymentFromCheckoutSnapshot({
      configuredProviders: input.configuredProviders,
      principal: input.principal,
      registry: input.registry,
      session,
      sql: input.sql,
      testMode: input.testMode,
    });
    if (recovered) {
      paymentId = recovered.providerPaymentId;
      await updateCheckoutSession({
        id: session.id,
        providerCustomerId:
          recovered.providerCustomerId ?? session.providerCustomerId,
        providerPaymentId: paymentId,
        sql: input.sql,
        status: session.status,
      });
    }
  }
  if (paymentId == null || paymentId.trim() === "") {
    return {
      checkout: {
        id: session.id,
        kind:
          session.kind === "one_off" ? "one_off" : "subscription_enrollment",
        priceId: session.priceId,
        status: session.status,
      },
      payment: null,
    };
  }
  const payment = await executeLocalBillingPaymentGet({
    authority: PROCESS_BILLING_INVOCATION,
    configuredProviders: input.configuredProviders,
    payload: { id: paymentId },
    principal: delegated,
    registry: input.registry,
    testMode: input.testMode,
  });
  let view: BillingSelfPaymentView;
  try {
    view = await persistOwnedPayment({
      connectionId: session.connectionId,
      payment,
      principal: input.principal,
      sql: input.sql,
    });
  } catch (error) {
    if (isAthenaBillingSubjectError(error) && error.status === 409) {
      throw billingSubjectNotFound();
    }
    throw error;
  }
  const nextStatus = sessionStatusFromPayment(
    asPaymentStatus(payment.status),
    session.status
  );
  if (nextStatus !== session.status) {
    await updateCheckoutSession({
      id: session.id,
      providerCustomerId:
        payment.providerCustomerId ?? session.providerCustomerId,
      providerPaymentId: payment.providerPaymentId,
      sql: input.sql,
      status: nextStatus,
    });
  }
  if (checkoutSessionNeedsEnrollmentAdvance(session)) {
    await advanceSelfSubscriptionEnrollment({
      configuredProviders: input.configuredProviders,
      document: paymentToCanonical(payment),
      registry: input.registry,
      sql: input.sql,
      testMode: input.testMode,
    });
  }
  return {
    checkout: {
      id: session.id,
      kind: session.kind === "one_off" ? "one_off" : "subscription_enrollment",
      priceId: session.priceId,
      status: nextStatus,
    },
    payment: view,
  };
}
