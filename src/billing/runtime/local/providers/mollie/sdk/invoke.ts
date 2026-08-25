import { createMollieProviderRequestError } from "../errors.ts";
import { normalizeMollieSdkError } from "./errors.ts";
import type { MollieSdkResourceClient } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

function assertMollieSdkPayload(value: unknown, operation: string): unknown {
	if (value === undefined) {
		return undefined;
	}
	if (!isRecord(value) && !Array.isArray(value)) {
		throw createMollieProviderRequestError({
			fallbackMessage: `Mollie ${operation} returned a non-object body.`,
			kind: "serialization",
			operation,
		});
	}
	return value;
}

export async function invokeMollieSdk<T>(input: {
	invoke: () => Promise<T>;
	operation: string;
	idempotencyKeyPresent?: boolean;
}): Promise<T> {
	try {
		const result = await input.invoke();
		return assertMollieSdkPayload(result, input.operation) as T;
	} catch (error) {
		if (
			error instanceof Error &&
			error.name === "AthenaBillingProviderRequestError"
		) {
			throw error;
		}
		normalizeMollieSdkError({
			error,
			idempotencyKeyPresent: input.idempotencyKeyPresent,
			operation: input.operation,
		});
		throw new Error("ATHENA_BILLING_MOLLIE_SDK_ERROR_UNREACHABLE");
	}
}

export function requireMollieSdkResource(
	client: MollieSdkResourceClient,
	name: keyof MollieSdkResourceClient,
	operation: string,
): NonNullable<MollieSdkResourceClient[typeof name]> {
	const resource = client[name];
	if (resource == null || typeof resource !== "object") {
		throw createMollieProviderRequestError({
			fallbackMessage: `Injected Mollie SDK is missing ${String(name)} for ${operation}.`,
			kind: "unsupported_operation",
			operation,
		});
	}
	return resource;
}

export function requireMollieSdkMethod(
	resource: Record<string, unknown>,
	method: string,
	operation: string,
): (request: Record<string, unknown>) => Promise<unknown> {
	const fn = resource[method];
	if (typeof fn !== "function") {
		throw createMollieProviderRequestError({
			fallbackMessage: `Injected Mollie SDK is missing ${method} for ${operation}.`,
			kind: "unsupported_operation",
			operation,
		});
	}
	return fn.bind(resource) as (
		request: Record<string, unknown>,
	) => Promise<unknown>;
}

export function asMollieSdkClient(client: object): MollieSdkResourceClient {
	return client as MollieSdkResourceClient;
}

export function unwrapMollieSdkEntity(value: unknown): unknown {
	if (!isRecord(value)) {
		return value;
	}
	if (isRecord(value.result)) {
		return value.result;
	}
	if (isRecord(value.data)) {
		return value.data;
	}
	return value;
}
