import {
	AthenaBillingProviderRequestError,
	billingProviderErrorKindFromHttp,
} from "../../../../errors.ts";
import type { BillingProviderErrorKind } from "../../../../errors.ts";
import type { BillingOperation } from "../../../capabilities.ts";
import { BILLING_OPERATION_SAFETY } from "../../../../safety/registry.ts";
import { billingRetryDisposition } from "../../../../safety/retry.ts";
import type { BillingRequestDispatchState } from "../../../../safety/types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value
		: undefined;
}

function sanitizeDetails(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => sanitizeDetails(entry));
	}
	if (!isRecord(value)) {
		return value;
	}
	const next: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		const normalized = key.toLowerCase();
		if (
			normalized.includes("authorization") ||
			normalized.includes("api_key") ||
			normalized.includes("apikey") ||
			normalized.includes("secret") ||
			normalized.includes("token") ||
			normalized.includes("password")
		) {
			next[key] = "[REDACTED]";
			continue;
		}
		next[key] = sanitizeDetails(entry);
	}
	return next;
}

function isBillingOperation(operation: string): operation is BillingOperation {
	return Object.hasOwn(BILLING_OPERATION_SAFETY, operation);
}

function asBillingOperation(operation?: string): BillingOperation {
	if (operation != null && isBillingOperation(operation)) {
		return operation;
	}
	return "payments.get";
}

function inferDispatchState(
	kind: BillingProviderErrorKind,
	explicit?: BillingRequestDispatchState,
): BillingRequestDispatchState {
	if (explicit != null) {
		return explicit;
	}
	switch (kind) {
		case "network":
		case "timeout":
		case "provider_unavailable":
			return "unknown";
		case "serialization":
			return "dispatched";
		default:
			return "not_dispatched";
	}
}

export function createMollieProviderRequestError(input: {
	status?: number;
	body?: unknown;
	operation?: string;
	fallbackMessage: string;
	kind?: BillingProviderErrorKind;
	idempotencyKeyPresent?: boolean;
	requestDispatchState?: BillingRequestDispatchState;
}): AthenaBillingProviderRequestError {
	const body = isRecord(input.body) ? input.body : undefined;
	const detail =
		asString(body?.detail) ??
		asString(body?.title) ??
		input.fallbackMessage;
	const kind =
		input.kind ??
		billingProviderErrorKindFromHttp({
			detail,
			key: asString(body?.type) ?? asString(body?.title),
			status: input.status,
		});
	const operation = asBillingOperation(input.operation);
	return new AthenaBillingProviderRequestError({
		details: sanitizeDetails(body ?? {}),
		kind,
		message: detail,
		operation: input.operation,
		provider: "mollie",
		retry: billingRetryDisposition({
			idempotencyKeyPresent: input.idempotencyKeyPresent === true,
			kind,
			operation,
			requestDispatchState: inferDispatchState(
				kind,
				input.requestDispatchState,
			),
		}),
		status: input.status,
	});
}
