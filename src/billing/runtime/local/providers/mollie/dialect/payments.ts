import type {
	BillingProviderCreatePaymentInput,
	BillingProviderGetResourceInput,
	BillingProviderListInput,
} from "../../types.ts";

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
	input: BillingProviderGetResourceInput,
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
): Record<string, unknown> {
	const body: Record<string, unknown> = {
		amount: input.amount,
		description: input.description ?? "",
		metadata: input.metadata ?? {},
	};
	if (input.redirectUrl != null) {
		body.redirectUrl = input.redirectUrl;
	}
	if (input.customerId != null) {
		body.customerId = input.customerId;
	}
	if (profileId != null) {
		body.profileId = profileId;
	}
	return body;
}

export function mapListInputFrom(
	input: BillingProviderListInput,
): string | undefined {
	return input.cursor != null && input.cursor.length > 0
		? input.cursor
		: undefined;
}
