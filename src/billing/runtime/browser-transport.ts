import { DEFAULT_ATHENA_NEXT_BILLING_ENDPOINT } from "../../runtime/data/discovery-document.ts";
import type {
	BillingCustomerPort,
	BillingInvoicePort,
	BillingPaymentLinkPort,
	BillingPaymentPort,
	BillingRefundPort,
	BillingSubscriptionPort,
} from "./types.ts";
import type { BillingCapabilities } from "./capabilities.ts";
import type { BillingExecutionTarget } from "../types.ts";

export function resolveBrowserBillingEndpoint(
	endpoints?: { billing?: string },
): string {
	const advertised = endpoints?.billing?.trim();
	return advertised || DEFAULT_ATHENA_NEXT_BILLING_ENDPOINT;
}

export function createBrowserBillingTransport(options?: {
	baseUrl?: string;
	endpoints?: { billing?: string };
	fetch?: typeof fetch;
	headers?: Record<string, string>;
}): {
	customers: BillingCustomerPort;
	getCapabilities: (
		input: BillingExecutionTarget,
	) => Promise<BillingCapabilities>;
	invoices: BillingInvoicePort;
	paymentLinks: BillingPaymentLinkPort;
	payments: BillingPaymentPort;
	refunds: BillingRefundPort;
	subscriptions: BillingSubscriptionPort;
} {
	const fetchImpl = options?.fetch ?? fetch;
	const extraHeaders = options?.headers ?? {};
	const root = options?.baseUrl?.replace(/\/+$/, "") ?? "";
	const explicit = options?.endpoints?.billing?.trim();
	let resolved:
		| { kind: "path"; path: string }
		| { kind: "absolute"; url: string }
		| { kind: "missing" }
		| undefined = explicit
		? parseEndpoint(explicit)
		: undefined;

	function joinPath(path: string): string {
		if (/^https?:\/\//i.test(path)) {
			return path;
		}
		const prefixed = path.startsWith("/") ? path : `/${path}`;
		if (root) {
			return `${root}${prefixed}`;
		}
		const origin =
			(globalThis as { location?: { origin?: string } }).location?.origin ??
			(
				globalThis as { window?: { location?: { origin?: string } } }
			).window?.location?.origin;
		if (origin) {
			return `${origin.replace(/\/+$/, "")}${prefixed}`;
		}
		return `http://localhost${prefixed}`;
	}

	async function resolveUrl(): Promise<string> {
		if (resolved?.kind === "missing") {
			throw new Error("billing runtime is not configured");
		}
		if (resolved?.kind === "absolute") {
			return resolved.url;
		}
		if (resolved?.kind === "path") {
			return joinPath(resolved.path);
		}
		const fallback = DEFAULT_ATHENA_NEXT_BILLING_ENDPOINT;
		const probe = joinPath(fallback);
		const response = await fetchImpl(probe, {
			credentials: "same-origin",
			headers: {
				accept: "application/json",
				...extraHeaders,
			},
			method: "GET",
		});
		const json = (await response.json().catch(() => undefined)) as
			| { endpoints?: { billing?: string } }
			| undefined;
		const advertised = json?.endpoints?.billing?.trim();
		if (advertised) {
			resolved = parseEndpoint(advertised);
			return resolveUrl();
		}
		if (response.ok && json && json.endpoints && json.endpoints.billing == null) {
			resolved = { kind: "missing" };
			throw new Error("billing runtime is not configured");
		}
		resolved = { kind: "path", path: fallback };
		return probe;
	}

	async function call(operation: string, payload: unknown): Promise<unknown> {
		const url = await resolveUrl();
		const response = await fetchImpl(url, {
			body: JSON.stringify({ operation, payload }),
			credentials: "same-origin",
			headers: {
				"content-type": "application/json",
				...extraHeaders,
			},
			method: "POST",
		});
		const json = (await response.json().catch(() => undefined)) as
			| { data?: unknown; error?: { message?: string; code?: string }; ok?: boolean }
			| undefined;
		if (!response.ok || json?.ok === false) {
			throw new Error(
				json?.error?.message ?? `billing ${operation} failed (${response.status})`,
			);
		}
		return json?.data;
	}

	const payments: BillingPaymentPort = {
		cancel: (input) => call("payments.cancel", input) as never,
		create: (input) => call("payments.create", input) as never,
		get: (input) => call("payments.get", input) as never,
		list: (input) => call("payments.list", input) as never,
	};
	const customers: BillingCustomerPort = {
		create: (input) => call("customers.create", input) as never,
		delete: (input) => call("customers.delete", input) as never,
		get: (input) => call("customers.get", input) as never,
		list: (input) => call("customers.list", input) as never,
		update: (input) => call("customers.update", input) as never,
	};
	const refunds: BillingRefundPort = {
		cancel: (input) => call("refunds.cancel", input) as never,
		create: (input) => call("refunds.create", input) as never,
		get: (input) => call("refunds.get", input) as never,
		list: (input) => call("refunds.list", input) as never,
	};
	const paymentLinks: BillingPaymentLinkPort = {
		create: (input) => call("paymentLinks.create", input) as never,
		delete: (input) => call("paymentLinks.delete", input) as never,
		get: (input) => call("paymentLinks.get", input) as never,
		list: (input) => call("paymentLinks.list", input) as never,
		update: (input) => call("paymentLinks.update", input) as never,
	};
	const subscriptions: BillingSubscriptionPort = {
		cancel: (input) => call("subscriptions.cancel", input) as never,
		create: (input) => call("subscriptions.create", input) as never,
		get: (input) => call("subscriptions.get", input) as never,
		list: (input) => call("subscriptions.list", input) as never,
		update: (input) => call("subscriptions.update", input) as never,
	};
	const invoices: BillingInvoicePort = {
		get: (input) => call("invoices.get", input) as never,
		list: (input) => call("invoices.list", input) as never,
	};

	return {
		customers,
		getCapabilities: (input) =>
			call("getCapabilities", input) as Promise<BillingCapabilities>,
		invoices,
		paymentLinks,
		payments,
		refunds,
		subscriptions,
	};
}

function parseEndpoint(
	value: string,
): { kind: "path"; path: string } | { kind: "absolute"; url: string } {
	if (/^https?:\/\//i.test(value)) {
		return { kind: "absolute", url: value };
	}
	return { kind: "path", path: value };
}
