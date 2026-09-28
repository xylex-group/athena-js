import type {
  BillingProviderCreateSubscriptionInput,
  BillingProviderGetSubscriptionInput,
  BillingProviderUpdateSubscriptionInput,
} from "../../types.ts";

export function mapCreateSubscriptionToMollieSdk(input: {
  input: BillingProviderCreateSubscriptionInput;
  idempotencyKey: string;
  webhookUrl?: string;
}): Record<string, unknown> {
  const subscriptionRequest: Record<string, unknown> = {
    amount: input.input.amount,
    description: input.input.description,
    interval: input.input.interval,
  };
  if (input.input.metadata != null) {
    subscriptionRequest.metadata = input.input.metadata;
  }
  if (input.webhookUrl) {
    subscriptionRequest.webhookUrl = input.webhookUrl;
  }
  return {
    customerId: input.input.customerId,
    idempotencyKey: input.idempotencyKey,
    subscriptionRequest,
  };
}

export function mapGetSubscriptionToMollieSdk(
  input: BillingProviderGetSubscriptionInput
): Record<string, unknown> {
  return {
    customerId: input.customerId,
    subscriptionId: input.subscriptionId,
  };
}

export function mapUpdateSubscriptionToMollieSdk(
  input: BillingProviderUpdateSubscriptionInput
): Record<string, unknown> {
  const subscriptionRequest: Record<string, unknown> = {};
  if (input.description != null) {
    subscriptionRequest.description = input.description;
  }
  if (input.amount != null) {
    subscriptionRequest.amount = input.amount;
  }
  if (input.interval != null) {
    subscriptionRequest.interval = input.interval;
  }
  if (input.metadata != null) {
    subscriptionRequest.metadata = input.metadata;
  }
  return {
    customerId: input.customerId,
    subscriptionId: input.subscriptionId,
    subscriptionRequest,
  };
}
