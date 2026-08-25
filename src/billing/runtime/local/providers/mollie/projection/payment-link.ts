import { AthenaBillingProviderRequestError } from "../../../../../errors.ts";
import { normalizeBillingMoney } from "../../../../../safety/money.ts";
import { billingRetryDisposition } from "../../../../../safety/retry.ts";
import type {
	BillingMoney,
	BillingPaymentLink,
	BillingPaymentLinkStatus,
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
		operation: "paymentLinks.get",
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

function hrefFromLinks(raw: Record<string, unknown>, key: string): string | null {
	const groups = [raw._links, raw.links];
	for (const group of groups) {
		if (!isRecord(group)) {
			continue;
		}
		const link = group[key];
		if (isRecord(link) && typeof link.href === "string") {
			return link.href;
		}
	}
	return null;
}

export function projectMolliePaymentLinkStatus(input: {
	archived?: unknown;
	paidAt?: unknown;
}): BillingPaymentLinkStatus {
	if (input.archived === true) {
		return "canceled";
	}
	if (typeof input.paidAt === "string" && input.paidAt.length > 0) {
		return "paid";
	}
	return "open";
}

export function projectMolliePaymentLink(raw: unknown): BillingPaymentLink {
	if (!isRecord(raw) || typeof raw.id !== "string") {
		throw new AthenaBillingProviderRequestError({
			kind: "serialization",
			message: "Mollie payment link response is missing a payment link id.",
			provider: "mollie",
			retry: serializationRetry(),
		});
	}
	return {
		amount: projectMoney(raw.amount) ?? null,
		checkoutUrl: hrefFromLinks(raw, "paymentLink"),
		description: optionalString(raw.description),
		metadata: raw.metadata,
		provider: "mollie",
		providerPaymentLinkId: raw.id,
		raw,
		status: projectMolliePaymentLinkStatus({
			archived: raw.archived,
			paidAt: raw.paidAt,
		}),
	};
}
