import { createMollieProviderRequestError } from "../errors.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

function statusFrom(error: unknown): number | undefined {
	if (!isRecord(error)) {
		return undefined;
	}
	if (typeof error.statusCode === "number") {
		return error.statusCode;
	}
	if (typeof error.status === "number") {
		return error.status;
	}
	const httpMeta = error.httpMeta;
	if (isRecord(httpMeta) && isRecord(httpMeta.response)) {
		const status = httpMeta.response.status;
		if (typeof status === "number") {
			return status;
		}
	}
	return undefined;
}

function bodyFrom(error: unknown): unknown {
	if (!isRecord(error)) {
		return undefined;
	}
	return error.body ?? error.data ?? error.rawBody;
}

export function normalizeMollieSdkError(input: {
	error: unknown;
	operation: string;
	idempotencyKeyPresent?: boolean;
}): never {
	const { error, operation } = input;
	if (error instanceof Error && error.name === "AbortError") {
		throw createMollieProviderRequestError({
			fallbackMessage: `Mollie ${operation} was aborted.`,
			idempotencyKeyPresent: input.idempotencyKeyPresent,
			kind: "timeout",
			operation,
			requestDispatchState: "unknown",
		});
	}
	const status = statusFrom(error);
	const body = bodyFrom(error);
	const message =
		error instanceof Error ? error.message : `Mollie ${operation} failed.`;
	const kind =
		status == null &&
		error instanceof Error &&
		/network|fetch|ECONN|ENOTFOUND|ETIMEDOUT/i.test(error.message)
			? "network"
			: undefined;
	throw createMollieProviderRequestError({
		body,
		fallbackMessage: message,
		idempotencyKeyPresent: input.idempotencyKeyPresent,
		kind,
		operation,
		requestDispatchState:
			kind === "network" || status == null ? "unknown" : "dispatched",
		status,
	});
}
