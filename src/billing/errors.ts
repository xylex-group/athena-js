export class AthenaBillingError extends Error {
	status: number;
	endpoint: string;
	method: string;
	body: unknown;

	constructor(input: {
		message: string;
		status: number;
		endpoint: string;
		method: string;
		body: unknown;
	}) {
		super(input.message);
		this.name = "AthenaBillingError";
		this.status = input.status;
		this.endpoint = input.endpoint;
		this.method = input.method;
		this.body = input.body;
	}
}

export const ATHENA_BILLING_OPERATION_UNAVAILABLE =
	"ATHENA_BILLING_OPERATION_UNAVAILABLE" as const;

export const ATHENA_BILLING_AUTHORIZATION_DENIED =
	"ATHENA_BILLING_AUTHORIZATION_DENIED" as const;

export const ATHENA_BILLING_LOCAL_RUNTIME_SERVER_REQUIRED =
	"ATHENA_BILLING_LOCAL_RUNTIME_SERVER_REQUIRED" as const;

export const ATHENA_BILLING_PROVIDER_NOT_CONFIGURED =
	"ATHENA_BILLING_PROVIDER_NOT_CONFIGURED" as const;

export const ATHENA_BILLING_PROVIDER_NOT_REGISTERED =
	"ATHENA_BILLING_PROVIDER_NOT_REGISTERED" as const;

export const ATHENA_BILLING_TARGET_AMBIGUOUS =
	"ATHENA_BILLING_TARGET_AMBIGUOUS" as const;

export const ATHENA_BILLING_PROVIDER_CONFIG_INVALID =
	"ATHENA_BILLING_PROVIDER_CONFIG_INVALID" as const;

export const ATHENA_BILLING_PROVIDER_SERVER_REQUIRED =
	"ATHENA_BILLING_PROVIDER_SERVER_REQUIRED" as const;

export const ATHENA_BILLING_PROVIDER_SDK_REQUIRED =
	"ATHENA_BILLING_PROVIDER_SDK_REQUIRED" as const;

export const ATHENA_BILLING_CONFIG_CONFLICT =
"ATHENA_BILLING_CONFIG_CONFLICT" as const;

export const ATHENA_BILLING_CREDENTIAL_UNAVAILABLE =
	"ATHENA_BILLING_CREDENTIAL_UNAVAILABLE" as const;

export const ATHENA_BILLING_CREDENTIAL_ENVIRONMENT_MISMATCH =
	"ATHENA_BILLING_CREDENTIAL_ENVIRONMENT_MISMATCH" as const;

export const ATHENA_BILLING_CREDENTIAL_INVALID =
	"ATHENA_BILLING_CREDENTIAL_INVALID" as const;

export type AthenaBillingProviderErrorCode =
	| typeof ATHENA_BILLING_PROVIDER_NOT_CONFIGURED
	| typeof ATHENA_BILLING_PROVIDER_NOT_REGISTERED
	| typeof ATHENA_BILLING_TARGET_AMBIGUOUS
	| typeof ATHENA_BILLING_PROVIDER_CONFIG_INVALID
	| typeof ATHENA_BILLING_PROVIDER_SERVER_REQUIRED
	| typeof ATHENA_BILLING_PROVIDER_SDK_REQUIRED
	| typeof ATHENA_BILLING_LOCAL_RUNTIME_SERVER_REQUIRED
	| typeof ATHENA_BILLING_CONFIG_CONFLICT;

export type BillingProviderErrorKind =
	| "authentication"
	| "authorization"
	| "invalid_request"
	| "not_found"
	| "conflict"
	| "idempotency_conflict"
	| "rate_limited"
	| "provider_unavailable"
	| "network"
	| "timeout"
	| "signature_invalid"
	| "unsupported_operation"
	| "unsupported_currency"
	| "unsupported_payment_method"
	| "customer_action_required"
	| "payment_declined"
	| "resource_state_conflict"
	| "serialization"
	| "unknown";

export type BillingRetryDisposition =
	| "never"
	| "safe"
	| "reconcile_first"
	| "customer_action_required";

export type AthenaBillingCredentialErrorCode =
	| typeof ATHENA_BILLING_CREDENTIAL_UNAVAILABLE
	| typeof ATHENA_BILLING_CREDENTIAL_ENVIRONMENT_MISMATCH
	| typeof ATHENA_BILLING_CREDENTIAL_INVALID;

export class AthenaBillingCredentialError extends Error {
	readonly provider: string;
	readonly environment: "test" | "live";
	readonly code: AthenaBillingCredentialErrorCode;

	constructor(input: {
		code: AthenaBillingCredentialErrorCode;
		message: string;
		provider: string;
		environment: "test" | "live";
	}) {
		super(input.message);
		this.name = "AthenaBillingCredentialError";
		this.code = input.code;
		this.provider = input.provider;
		this.environment = input.environment;
	}
}

export function isAthenaBillingCredentialError(
	error: unknown,
): error is AthenaBillingCredentialError {
	return error instanceof AthenaBillingCredentialError;
}

export class AthenaBillingProviderError extends Error {
	readonly code: AthenaBillingProviderErrorCode;

	constructor(input: {
		code: AthenaBillingProviderErrorCode;
		message: string;
	}) {
		super(input.message);
		this.name = "AthenaBillingProviderError";
		this.code = input.code;
	}
}

export function isAthenaBillingProviderError(
	error: unknown,
): error is AthenaBillingProviderError {
	return error instanceof AthenaBillingProviderError;
}

export type AthenaBillingCapabilityErrorCode =
	typeof ATHENA_BILLING_OPERATION_UNAVAILABLE;

export class AthenaBillingAuthorizationError extends Error {
	readonly code: typeof ATHENA_BILLING_AUTHORIZATION_DENIED;
	readonly errorNumber: number;
	readonly missing: readonly string[];
	readonly operation: string;
	readonly status: number;

	constructor(input: {
		missing: readonly string[];
		operation: string;
	}) {
		super(
			`Billing operation ${input.operation} denied (missing ${input.missing.join(", ")})`,
		);
		this.name = "AthenaBillingAuthorizationError";
		this.code = ATHENA_BILLING_AUTHORIZATION_DENIED;
		this.errorNumber = 4014;
		this.missing = input.missing;
		this.operation = input.operation;
		this.status = 403;
	}
}

export function isAthenaBillingAuthorizationError(
	error: unknown,
): error is AthenaBillingAuthorizationError {
	return error instanceof AthenaBillingAuthorizationError;
}

export class AthenaBillingCapabilityError extends Error {
	readonly code: AthenaBillingCapabilityErrorCode;
	readonly operation: string;
	readonly reason: string;

	constructor(input: {
		message?: string;
		operation: string;
		reason: string;
	}) {
		super(
			input.message ??
				`Billing operation ${input.operation} is unavailable (${input.reason})`,
		);
		this.name = "AthenaBillingCapabilityError";
		this.code = ATHENA_BILLING_OPERATION_UNAVAILABLE;
		this.operation = input.operation;
		this.reason = input.reason;
	}
}

export function isAthenaBillingCapabilityError(
	error: unknown,
): error is AthenaBillingCapabilityError {
	return error instanceof AthenaBillingCapabilityError;
}

export class AthenaBillingProviderRequestError extends Error {
	readonly provider: string;
	readonly kind: BillingProviderErrorKind;
	readonly retry: BillingRetryDisposition;
	readonly operation?: string;
	readonly status?: number;
	readonly details?: unknown;

	constructor(input: {
		message: string;
		provider: string;
		kind: BillingProviderErrorKind;
		retry: BillingRetryDisposition;
		operation?: string;
		status?: number;
		details?: unknown;
	}) {
		super(input.message);
		this.name = "AthenaBillingProviderRequestError";
		this.provider = input.provider;
		this.kind = input.kind;
		this.retry = input.retry;
		this.operation = input.operation;
		this.status = input.status;
		this.details = input.details;
	}

	toJSON(): Record<string, unknown> {
		return {
			details: this.details,
			kind: this.kind,
			message: this.message,
			name: this.name,
			operation: this.operation,
			provider: this.provider,
			retry: this.retry,
			status: this.status,
		};
	}
}

export function isAthenaBillingProviderRequestError(
	error: unknown,
): error is AthenaBillingProviderRequestError {
	return error instanceof AthenaBillingProviderRequestError;
}

export function billingProviderErrorKindFromHttp(input: {
	status?: number;
	key?: string;
	detail?: string;
}): BillingProviderErrorKind {
	const key = input.key?.trim().toLowerCase();
	if (key === "authentication" || key === "unauthorized") {
		return "authentication";
	}
	if (key === "forbidden") {
		return "authorization";
	}
	if (key === "not_found") {
		return "not_found";
	}
	if (key === "conflict") {
		return "conflict";
	}
	if (key === "idempotency_conflict") {
		return "idempotency_conflict";
	}
	if (key === "rate_limited") {
		return "rate_limited";
	}
	if (key === "validation_error" || key === "unprocessable_entity") {
		return "invalid_request";
	}
	if (key === "payment_declined") {
		return "payment_declined";
	}
	if (key === "customer_action_required") {
		return "customer_action_required";
	}
	if (input.status === 401) {
		return "authentication";
	}
	if (input.status === 403) {
		return "authorization";
	}
	if (input.status === 404) {
		return "not_found";
	}
	if (input.status === 409) {
		return "conflict";
	}
	if (input.status === 422) {
		return "invalid_request";
	}
	if (input.status === 429) {
		return "rate_limited";
	}
	if (input.status != null && input.status >= 500 && input.status <= 599) {
		return "provider_unavailable";
	}
	const detail = (input.detail ?? "").toLowerCase();
	if (detail.includes("timeout")) {
		return "timeout";
	}
	if (detail.includes("declined")) {
		return "payment_declined";
	}
	return "unknown";
}
