import { AthenaBillingProviderRequestError } from "../../../../../errors.ts";
import { billingRetryDisposition } from "../../../../../safety/retry.ts";
import type { BillingCustomer } from "../../../../../types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | null | undefined {
	if (value == null) {
		return value === undefined ? undefined : null;
	}
	if (typeof value === "string") {
		return value;
	}
	return undefined;
}

export function projectMollieCustomer(raw: unknown): BillingCustomer {
	if (!isRecord(raw) || typeof raw.id !== "string") {
		throw new AthenaBillingProviderRequestError({
			kind: "serialization",
			message: "Mollie customer response is missing a customer id.",
			provider: "mollie",
			retry: billingRetryDisposition({
			idempotencyKeyPresent: false,
			kind: "serialization",
			operation: "customers.get",
			requestDispatchState: "dispatched",
		}),
		});
	}
	return {
		email: optionalString(raw.email),
		metadata: raw.metadata,
		name: optionalString(raw.name),
		provider: "mollie",
		providerCustomerId: raw.id,
		raw,
	};
}
