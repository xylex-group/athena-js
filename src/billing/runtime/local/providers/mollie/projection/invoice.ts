import { AthenaBillingProviderRequestError } from "../../../../../errors.ts";
import { normalizeBillingMoney } from "../../../../../safety/money.ts";
import { billingRetryDisposition } from "../../../../../safety/retry.ts";
import type {
	BillingInvoice,
	BillingInvoiceStatus,
	BillingMoney,
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
		operation: "invoices.get",
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

export function projectMollieInvoiceStatus(
	status: string,
): BillingInvoiceStatus {
	if (status === "draft") {
		return "draft";
	}
	if (
		status === "issuing" ||
		status === "issued" ||
		status === "open" ||
		status === "pending-payment"
	) {
		return "open";
	}
	if (status === "paid") {
		return "paid";
	}
	if (status === "cancelled" || status === "canceled") {
		return "void";
	}
	if (status === "failed") {
		return "uncollectible";
	}
	throw new AthenaBillingProviderRequestError({
		kind: "serialization",
		message: `Mollie invoice status "${status}" is not supported.`,
		provider: "mollie",
		retry: serializationRetry(),
	});
}

export function projectMollieInvoice(raw: unknown): BillingInvoice {
	if (!isRecord(raw) || typeof raw.id !== "string") {
		throw new AthenaBillingProviderRequestError({
			kind: "serialization",
			message: "Mollie invoice response is missing an invoice id.",
			provider: "mollie",
			retry: serializationRetry(),
		});
	}
	const status =
		typeof raw.status === "string"
			? projectMollieInvoiceStatus(raw.status)
			: projectMollieInvoiceStatus("");
	return {
		amount: projectMoney(raw.totalAmount) ?? null,
		amountPaid: projectMoney(raw.amountPaid) ?? null,
		createdAt: optionalString(raw.createdAt),
		description: optionalString(raw.description),
		issuedAt: optionalString(raw.issuedAt),
		metadata: raw.metadata,
		paidAt: optionalString(raw.paidAt),
		provider: "mollie",
		providerCustomerId: optionalString(raw.customerId),
		providerInvoiceId: raw.id,
		providerProfileId: optionalString(raw.profileId),
		raw,
		status,
	};
}
