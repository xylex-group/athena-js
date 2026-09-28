import { randomUUID } from "node:crypto";

import type { CanonicalBillingDocument } from "../../canonical/document.ts";
import type { BillingProviderConfigMap } from "../../providers/types.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import type { BillingProviderRegistry } from "../local/providers/registry.ts";
import { resolveBillingCheckoutIntent } from "./checkout-intent.ts";
import { recurringPriceFromCheckoutSnapshot } from "./checkout-snapshot.ts";
import { createRecurringSubscriptionForPrice } from "./enroll.ts";
import {
  claimEnrollmentForAdvance,
  enrollmentProviderEffectIdempotencyKey,
  getEnrollmentById,
  heartbeatEnrollmentLease,
  markEnrollmentActive,
  recordEnrollmentAdvanceFailure,
} from "./enrollment-reservation.ts";
import {
  getCheckoutSessionByPayment,
  listCheckoutSessionLines,
  updateCheckoutSession,
} from "./enrollment-session.ts";

function latePaymentStatus(
  enrollmentState: string | undefined
): "late_paid" | "reconcile_required" | "refund_required" {
  if (enrollmentState === "active") {
    return "reconcile_required";
  }
  if (enrollmentState === "expired" || enrollmentState === "superseded") {
    return "refund_required";
  }
  return "late_paid";
}

export async function advanceSelfSubscriptionEnrollment(input: {
  configuredProviders?: BillingProviderConfigMap;
  document: CanonicalBillingDocument;
  registry: BillingProviderRegistry;
  sql: BillingSqlExecutor;
  testMode?: boolean;
}): Promise<void> {
  if (input.document.kind !== "payment") {
    return;
  }
  const session = await getCheckoutSessionByPayment({
    provider: input.document.provider,
    providerPaymentId: input.document.providerPaymentId,
    sql: input.sql,
  });
  if (session == null) {
    return;
  }
  if (
    session.status === "enrolled" ||
    session.status === "late_paid" ||
    session.status === "reconcile_required" ||
    session.status === "refund_required"
  ) {
    return;
  }
  if (
    input.document.status === "failed" ||
    input.document.status === "canceled"
  ) {
    await updateCheckoutSession({
      id: session.id,
      sql: input.sql,
      status:
        input.document.status === "canceled"
          ? "first_payment_canceled"
          : "first_payment_failed",
    });
    return;
  }
  if (input.document.status !== "paid") {
    return;
  }
  const enrollmentId = session.enrollmentId;
  if (enrollmentId == null || enrollmentId.trim() === "") {
    await updateCheckoutSession({
      id: session.id,
      sql: input.sql,
      status: "reconcile_required",
    });
    return;
  }
  const enrollment = await getEnrollmentById({
    id: enrollmentId,
    sql: input.sql,
  });
  if (enrollment == null) {
    await updateCheckoutSession({
      id: session.id,
      sql: input.sql,
      status: "reconcile_required",
    });
    return;
  }
  if (enrollment.state === "active") {
    await updateCheckoutSession({
      id: session.id,
      providerCustomerId: session.providerCustomerId,
      providerSubscriptionId: enrollment.providerSubscriptionId,
      sql: input.sql,
      status: "enrolled",
    });
    return;
  }
  if (
    enrollment.state !== "reserved" &&
    enrollment.state !== "first_payment_pending" &&
    enrollment.state !== "advancing"
  ) {
    await updateCheckoutSession({
      id: session.id,
      sql: input.sql,
      status: latePaymentStatus(enrollment.state),
    });
    return;
  }
  const leaseToken = randomUUID();
  const claimed = await claimEnrollmentForAdvance({
    id: enrollment.id,
    leaseToken,
    sql: input.sql,
  });
  if (claimed == null) {
    const again = await getEnrollmentById({
      id: enrollment.id,
      sql: input.sql,
    });
    if (again?.state === "active") {
      await updateCheckoutSession({
        id: session.id,
        sql: input.sql,
        status: "enrolled",
      });
    }
    return;
  }
  try {
    const held = await heartbeatEnrollmentLease({
      id: claimed.id,
      leaseToken,
      sql: input.sql,
    });
    if (!held) {
      return;
    }
    const lines = await listCheckoutSessionLines({
      checkoutSessionId: session.id,
      sql: input.sql,
    });
    const price = recurringPriceFromCheckoutSnapshot(lines);
    if (price == null || price.id !== claimed.priceId) {
      await recordEnrollmentAdvanceFailure({
        expectedLeaseToken: leaseToken,
        id: claimed.id,
        lastError: "missing_snapshot",
        sql: input.sql,
      });
      return;
    }
    const intent = resolveBillingCheckoutIntent(price);
    if (intent.kind !== "recurring") {
      await recordEnrollmentAdvanceFailure({
        expectedLeaseToken: leaseToken,
        id: claimed.id,
        lastError: "not_recurring",
        sql: input.sql,
      });
      return;
    }
    const customerId =
      session.providerCustomerId ?? input.document.providerCustomerId;
    if (customerId == null || customerId.trim() === "") {
      await recordEnrollmentAdvanceFailure({
        expectedLeaseToken: leaseToken,
        id: claimed.id,
        lastError: "missing_customer",
        sql: input.sql,
      });
      return;
    }
    await heartbeatEnrollmentLease({
      id: claimed.id,
      leaseToken,
      sql: input.sql,
    });
    const subscription = await createRecurringSubscriptionForPrice({
      configuredProviders: input.configuredProviders,
      connectionId: claimed.connectionId,
      customerId,
      enrollmentId: claimed.id,
      idempotencyKey: enrollmentProviderEffectIdempotencyKey(claimed),
      interval: intent.interval,
      price,
      principal: {
        authenticated: true,
        grants: [],
        rights: [],
        userId: session.subjectId,
      },
      registry: input.registry,
      sql: input.sql,
      testMode: input.testMode,
    });
    const activated = await markEnrollmentActive({
      expectedFencingEpoch: claimed.fencingEpoch,
      expectedLeaseToken: leaseToken,
      id: claimed.id,
      providerSubscriptionId: subscription.providerSubscriptionId,
      sql: input.sql,
    });
    if (!activated) {
      await recordEnrollmentAdvanceFailure({
        expectedLeaseToken: leaseToken,
        id: claimed.id,
        lastError: "lease_lost",
        sql: input.sql,
      });
      return;
    }
    await updateCheckoutSession({
      id: session.id,
      providerCustomerId: customerId,
      providerSubscriptionId: subscription.providerSubscriptionId,
      sql: input.sql,
      status: "enrolled",
    });
  } catch (error) {
    await recordEnrollmentAdvanceFailure({
      expectedLeaseToken: leaseToken,
      id: claimed.id,
      lastError: error instanceof Error ? error.message : "advance_failed",
      sql: input.sql,
    });
    throw error;
  }
}
