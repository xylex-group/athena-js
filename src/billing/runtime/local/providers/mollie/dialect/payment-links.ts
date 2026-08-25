import type {
	BillingProviderCreatePaymentLinkInput,
	BillingProviderGetResourceInput,
	BillingProviderUpdatePaymentLinkInput,
} from "../../types.ts";

export function mapCreatePaymentLinkToMollieSdk(input: {
	input: BillingProviderCreatePaymentLinkInput;
	idempotencyKey: string;
}): Record<string, unknown> {
	const paymentLinkRequest: Record<string, unknown> = {
		amount: input.input.amount,
		description: input.input.description,
	};
	if (input.input.redirectUrl != null) {
		paymentLinkRequest.redirectUrl = input.input.redirectUrl;
	}
	return {
		idempotencyKey: input.idempotencyKey,
		paymentLinkRequest,
	};
}

export function mapGetPaymentLinkToMollieSdk(
	input: BillingProviderGetResourceInput,
): Record<string, unknown> {
	return { paymentLinkId: input.id };
}

export function mapUpdatePaymentLinkToMollieSdk(
	input: BillingProviderUpdatePaymentLinkInput,
): Record<string, unknown> {
	const paymentLinkRequest: Record<string, unknown> = {};
	if (input.description != null) {
		paymentLinkRequest.description = input.description;
	}
	return {
		paymentLinkId: input.id,
		paymentLinkRequest,
	};
}
