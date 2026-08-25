import { FetchMollieSdk } from "../helpers/fetch-mollie-sdk.ts";
/**
 * Target — local Mollie invoices and remaining refund identity.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { AthenaBillingCapabilityError } from "../../src/billing/errors.ts";
import { createClient } from "../../src/v3-client.ts";

const TEST_TOKEN = "access_athena_mollie_invoices_test";
const LIVE_TOKEN = "access_athena_mollie_invoices_live";
const PROFILE_ID = "pfl_local_1";

const invoiceProvider = {
	sdk: FetchMollieSdk,
	authority: {
		permissions: {
			refunds: { read: true, write: true },
			"sales-invoices": { read: true },
			subscriptions: { read: true, write: true },
		},
		source: "declared" as const,
	},
	credentialKind: "organization_access_token" as const,
	liveToken: LIVE_TOKEN,
	profileId: PROFILE_ID,
	testToken: TEST_TOKEN,
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		status,
	});
}

function mollieInvoicePayload(overrides: Record<string, unknown> = {}) {
	return {
		amountPaid: { currency: "EUR", value: "0.00" },
		createdAt: "2026-08-23T12:00:00+00:00",
		customerId: "cst_local_1",
		description: "August invoice",
		id: "invoice_local_1",
		issuedAt: "2026-08-23T12:00:00+00:00",
		metadata: {},
		paidAt: null,
		profileId: "pfl_local_1",
		resource: "sales-invoice",
		status: "open",
		totalAmount: { currency: "EUR", value: "19.99" },
		...overrides,
	};
}

function molliePaymentPayload(overrides: Record<string, unknown> = {}) {
	return {
		amount: { currency: "EUR", value: "10.00" },
		id: "tr_local_1",
		profileId: PROFILE_ID,
		resource: "payment",
		status: "paid",
		...overrides,
	};
}

function mollieRefundPayload(overrides: Record<string, unknown> = {}) {
	return {
		amount: { currency: "EUR", value: "5.00" },
		description: "Partial refund",
		id: "re_local_1",
		metadata: {},
		paymentId: "tr_local_1",
		resource: "refund",
		status: "queued",
		...overrides,
	};
}

async function withMockedFetch<T>(
	handler: typeof fetch,
	run: () => Promise<T>,
): Promise<T> {
	const previous = globalThis.fetch;
	globalThis.fetch = handler;
	try {
		return await run();
	} finally {
		globalThis.fetch = previous;
	}
}

async function createLocalRuntime(testMode = true) {
	const { createLocalBillingRuntime } = await import(
		"../../src/billing/runtime/local/runtime.ts"
	);
	const { createBillingProviderRegistry } = await import(
		"../../src/billing/runtime/local/providers/create-registry.ts"
	);
	const configured = {
		mollie: invoiceProvider,
	};
	return createLocalBillingRuntime({
		configuredProviders: configured,
		registry: createBillingProviderRegistry(configured),
		testMode,
	});
}

test("T-BIL-MOLLIE-INVOICE-GET: canonical invoice", async () => {
	const runtime = await createLocalRuntime();
	const invoice = await withMockedFetch(async (url, init) => {
		assert.equal((init?.method ?? "GET").toUpperCase(), "GET");
		assert.match(
			String(url),
			/\/v2\/sales-invoices\/invoice_local_1(?:\?testmode=true)?$/,
		);
		return jsonResponse(mollieInvoicePayload());
	}, () => runtime.invoices.get({ invoiceId: "invoice_local_1" }));
	assert.equal(invoice.provider, "mollie");
	assert.equal(invoice.providerInvoiceId, "invoice_local_1");
	assert.equal(invoice.providerCustomerId, "cst_local_1");
	assert.equal(invoice.status, "open");
	assert.deepEqual(invoice.amount, { currency: "EUR", value: "19.99" });
});

test("T-BIL-MOLLIE-INVOICE-LIST: canonical page", async () => {
	const runtime = await createLocalRuntime();
	const page = await withMockedFetch(async (url) => {
		assert.match(String(url), /\/v2\/sales-invoices/);
		return jsonResponse({
			_embedded: {
				sales_invoices: [mollieInvoicePayload()],
			},
		});
	}, () => runtime.invoices.list({}));
	assert.equal(page.items[0]?.providerInvoiceId, "invoice_local_1");
	assert.equal(page.items[0]?.status, "open");
});

test("T-BIL-MOLLIE-INVOICE-STATUS: strict status mapping", async () => {
	const { projectMollieInvoiceStatus } = await import(
		"../../src/billing/runtime/local/providers/mollie/projection/invoice.ts"
	);
	const { AthenaBillingProviderRequestError } = await import(
		"../../src/billing/errors.ts"
	);
	assert.equal(projectMollieInvoiceStatus("draft"), "draft");
	assert.equal(projectMollieInvoiceStatus("issuing"), "open");
	assert.equal(projectMollieInvoiceStatus("issued"), "open");
	assert.equal(projectMollieInvoiceStatus("open"), "open");
	assert.equal(projectMollieInvoiceStatus("pending-payment"), "open");
	assert.equal(projectMollieInvoiceStatus("paid"), "paid");
	assert.equal(projectMollieInvoiceStatus("cancelled"), "void");
	assert.equal(projectMollieInvoiceStatus("canceled"), "void");
	assert.equal(projectMollieInvoiceStatus("failed"), "uncollectible");
	assert.throws(
		() => projectMollieInvoiceStatus("mystery"),
		(error: unknown) =>
			error instanceof AthenaBillingProviderRequestError &&
			error.kind === "serialization",
	);
});

test("T-BIL-MOLLIE-INVOICE-STATUS-FIXTURES: get projects Mollie sales-invoice states", async () => {
	const runtime = await createLocalRuntime();
	const cases = [
		["draft", "draft"],
		["issuing", "open"],
		["issued", "open"],
		["pending-payment", "open"],
		["paid", "paid"],
		["failed", "uncollectible"],
		["cancelled", "void"],
	] as const;
	for (const [providerStatus, canonical] of cases) {
		const invoice = await withMockedFetch(
			async () => jsonResponse(mollieInvoicePayload({ status: providerStatus })),
			() => runtime.invoices.get({ invoiceId: "invoice_local_1" }),
		);
		assert.equal(invoice.status, canonical, providerStatus);
	}
});

test("T-BIL-MOLLIE-REFUND-GET: compound identity", async () => {
	const runtime = await createLocalRuntime();
	const refund = await withMockedFetch(async (url, init) => {
		assert.equal((init?.method ?? "GET").toUpperCase(), "GET");
		const href = String(url);
		if (/\/v2\/payments\/tr_local_1(?:\?|$)/.test(href)) {
			return jsonResponse(molliePaymentPayload());
		}
		assert.match(
			href,
			/\/v2\/payments\/tr_local_1\/refunds\/re_local_1(?:\?testmode=true)?$/,
		);
		return jsonResponse(mollieRefundPayload());
	}, () =>
		runtime.refunds.get({
			paymentId: "tr_local_1",
			refundId: "re_local_1",
		}),
	);
	assert.equal(refund.providerRefundId, "re_local_1");
	assert.equal(refund.providerPaymentId, "tr_local_1");
});

test("T-BIL-MOLLIE-REFUND-CANCEL: DELETE 204 then GET reconstructs refund", async () => {
	const runtime = await createLocalRuntime();
	const methods: string[] = [];
	const refund = await withMockedFetch(async (url, init) => {
		const method = (init?.method ?? "GET").toUpperCase();
		const href = String(url);
		if (/\/v2\/payments\/tr_local_1(?:\?|$)/.test(href)) {
			methods.push(`PAYMENT_${method}`);
			return jsonResponse(molliePaymentPayload());
		}
		methods.push(method);
		assert.match(
			href,
			/\/v2\/payments\/tr_local_1\/refunds\/re_local_1(?:\?testmode=true)?$/,
		);
		if (method === "DELETE") {
			return new Response(null, { status: 204 });
		}
		assert.equal(method, "GET");
		return jsonResponse(mollieRefundPayload({ status: "canceled" }));
	}, () =>
		runtime.refunds.cancel({
			paymentId: "tr_local_1",
			refundId: "re_local_1",
		}),
	);
	assert.deepEqual(methods, ["PAYMENT_GET", "DELETE", "PAYMENT_GET", "GET"]);
	assert.equal(refund.status, "canceled");
	assert.equal(refund.providerRefundId, "re_local_1");
	assert.equal(refund.providerPaymentId, "tr_local_1");
});

test("T-BIL-MOLLIE-REFUND-CANCEL-GONE: 204 then GET 404 stays canceled", async () => {
	const runtime = await createLocalRuntime();
	const refund = await withMockedFetch(async (url, init) => {
		const method = (init?.method ?? "GET").toUpperCase();
		if (/\/v2\/payments\/tr_local_1(?:\?|$)/.test(String(url))) {
			return jsonResponse(molliePaymentPayload());
		}
		if (method === "DELETE") {
			return new Response(null, { status: 204 });
		}
		return jsonResponse(
			{
				detail: "No refund exists with token re_local_1.",
				status: 404,
				title: "Not Found",
			},
			404,
		);
	}, () =>
		runtime.refunds.cancel({
			paymentId: "tr_local_1",
			refundId: "re_local_1",
		}),
	);
	assert.equal(refund.status, "canceled");
	assert.equal(refund.provider, "mollie");
	assert.equal(refund.providerRefundId, "re_local_1");
	assert.equal(refund.providerPaymentId, "tr_local_1");
});

test("T-BIL-MOLLIE-CAPS-OPS: operation-level truth", async () => {
	const runtime = await createLocalRuntime();
	const capabilities = await runtime.getCapabilities({ provider: "mollie" });
	assert.deepEqual(capabilities.ports, {
		customers: true,
		invoices: true,
		paymentLinks: true,
		payments: true,
		refunds: true,
		subscriptions: true,
		webhooks: false,
	});
	assert.equal(capabilities.operations["subscriptions.create"]?.available, true);
	assert.equal(capabilities.operations["subscriptions.get"]?.available, true);
	assert.equal(capabilities.operations["subscriptions.list"]?.available, true);
	assert.equal(capabilities.operations["subscriptions.update"]?.available, true);
	assert.equal(capabilities.operations["subscriptions.cancel"]?.available, true);
	assert.equal(capabilities.operations["invoices.get"]?.available, true);
	assert.equal(capabilities.operations["invoices.list"]?.available, true);
	assert.equal(capabilities.operations["refunds.get"]?.available, true);
	assert.equal(capabilities.operations["refunds.cancel"]?.available, true);
	assert.equal(capabilities.operations["webhooks.create"]?.available, false);
	assert.equal(capabilities.operations["webhooks.list"]?.available, false);
});

test("T-BIL-MOLLIE-INVOICE-PROFILE: requested profileId fail-closes without Mollie HTTP", async () => {
	const client = createClient({
		billing: {
			mode: "local",
			providers: {
				mollie: {
					sdk: FetchMollieSdk,
					accessToken: TEST_TOKEN,
					apiMode: "test",
					authority: {
						permissions: { "sales-invoices": { read: true } },
						source: "declared",
					},
					credentialKind: "advanced_access_token",
					scope: { kind: "organization" },
				},
			},
			testMode: true,
		},
		key: "ak_test",
		url: "https://athena.example.com",
	});
	const cases: Array<[string, () => Promise<unknown>]> = [
		[
			"invoices.get",
			() =>
				client.billing.invoices.get({
					invoiceId: "invoice_local_1",
					profileId: "pfl_B",
				}),
		],
		[
			"invoices.list",
			() => client.billing.invoices.list({ profileId: "pfl_B" }),
		],
	];
	for (const [operation, run] of cases) {
		await assert.rejects(
			() =>
				withMockedFetch(async () => {
					throw new Error(`${operation} must not call Mollie`);
				}, run),
			(error: unknown) =>
				error instanceof AthenaBillingCapabilityError &&
				error.operation === operation &&
				error.reason === "unsupported_operation",
			operation,
		);
	}
});

test("T-BIL-MOLLIE-INVOICE-API-KEY: standard keys reach Mollie invoice reads", async () => {
	const client = createClient({
		billing: {
			mode: "local",
			providers: {
				mollie: {
					sdk: FetchMollieSdk,
					credentialKind: "api_key",
					profileId: PROFILE_ID,
					testKey: "test_athena_mollie_invoices",
				},
			},
			testMode: true,
		},
		key: "ak_test",
		url: "https://athena.example.com",
	});
	const capabilities = await client.billing.getCapabilities({
		provider: "mollie",
	});
	assert.equal(capabilities.operations["invoices.get"]?.available, true);
	assert.equal(capabilities.operations["invoices.list"]?.available, true);

	const invoice = await withMockedFetch(async (url, init) => {
		assert.equal((init?.method ?? "GET").toUpperCase(), "GET");
		assert.match(
			String(url),
			/\/v2\/sales-invoices\/invoice_local_1(?:\?testmode=true)?$/,
		);
		return jsonResponse(mollieInvoicePayload());
	}, () => client.billing.invoices.get({ invoiceId: "invoice_local_1" }));
	assert.equal(invoice.providerInvoiceId, "invoice_local_1");
});

test("T-BIL-LOCAL-NO-HTTP: invoices stay on Mollie", async () => {
	const urls: string[] = [];
	const client = createClient({
		billing: {
			mode: "local",
			providers: {
				mollie: invoiceProvider,
			},
			testMode: true,
		},
		key: "ak_test",
		url: "https://athena.example.com",
	});
	await withMockedFetch(async (url) => {
		urls.push(String(url));
		return jsonResponse({
			_embedded: { sales_invoices: [mollieInvoicePayload()] },
		});
	}, () => client.billing.invoices.list({}));
	assert.equal(urls.some((url) => url.includes("/billing/v1")), false);
	assert.ok(urls.some((url) => url.includes("/v2/sales-invoices")));
});
