import type { AthenaPrincipal } from "../../../runtime/data/principal.ts";
import { AthenaBillingCapabilityError } from "../../errors.ts";
import type { BillingProviderConfigMap } from "../../providers/types.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import type { BillingPayment } from "../../types.ts";
import { PROCESS_BILLING_INVOCATION } from "../invocation-authority.ts";
import { executeLocalBillingPaymentCreate } from "../local/execute/payments.ts";
import type { BillingProviderRegistry } from "../local/providers/registry.ts";
import {
  payableCheckoutSnapshotLines,
  paymentAmountFromCheckoutSnapshot,
} from "./checkout-snapshot.ts";
import { parseBillingPaymentPresentation } from "./checkout-presentation.ts";
import { selfDelegatedBillingPrincipal } from "./delegated-principal.ts";
import {
  type BillingCheckoutSessionRecord,
  listCheckoutSessionLines,
} from "./enrollment-session.ts";

function metadataString(
  metadata: Record<string, unknown>,
  key: string
): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

export function paymentCreateIdempotencyKey(
  session: BillingCheckoutSessionRecord
): string {
  const stored = metadataString(session.metadata, "paymentIdempotencyKey");
  if (stored) {
    return stored;
  }
  if (session.kind === "one_off") {
    return session.idempotencyKey;
  }
  return `${session.idempotencyKey}:first-payment`;
}

/**
 * Provider payment amount and price identity come from the accepted line
 * snapshot, never from a later catalog read.
 */
export async function createProviderPaymentFromCheckoutSnapshot(input: {
  configuredProviders?: BillingProviderConfigMap;
  principal: AthenaPrincipal;
  registry: BillingProviderRegistry;
  session: BillingCheckoutSessionRecord;
  sql: BillingSqlExecutor;
  testMode?: boolean;
}): Promise<BillingPayment | undefined> {
  const lines = await listCheckoutSessionLines({
    checkoutSessionId: input.session.id,
    sql: input.sql,
  });
  const amount = paymentAmountFromCheckoutSnapshot(lines);
  const payable = payableCheckoutSnapshotLines(lines);
  const priceIds = payable.map((line) => line.priceId);
  const snapshotPriceId = priceIds[0];
  if (amount == null || snapshotPriceId == null || priceIds.length === 0) {
    return;
  }
  const successUrl = metadataString(input.session.metadata, "successUrl");
  const cancelUrl = metadataString(input.session.metadata, "cancelUrl");
  const redirectUrl = successUrl ?? cancelUrl;
  if (redirectUrl == null) {
    return;
  }
  const presentation = parseBillingPaymentPresentation(
    input.session.metadata.paymentPresentation,
  );
  const identityDescription = priceIds.join(" + ");
  const delegated = selfDelegatedBillingPrincipal(input.principal, [
    "payments.create",
  ]);
  return executeLocalBillingPaymentCreate({
    authority: PROCESS_BILLING_INVOCATION,
    configuredProviders: input.configuredProviders,
    payload: {
      amount,
      customerId: input.session.providerCustomerId ?? undefined,
      description:
        presentation?.description ??
        (input.session.kind === "one_off"
          ? `Athena checkout ${identityDescription}`
          : `Athena first payment ${identityDescription}`),
      idempotencyKey: paymentCreateIdempotencyKey(input.session),
      metadata: {
        athenaCheckoutSessionId: input.session.id,
        athenaSubjectId: input.session.subjectId,
        athenaSubjectKind: input.session.subjectKind,
        priceId: snapshotPriceId,
        priceIds,
        ...(input.session.metadata.athenaEnrollment === true
          ? { athenaEnrollment: true }
          : {}),
      },
      cancelUrl,
      redirectUrl,
      ...(input.session.metadata.paymentSequenceType === "first"
        ? { sequenceType: "first" as const }
        : {}),
    },
    principal: delegated,
    registry: input.registry,
    testMode: input.testMode,
  });
}

export async function requireProviderPaymentFromCheckoutSnapshot(input: {
  configuredProviders?: BillingProviderConfigMap;
  principal: AthenaPrincipal;
  registry: BillingProviderRegistry;
  session: BillingCheckoutSessionRecord;
  sql: BillingSqlExecutor;
  testMode?: boolean;
}): Promise<BillingPayment> {
  const payment = await createProviderPaymentFromCheckoutSnapshot(input);
  if (payment == null) {
    throw new AthenaBillingCapabilityError({
      operation: "self.checkout.create",
      reason: "unsupported_operation",
    });
  }
  return payment;
}
