import { assertBillingIdempotencyKey } from "./idempotency.ts";
import { assertBillingMoney, normalizeBillingMoney } from "./money.ts";
import type { BillingOperationSafetyProfile } from "./types.ts";
import type { BillingOperation } from "../runtime/capabilities.ts";
import type { BillingMoney } from "../types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

function requiredNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`ATHENA_BILLING_FIELD_REQUIRED:${field}`);
	}
	return value;
}

function requiredMoney(value: unknown): BillingMoney {
	return assertBillingMoney(value);
}

export function validateBillingOperationPayload(input: {
	deferIdempotency?: boolean;
	operation: BillingOperation;
	payload: unknown;
	profile: BillingOperationSafetyProfile;
}): Record<string, unknown> {
	if (!isRecord(input.payload)) {
		throw new Error("ATHENA_BILLING_PAYLOAD_INVALID");
	}
	const next: Record<string, unknown> = { ...input.payload };
	if (input.profile.money === "required") {
		next.amount = requiredMoney(next.amount);
	} else if (next.amount != null) {
		next.amount = normalizeBillingMoney(next.amount);
	}
	switch (input.operation) {
		case "refunds.create":
			requiredNonEmptyString(next.paymentId, "paymentId");
			break;
		case "paymentLinks.create":
			requiredNonEmptyString(next.description, "description");
			break;
		case "subscriptions.create":
			requiredNonEmptyString(next.customerId, "customerId");
			requiredNonEmptyString(next.interval, "interval");
			requiredNonEmptyString(next.description, "description");
			break;
		default:
			break;
	}
	if (
		input.profile.idempotency === "required_caller_owned" &&
		input.deferIdempotency !== true
	) {
		assertBillingIdempotencyKey(next.idempotencyKey);
	}
	return next;
}
