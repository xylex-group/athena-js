import { createMollieProviderRequestError } from "../errors.ts";
import {
	MOLLIE_SDK_INVOICE_REQUIRED_METHODS,
	MOLLIE_SDK_REQUIRED_METHODS,
	MOLLIE_SDK_REQUIRED_RESOURCES,
	type MollieSdkClient,
} from "./contracts.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

function hasResourcePort(value: unknown): value is Record<string, unknown> {
	return isRecord(value);
}

function hasFunctionMethod(resource: Record<string, unknown>, method: string): boolean {
	return typeof resource[method] === "function";
}

function assertRequiredMethods(
	resource: Record<string, unknown>,
	label: string,
	methods: readonly string[],
	operation: string,
): void {
	for (const method of methods) {
		if (!hasFunctionMethod(resource, method)) {
			throw createMollieProviderRequestError({
				fallbackMessage: `Injected Mollie SDK is missing ${label}.${method} for ${operation}.`,
				kind: "unsupported_operation",
				operation,
			});
		}
	}
}

export function assertMollieSdkClient(
	client: unknown,
	operation: string,
): MollieSdkClient {
	if (!isRecord(client)) {
		throw createMollieProviderRequestError({
			fallbackMessage: `Injected Mollie SDK is not an object for ${operation}.`,
			kind: "unsupported_operation",
			operation,
		});
	}
	for (const name of MOLLIE_SDK_REQUIRED_RESOURCES) {
		const resource = client[name];
		if (!hasResourcePort(resource)) {
			throw createMollieProviderRequestError({
				fallbackMessage: `Injected Mollie SDK is missing ${name} for ${operation}.`,
				kind: "unsupported_operation",
				operation,
			});
		}
		assertRequiredMethods(
			resource,
			name,
			MOLLIE_SDK_REQUIRED_METHODS[name],
			operation,
		);
	}
	const invoiceResource = hasResourcePort(client.salesInvoices)
		? client.salesInvoices
		: hasResourcePort(client.invoices)
			? client.invoices
			: null;
	if (invoiceResource == null) {
		throw createMollieProviderRequestError({
			fallbackMessage: `Injected Mollie SDK is missing invoices or salesInvoices for ${operation}.`,
			kind: "unsupported_operation",
			operation,
		});
	}
	assertRequiredMethods(
		invoiceResource,
		hasResourcePort(client.salesInvoices) ? "salesInvoices" : "invoices",
		MOLLIE_SDK_INVOICE_REQUIRED_METHODS,
		operation,
	);
	return client as unknown as MollieSdkClient;
}
