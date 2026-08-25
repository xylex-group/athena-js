import { AthenaBillingProviderRequestError } from "../../../../../errors.ts";
import { normalizeBillingMoney } from "../../../../../safety/money.ts";
import { billingRetryDisposition } from "../../../../../safety/retry.ts";
import type {
	BillingMoney,
	BillingSubscription,
	BillingSubscriptionStatus,
} from "../../../../../types.ts";

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

function serializationRetry() {
	return billingRetryDisposition({
		idempotencyKeyPresent: false,
		kind: "serialization",
		operation: "subscriptions.get",
		requestDispatchState: "dispatched",
	});
}

function projectMoney(value: unknown): BillingMoney | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	if (typeof value.currency !== "string" || typeof value.value !== "string") {
		return undefined;
	}
	try {
		return normalizeBillingMoney(value);
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: "ATHENA_BILLING_MONEY_INVALID";
		throw new AthenaBillingProviderRequestError({
			kind: "serialization",
			message,
			provider: "mollie",
			retry: serializationRetry(),
		});
	}
}

export function projectMollieSubscriptionStatus(
	status: string,
): BillingSubscriptionStatus {
	if (status === "pending") {
		return "trialing";
	}
	if (status === "active") {
		return "active";
	}
	if (status === "canceled" || status === "completed") {
		return "canceled";
	}
	if (status === "suspended") {
		return "past_due";
	}
	throw new AthenaBillingProviderRequestError({
		kind: "serialization",
		message: `Mollie subscription status "${status}" is not supported.`,
		provider: "mollie",
		retry: serializationRetry(),
	});
}

export function projectMollieSubscription(raw: unknown): BillingSubscription {
	if (!isRecord(raw) || typeof raw.id !== "string") {
		throw new AthenaBillingProviderRequestError({
			kind: "serialization",
			message: "Mollie subscription response is missing a subscription id.",
			provider: "mollie",
			retry: serializationRetry(),
		});
	}
	if (typeof raw.customerId !== "string") {
		throw new AthenaBillingProviderRequestError({
			kind: "serialization",
			message: "Mollie subscription response is missing a customer id.",
			provider: "mollie",
			retry: serializationRetry(),
		});
	}
	const status =
		typeof raw.status === "string"
			? projectMollieSubscriptionStatus(raw.status)
			: projectMollieSubscriptionStatus("");
	const amount = projectMoney(raw.amount);
	return {
		amount: amount ?? null,
		canceledAt: optionalString(raw.canceledAt),
		createdAt: optionalString(raw.createdAt),
		currency: amount?.currency ?? null,
		description: optionalString(raw.description),
		interval: optionalString(raw.interval),
		metadata: raw.metadata,
		nextPaymentDate: optionalString(raw.nextPaymentDate),
		provider: "mollie",
		providerCustomerId: raw.customerId,
		providerProfileId: optionalString(raw.profileId),
		providerSubscriptionId: raw.id,
		raw,
		status,
	};
}
