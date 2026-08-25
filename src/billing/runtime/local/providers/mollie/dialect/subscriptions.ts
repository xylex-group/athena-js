import type {
	BillingProviderCreateSubscriptionInput,
	BillingProviderGetSubscriptionInput,
	BillingProviderUpdateSubscriptionInput,
} from "../../types.ts";

export function mapCreateSubscriptionToMollieSdk(input: {
	input: BillingProviderCreateSubscriptionInput;
	idempotencyKey: string;
}): Record<string, unknown> {
	const subscriptionRequest: Record<string, unknown> = {
		amount: input.input.amount,
		description: input.input.description,
		interval: input.input.interval,
	};
	if (input.input.metadata != null) {
		subscriptionRequest.metadata = input.input.metadata;
	}
	return {
		customerId: input.input.customerId,
		idempotencyKey: input.idempotencyKey,
		subscriptionRequest,
	};
}

export function mapGetSubscriptionToMollieSdk(
	input: BillingProviderGetSubscriptionInput,
): Record<string, unknown> {
	return {
		customerId: input.customerId,
		subscriptionId: input.subscriptionId,
	};
}

export function mapUpdateSubscriptionToMollieSdk(
	input: BillingProviderUpdateSubscriptionInput,
): Record<string, unknown> {
	const subscriptionRequest: Record<string, unknown> = {};
	if (input.description != null) {
		subscriptionRequest.description = input.description;
	}
	return {
		customerId: input.customerId,
		subscriptionId: input.subscriptionId,
		subscriptionRequest,
	};
}
