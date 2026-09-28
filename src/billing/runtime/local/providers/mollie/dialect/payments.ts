import type {
  BillingProviderCreatePaymentInput,
  BillingProviderExecutionContext,
  BillingProviderGetResourceInput,
  BillingProviderListInput,
} from "../../types.ts";
import { applyTrustedClassicWebhookUrl } from "./webhook-url.ts";

export function mapCreatePaymentToMollieSdk(input: {
  body: Record<string, unknown>;
  idempotencyKey?: string;
}): Record<string, unknown> {
  return {
    idempotencyKey: input.idempotencyKey,
    paymentRequest: input.body,
  };
}

export function mapGetPaymentToMollieSdk(
  input: BillingProviderGetResourceInput
): Record<string, unknown> {
  return { paymentId: input.id };
}

export function mapListPaymentsToMollieSdk(input: {
  from?: string;
  limit?: number;
  profileId?: string;
}): Record<string, unknown> {
  return {
    from: input.from,
    limit: input.limit,
    profileId: input.profileId,
  };
}

export function paymentCreateBody(
  input: BillingProviderCreatePaymentInput,
  profileId?: string,
  context?: BillingProviderExecutionContext
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    amount: input.amount,
    description: input.description ?? "",
    metadata: input.metadata ?? {},
  };
  if (input.redirectUrl != null) {
    body.redirectUrl = input.redirectUrl;
  }
  if (input.cancelUrl != null) {
    body.cancelUrl = input.cancelUrl;
  }
  if (input.customerId != null) {
    body.customerId = input.customerId;
  }
  if (input.sequenceType != null) {
    body.sequenceType = input.sequenceType;
  }
  if (profileId != null) {
    body.profileId = profileId;
  }
  if (context) {
    applyTrustedClassicWebhookUrl(body, context);
  }
  return body;
}

export function mapListInputFrom(
  input: BillingProviderListInput
): string | undefined {
  return input.cursor != null && input.cursor.length > 0
    ? input.cursor
    : undefined;
}
