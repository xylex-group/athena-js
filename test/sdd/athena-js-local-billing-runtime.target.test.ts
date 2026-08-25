import { FetchMollieSdk } from "../helpers/fetch-mollie-sdk.ts";
/**
 * Target — LocalBillingRuntime + configured Mollie payments.create.
 *
 * See docs/sdd/xylex/athena-js-local-billing/SPEC.md
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "src");
const billingDir = join(srcRoot, "billing");

function readBilling(rel: string): string {
	return readFileSync(join(billingDir, rel), "utf8");
}

const TEST_KEY = "test_athena_local_runtime";
const LIVE_KEY = "live_athena_local_runtime";

function molliePaymentPayload(overrides: Record<string, unknown> = {}) {
	return {
		amount: { currency: "EUR", value: "10.00" },
		amountRefunded: { currency: "EUR", value: "0.00" },
		createdAt: "2026-08-23T10:00:00+00:00",
		customerId: "cst_local",
		description: "Order 42",
		id: "tr_local_1",
		metadata: { orderId: "42" },
		paidAt: null,
		profileId: "pfl_local",
		resource: "payment",
		status: "open",
		subscriptionId: null,
		...overrides,
	};
}

function jsonResponse(body: unknown, status = 201): Response {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		status,
	});
}

function createPaymentInput() {
	return {
		amount: { currency: "EUR", value: "10.00" },
		description: "Order 42",
		idempotencyKey: "idem-local-1",
		metadata: { orderId: "42" },
		redirectUrl: "https://example.com/return",
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

test("T-BIL-PROVIDER-PAYMENT-CONTRACT: provider payment port returns BillingPayment", () => {
	const src = readBilling("runtime/local/providers/types.ts");
	assert.match(src, /export interface BillingProviderPaymentPort/);
	assert.match(
		src,
		/create\(\s*[\s\S]*?\):\s*Promise<BillingPayment>/,
	);
	assert.doesNotMatch(
		src,
		/create\(\s*[\s\S]*?\):\s*Promise<unknown>/,
	);
});

test("T-BIL-LOCAL-CREATE: configured Mollie executes payments.create", async () => {
	const { createLocalBillingRuntime } = await import(
		"../../src/billing/runtime/local/runtime.ts"
	);
	const { createBillingProviderRegistry } = await import(
		"../../src/billing/runtime/local/providers/create-registry.ts"
	);
	const calls: string[] = [];
	const payment = await withMockedFetch(async (url, init) => {
		calls.push(`${(init?.method ?? "GET").toUpperCase()} ${String(url)}`);
		return jsonResponse(molliePaymentPayload());
	}, async () => {
		const configured = {
			mollie: { sdk: FetchMollieSdk, testKey: TEST_KEY, liveKey: LIVE_KEY },
		};
		const runtime = createLocalBillingRuntime({
			configuredProviders: configured,
			registry: createBillingProviderRegistry(configured),
			testMode: true,
		});
		return runtime.payments.create(createPaymentInput());
	});
	assert.equal(payment.provider, "mollie");
	assert.equal(payment.providerPaymentId, "tr_local_1");
	assert.equal(payment.status, "pending");
	assert.equal(payment.amount.value, "10.00");
	assert.ok(calls.some((call) => call.includes("api.mollie.com")));
});

test("T-BIL-LOCAL-NO-CONNECTION: payments.create does not require connectionId", async () => {
	const { createLocalBillingRuntime } = await import(
		"../../src/billing/runtime/local/runtime.ts"
	);
	const { createBillingProviderRegistry } = await import(
		"../../src/billing/runtime/local/providers/create-registry.ts"
	);
	const configured = {
		mollie: { sdk: FetchMollieSdk, testKey: TEST_KEY },
	};
	const runtime = createLocalBillingRuntime({
		configuredProviders: configured,
		registry: createBillingProviderRegistry(configured),
		testMode: true,
	});
	const created = await withMockedFetch(
		async () => jsonResponse(molliePaymentPayload()),
		() => runtime.payments.create(createPaymentInput()),
	);
	assert.equal(created.providerPaymentId, "tr_local_1");
	assert.equal("connectionId" in created, false);
});

test("T-BIL-LOCAL-TEST-KEY: testMode true uses only the test key", async () => {
	const { createLocalBillingRuntime } = await import(
		"../../src/billing/runtime/local/runtime.ts"
	);
	const { createBillingProviderRegistry } = await import(
		"../../src/billing/runtime/local/providers/create-registry.ts"
	);
	const authorizations: string[] = [];
	const configured = {
		mollie: { sdk: FetchMollieSdk, testKey: TEST_KEY, liveKey: LIVE_KEY },
	};
	const runtime = createLocalBillingRuntime({
		configuredProviders: configured,
		registry: createBillingProviderRegistry(configured),
		testMode: true,
	});
	await withMockedFetch(async (_url, init) => {
		const headers = new Headers(init?.headers);
		authorizations.push(headers.get("authorization") ?? "");
		return jsonResponse(molliePaymentPayload());
	}, () => runtime.payments.create(createPaymentInput()));
	assert.deepEqual(authorizations, [`Bearer ${TEST_KEY}`]);
	assert.equal(authorizations.some((value) => value.includes(LIVE_KEY)), false);
});

test("T-BIL-LOCAL-LIVE-KEY: testMode false uses only the live key", async () => {
	const { createLocalBillingRuntime } = await import(
		"../../src/billing/runtime/local/runtime.ts"
	);
	const { createBillingProviderRegistry } = await import(
		"../../src/billing/runtime/local/providers/create-registry.ts"
	);
	const authorizations: string[] = [];
	const configured = {
		mollie: { sdk: FetchMollieSdk, testKey: TEST_KEY, liveKey: LIVE_KEY },
	};
	const runtime = createLocalBillingRuntime({
		configuredProviders: configured,
		registry: createBillingProviderRegistry(configured),
		testMode: false,
	});
	await withMockedFetch(async (_url, init) => {
		const headers = new Headers(init?.headers);
		authorizations.push(headers.get("authorization") ?? "");
		return jsonResponse(molliePaymentPayload({ mode: "live", status: "paid" }));
	}, () => runtime.payments.create(createPaymentInput()));
	assert.deepEqual(authorizations, [`Bearer ${LIVE_KEY}`]);
	assert.equal(authorizations.some((value) => value.includes(TEST_KEY)), false);
});

test("T-BIL-LOCAL-NO-FALLBACK: missing selected key does not use the opposite slot", async () => {
	const { createLocalBillingRuntime } = await import(
		"../../src/billing/runtime/local/runtime.ts"
	);
	const { createBillingProviderRegistry } = await import(
		"../../src/billing/runtime/local/providers/create-registry.ts"
	);
	const { AthenaBillingCapabilityError } = await import(
		"../../src/billing/errors.ts"
	);
	const configured = {
		mollie: { sdk: FetchMollieSdk, testKey: TEST_KEY },
	};
	const runtime = createLocalBillingRuntime({
		configuredProviders: configured,
		registry: createBillingProviderRegistry(configured),
		testMode: false,
	});
	let fetchCalls = 0;
	await assert.rejects(
		() =>
			withMockedFetch(async () => {
				fetchCalls += 1;
				return jsonResponse(molliePaymentPayload());
			}, () => runtime.payments.create(createPaymentInput())),
		(error: unknown) =>
			error instanceof AthenaBillingCapabilityError &&
			error.reason === "missing_provider_scope" &&
			error.operation === "payments.create" &&
			!error.message.includes(TEST_KEY),
	);
	assert.equal(fetchCalls, 0);
});

test("T-BIL-LOCAL-MOLLIE-PROJECTION: native Mollie payment projects to canonical BillingPayment", async () => {
	const { projectMolliePayment } = await import(
		"../../src/billing/runtime/local/providers/mollie/projection.ts"
	);
	const raw = molliePaymentPayload({
		amountRefunded: { currency: "EUR", value: "1.50" },
		paidAt: "2026-08-23T10:05:00+00:00",
		status: "paid",
		subscriptionId: "sub_local",
	});
	const projected = projectMolliePayment(raw);
	assert.equal(projected.provider, "mollie");
	assert.equal(projected.providerPaymentId, "tr_local_1");
	assert.equal(projected.providerCustomerId, "cst_local");
	assert.equal(projected.providerProfileId, "pfl_local");
	assert.equal(projected.providerSubscriptionId, "sub_local");
	assert.equal(projected.status, "paid");
	assert.deepEqual(projected.amount, { currency: "EUR", value: "10.00" });
	assert.deepEqual(projected.amountRefunded, {
		currency: "EUR",
		value: "1.50",
	});
	assert.equal(projected.description, "Order 42");
	assert.deepEqual(projected.metadata, { orderId: "42" });
	assert.equal(projected.paidAt, "2026-08-23T10:05:00+00:00");
	assert.equal(projected.createdAt, "2026-08-23T10:00:00+00:00");
	assert.equal(projected.raw, raw);
});

test("T-BIL-LOCAL-STATUS: Mollie statuses normalize explicitly", async () => {
	const { projectMolliePaymentStatus } = await import(
		"../../src/billing/runtime/local/providers/mollie/projection.ts"
	);
	assert.equal(projectMolliePaymentStatus("open"), "pending");
	assert.equal(projectMolliePaymentStatus("pending"), "pending");
	assert.equal(projectMolliePaymentStatus("authorized"), "authorized");
	assert.equal(projectMolliePaymentStatus("paid"), "paid");
	assert.equal(projectMolliePaymentStatus("failed"), "failed");
	assert.equal(projectMolliePaymentStatus("canceled"), "canceled");
	assert.equal(projectMolliePaymentStatus("expired"), "failed");
	const src = readBilling("runtime/local/providers/mollie/projection.ts");
	assert.doesNotMatch(src, /as BillingPaymentStatus/);
});

test("T-BIL-LOCAL-RAW: provider raw payload is retained", async () => {
	const { createLocalBillingRuntime } = await import(
		"../../src/billing/runtime/local/runtime.ts"
	);
	const { createBillingProviderRegistry } = await import(
		"../../src/billing/runtime/local/providers/create-registry.ts"
	);
	const raw = molliePaymentPayload({ description: "Keep raw" });
	const configured = { mollie: { sdk: FetchMollieSdk, testKey: TEST_KEY } };
	const runtime = createLocalBillingRuntime({
		configuredProviders: configured,
		registry: createBillingProviderRegistry(configured),
		testMode: true,
	});
	const created = await withMockedFetch(
		async () => jsonResponse(raw),
		() => runtime.payments.create(createPaymentInput()),
	);
	assert.deepEqual(created.raw, raw);
	assert.equal((created.raw as { description?: string }).description, "Keep raw");
});

test("T-BIL-LOCAL-CAPS: implemented Mollie ports and operations are truthful", async () => {
	const { createLocalBillingRuntime } = await import(
		"../../src/billing/runtime/local/runtime.ts"
	);
	const { createBillingProviderRegistry } = await import(
		"../../src/billing/runtime/local/providers/create-registry.ts"
	);
	const configured = {
		mollie: { sdk: FetchMollieSdk, testKey: TEST_KEY, liveKey: LIVE_KEY },
	};
	const runtime = createLocalBillingRuntime({
		configuredProviders: configured,
		registry: createBillingProviderRegistry(configured),
		testMode: true,
	});
	const capabilities = await runtime.getCapabilities({ provider: "mollie" });
	assert.equal(capabilities.runtime, "local");
	assert.equal(capabilities.provider, "mollie");
	assert.equal(capabilities.connected, true);
	assert.equal(capabilities.testMode, true);
	assert.equal(capabilities.environment, "test");
	assert.deepEqual(capabilities.credentials, {
		configured: true,
		selectedEnvironment: "test",
		availableEnvironments: ["test", "live"],
		credentialKind: "api_key",
	});
	assert.deepEqual(capabilities.ports, {
		payments: true,
		customers: true,
		refunds: true,
		paymentLinks: true,
		subscriptions: true,
		invoices: true,
		webhooks: false,
	});
	assert.equal(capabilities.operations["payments.create"]?.available, true);
	assert.equal(capabilities.operations["payments.get"]?.available, true);
	assert.equal(capabilities.operations["payments.list"]?.available, true);
	assert.equal(capabilities.operations["payments.cancel"]?.available, true);
	assert.equal(capabilities.operations["customers.create"]?.available, true);
	assert.equal(capabilities.operations["refunds.create"]?.available, true);
	assert.equal(capabilities.operations["refunds.get"]?.available, true);
	assert.equal(capabilities.operations["paymentLinks.create"]?.available, true);
	assert.equal(capabilities.connectionId, undefined);
	assert.deepEqual(capabilities.target, {
		kind: "configured",
		provider: "mollie",
	});
});

test("T-BIL-LOCAL-CAPS-CREDENTIAL: missing selected credential is not available", async () => {
	const { createLocalBillingRuntime } = await import(
		"../../src/billing/runtime/local/runtime.ts"
	);
	const { createBillingProviderRegistry } = await import(
		"../../src/billing/runtime/local/providers/create-registry.ts"
	);
	const configured = { mollie: { sdk: FetchMollieSdk, testKey: TEST_KEY } };
	const runtime = createLocalBillingRuntime({
		configuredProviders: configured,
		registry: createBillingProviderRegistry(configured),
		testMode: false,
	});
	const capabilities = await runtime.getCapabilities({ provider: "mollie" });
	assert.equal(capabilities.connected, false);
	assert.equal(capabilities.environment, "live");
	assert.equal(capabilities.testMode, false);
	assert.deepEqual(capabilities.operations["payments.create"], {
		available: false,
		reason: "missing_provider_scope",
	});
	assert.equal(capabilities.credentials?.configured, true);
	assert.equal(capabilities.credentials?.selectedEnvironment, "live");
	assert.deepEqual(capabilities.credentials?.availableEnvironments, ["test"]);
	assert.equal(capabilities.credentials?.credentialKind, "api_key");
	assert.deepEqual(capabilities.target, {
		kind: "configured",
		provider: "mollie",
	});
});

test("T-BIL-LOCAL-CAPS-PROVIDER: provider getCapabilities can deny a present port", async () => {
	const { createLocalBillingRuntime } = await import(
		"../../src/billing/runtime/local/runtime.ts"
	);
	const { BillingProviderRegistry } = await import(
		"../../src/billing/runtime/local/providers/registry.ts"
	);
	const configured = { mollie: { sdk: FetchMollieSdk, testKey: TEST_KEY } };
	const deniedPorts = {
		customers: false,
		invoices: false,
		paymentLinks: false,
		payments: false,
		refunds: false,
		subscriptions: false,
		webhooks: false,
	};
	const runtime = createLocalBillingRuntime({
		configuredProviders: configured,
		registry: new BillingProviderRegistry([
			{
				provider: "mollie",
				payments: {
					create: () => {
						throw new Error("provider port must not execute during getCapabilities");
					},
				},
				getCapabilities: async () => ({
					operations: {
						"payments.create": false,
					},
					ports: deniedPorts,
				}),
			},
		]),
		testMode: true,
	});
	const capabilities = await runtime.getCapabilities({ provider: "mollie" });
	assert.equal(capabilities.connected, true);
	assert.equal(capabilities.ports.payments, false);
	assert.deepEqual(capabilities.operations["payments.create"], {
		available: false,
		reason: "unsupported_operation",
	});
});

test("T-BIL-LOCAL-CAPS-CREDENTIAL-NARROW: only credential errors become missing_credential", () => {
	const src = readBilling("runtime/local/runtime.ts");
	assert.match(src, /isAthenaBillingCredentialError/);
	assert.doesNotMatch(src, /catch\s*\{\s*credentialAvailable = false/);
});

test("T-BIL-LOCAL-SECRETS: resolved key is absent from errors and serialization", async () => {
	const { createLocalBillingRuntime } = await import(
		"../../src/billing/runtime/local/runtime.ts"
	);
	const { createBillingProviderRegistry } = await import(
		"../../src/billing/runtime/local/providers/create-registry.ts"
	);
	const { AthenaBillingProviderRequestError } = await import(
		"../../src/billing/errors.ts"
	);
	const configured = { mollie: { sdk: FetchMollieSdk, testKey: TEST_KEY } };
	const runtime = createLocalBillingRuntime({
		configuredProviders: configured,
		registry: createBillingProviderRegistry(configured),
		testMode: true,
	});
	await assert.rejects(
		() =>
			withMockedFetch(
				async () =>
					jsonResponse(
						{ detail: "Unauthorized", status: 401, title: "Unauthorized Request" },
						401,
					),
				() => runtime.payments.create(createPaymentInput()),
			),
		(error: unknown) => {
			assert.ok(error instanceof AthenaBillingProviderRequestError);
			const serialized = JSON.stringify(error);
			assert.equal(serialized.includes(TEST_KEY), false);
			assert.equal(String(error).includes(TEST_KEY), false);
			assert.equal(error.provider, "mollie");
			assert.equal(error.kind, "authentication");
			return true;
		},
	);
});

test("T-BIL-LOCAL-REMOTE-NONE: local execution makes no /billing/v1 request", async () => {
	const { createLocalBillingRuntime } = await import(
		"../../src/billing/runtime/local/runtime.ts"
	);
	const { createBillingProviderRegistry } = await import(
		"../../src/billing/runtime/local/providers/create-registry.ts"
	);
	const urls: string[] = [];
	const configured = { mollie: { sdk: FetchMollieSdk, testKey: TEST_KEY } };
	const runtime = createLocalBillingRuntime({
		configuredProviders: configured,
		registry: createBillingProviderRegistry(configured),
		testMode: true,
	});
	await withMockedFetch(async (url) => {
		urls.push(String(url));
		return jsonResponse(molliePaymentPayload());
	}, () => runtime.payments.create(createPaymentInput()));
	assert.equal(urls.some((url) => url.includes("/billing/v1")), false);
	assert.ok(urls.some((url) => url.includes("api.mollie.com")));
});

test("T-BIL-LOCAL-BROWSER: browser local mode fails closed", async () => {
	const {
		ATHENA_BILLING_LOCAL_RUNTIME_SERVER_REQUIRED,
		AthenaBillingProviderError,
	} = await import("../../src/billing/errors.ts");
	const { assertLocalBillingRuntimeEnvironment } = await import(
		"../../src/billing/runtime/resolve-mode.ts"
	);
	assert.throws(
		() =>
			assertLocalBillingRuntimeEnvironment({
				mode: "local",
				environment: "browser",
			}),
		(error: unknown) =>
			error instanceof AthenaBillingProviderError &&
			error.code === ATHENA_BILLING_LOCAL_RUNTIME_SERVER_REQUIRED,
	);
});

test("T-BIL-MODE-REMOTE: explicit remote without providers uses the HTTP runtime", async () => {
	const urls: string[] = [];
	const client = createClient({
		billing: {
			mode: "remote",
		},
		key: "ak_test",
		url: "https://athena.example.com",
	});
	await withMockedFetch(async (url, init) => {
		urls.push(`${(init?.method ?? "GET").toUpperCase()} ${String(url)}`);
		return new Response(JSON.stringify({ data: { id: "pay_remote" } }), {
			headers: { "content-type": "application/json" },
			status: 200,
		});
	}, () =>
		client.billing.payments.create({
			...createPaymentInput(),
			connectionId: "11111111-1111-1111-1111-111111111111",
		}),
	);
	assert.ok(
		urls.some((url) => url.includes("POST ") && url.includes("/billing/v1/payments")),
	);
	assert.equal(urls.some((url) => url.includes("api.mollie.com")), false);
});

test("T-BIL-MODE-REMOTE-PROVIDERS: remote + providers is a config conflict", async () => {
	const { ATHENA_BILLING_CONFIG_CONFLICT, AthenaBillingProviderError } =
		await import("../../src/billing/errors.ts");
	assert.throws(
		() =>
			createClient({
				billing: {
					mode: "remote",
					providers: {
						mollie: { sdk: FetchMollieSdk, testKey: TEST_KEY },
					},
				},
				key: "ak_test",
				url: "https://athena.example.com",
			}),
		(error: unknown) =>
			error instanceof AthenaBillingProviderError &&
			error.code === ATHENA_BILLING_CONFIG_CONFLICT,
	);
});

test("T-BIL-MODE-LOCAL: explicit local never falls back to remote", async () => {
	const urls: string[] = [];
	const client = createClient({
		billing: {
			mode: "local",
			providers: {
				mollie: { sdk: FetchMollieSdk, testKey: TEST_KEY },
			},
			testMode: true,
		},
		key: "ak_test",
		url: "https://athena.example.com",
	});
	const created = await withMockedFetch(async (url, init) => {
		urls.push(`${(init?.method ?? "GET").toUpperCase()} ${String(url)}`);
		return jsonResponse(molliePaymentPayload());
	}, () => client.billing.payments.create(createPaymentInput()));
	assert.equal(created.providerPaymentId, "tr_local_1");
	assert.equal(urls.some((url) => url.includes("/billing/v1")), false);
	assert.ok(urls.some((url) => url.includes("api.mollie.com")));
});

test("T-BIL-MODE-AUTO: configured provider selects local", async () => {
	const urls: string[] = [];
	const client = createClient({
		billing: {
			providers: {
				mollie: { sdk: FetchMollieSdk, testKey: TEST_KEY },
			},
			testMode: true,
		},
		key: "ak_test",
		url: "https://athena.example.com",
	});
	const created = await withMockedFetch(async (url) => {
		urls.push(String(url));
		return jsonResponse(molliePaymentPayload());
	}, () => client.billing.payments.create(createPaymentInput()));
	assert.equal(created.provider, "mollie");
	assert.equal(urls.some((url) => url.includes("/billing/v1")), false);
	assert.ok(urls.some((url) => url.includes("api.mollie.com")));
});

test("T-BIL-PAYMENTS-CREATE-TYPE: canonical payments.create is typed", () => {
	const moduleSrc = readBilling("module.ts");
	assert.match(moduleSrc, /payments:\s*BillingPaymentPort/);
	assert.match(
		moduleSrc,
		/createPayment:\s*\(\s*body:\s*Record<string,\s*unknown>/,
	);
});

test("T-BIL-MODULE-PAYMENTS: createClient exposes billing.payments.create", async () => {
	const client = createClient({
		billing: {
			providers: {
				mollie: { sdk: FetchMollieSdk, testKey: TEST_KEY },
			},
			testMode: true,
		},
		key: "ak_test",
		url: "https://athena.example.com",
	});
	assert.equal(typeof client.billing.payments.create, "function");
	const created = await withMockedFetch(
		async () => jsonResponse(molliePaymentPayload()),
		() => client.billing.payments.create(createPaymentInput()),
	);
	assert.equal(created.providerPaymentId, "tr_local_1");
});
