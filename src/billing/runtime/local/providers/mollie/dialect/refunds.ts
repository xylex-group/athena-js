import type {
  BillingProviderCreateRefundInput,
  BillingProviderGetRefundInput,
} from "../../types.ts";

export function mapCreateRefundToMollieSdk(input: {
  input: BillingProviderCreateRefundInput;
  idempotencyKey: string;
}): Record<string, unknown> {
  const refundRequest: Record<string, unknown> = {
    amount: input.input.amount,
  };
  if (input.input.description != null) {
    refundRequest.description = input.input.description;
  }
  return {
    idempotencyKey: input.idempotencyKey,
    paymentId: input.input.paymentId,
    refundRequest,
  };
}

export function mapGetRefundToMollieSdk(
  input: BillingProviderGetRefundInput
): Record<string, unknown> {
  return {
    paymentId: input.paymentId,
    refundId: input.refundId,
  };
}

export function mapCancelRefundToMollieSdk(input: {
  input: BillingProviderGetRefundInput;
  idempotencyKey: string;
}): Record<string, unknown> {
  return {
    idempotencyKey: input.idempotencyKey,
    paymentId: input.input.paymentId,
    refundId: input.input.refundId,
  };
}
