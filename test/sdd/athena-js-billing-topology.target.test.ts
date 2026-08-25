import { FetchMollieSdk } from "../helpers/fetch-mollie-sdk.ts";
/**
 * Target — BIL-TOPOLOGY-001…010 (Phases 1–3) + Phase 4 trusted-runtime composition.
 *
 * See docs/sdd/xylex/athena-js-billing-topology/SPEC.md
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	ATHENA_BILLING_LOCAL_RUNTIME_SERVER_REQUIRED,
	ATHENA_BILLING_PROVIDER_NOT_REGISTERED,
	ATHENA_BILLING_PROVIDER_SERVER_REQUIRED,
	AthenaBillingCapabilityError,
	AthenaBillingProviderError,
} from "../../src/billing/errors.ts";
import * as billingErrors from "../../src/billing/errors.ts";
import { assertBillingProviderRuntimeEnvironment } from "../../src/billing/runtime/local/providers/config.ts";
import {
	assertLocalBillingRuntimeEnvironment,
	resolveBillingRuntimeMode,
} from "../../src/billing/runtime/resolve-mode.ts";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "src");
const repoRoot = join(here, "..", "..", "..", "..");
const docsAthenaJs = join(repoRoot, "apps", "docs-athena-js");

const mollieProviders = {
	mollie: { sdk: FetchMollieSdk, testKey: "test_topology" },
};

function readSrc(rel: string): string {
	return readFileSync(join(srcRoot, rel), "utf8");
}

test("T-BIL-TOPO-002: mode remote + providers is ATHENA_BILLING_CONFIG_CONFLICT", () => {
	assert.throws(
		() =>
			resolveBillingRuntimeMode({
				configuredProviders: mollieProviders,
				mode: "remote",
			}),
		(error: unknown) =>
			error instanceof AthenaBillingProviderError &&
			error.code === "ATHENA_BILLING_CONFIG_CONFLICT" &&
			error.message.includes('billing.mode="remote"') &&
			error.message.includes("billing.providers"),
	);
});

test("T-BIL-TOPO-003: providers + omitted or auto resolves local", () => {
	assert.equal(
		resolveBillingRuntimeMode({ configuredProviders: mollieProviders }),
		"local",
	);
	assert.equal(
		resolveBillingRuntimeMode({
			configuredProviders: mollieProviders,
			mode: "auto",
		}),
		"local",
	);
});

test("T-BIL-TOPO-004: explicit local never remotes", () => {
	assert.equal(resolveBillingRuntimeMode({ mode: "local" }), "local");
	assert.equal(
		resolveBillingRuntimeMode({
			configuredProviders: mollieProviders,
			mode: "local",
		}),
		"local",
	);
});

test("T-BIL-TOPO-001: providers forbidden in browser and React Native", () => {
	for (const environment of ["browser", "react-native"] as const) {
		assert.throws(
			() =>
				assertBillingProviderRuntimeEnvironment(mollieProviders, {
					environment,
				}),
			(error: unknown) =>
				error instanceof AthenaBillingProviderError &&
				error.code === ATHENA_BILLING_PROVIDER_SERVER_REQUIRED &&
				!error.message.includes("Node-capable"),
		);
	}
});

test("T-BIL-TOPO-005: trusted-runtime copy replaces Node-capable", () => {
	const resolveSrc = readSrc("billing/runtime/resolve-mode.ts");
	const configSrc = readSrc("billing/runtime/local/providers/config.ts");
	assert.doesNotMatch(resolveSrc, /Node-capable/);
	assert.doesNotMatch(configSrc, /Node-capable/);
	assert.match(resolveSrc, /trusted server runtime/);
	assert.match(configSrc, /trusted server runtime/);
});

test("T-BIL-TOPO-006: unresolved local on core createClient fail-closes", async () => {
	const { createClient } = await import("../../src/v3-client-core.ts");
	assert.throws(
		() =>
			createClient({
				key: "ak_topology_test",
				billing: { providers: mollieProviders },
				url: "https://athena.example",
			}),
		(error: unknown) =>
			error instanceof AthenaBillingProviderError &&
			error.code === ATHENA_BILLING_LOCAL_RUNTIME_SERVER_REQUIRED,
	);
});

test("T-BIL-TOPO-EXPORT: public barrel exports ATHENA_BILLING_CONFIG_CONFLICT", async () => {
	const billing = await import("../../src/billing/index.ts");
	assert.equal(
		billing.ATHENA_BILLING_CONFIG_CONFLICT,
		"ATHENA_BILLING_CONFIG_CONFLICT",
	);
	assert.equal(
		billingErrors.ATHENA_BILLING_CONFIG_CONFLICT,
		"ATHENA_BILLING_CONFIG_CONFLICT",
	);
});

test("T-BIL-TOPO-LOCAL-ENV: explicit local still rejects browser", () => {
	assert.throws(
		() =>
			assertLocalBillingRuntimeEnvironment({
				environment: "browser",
				mode: "local",
			}),
		(error: unknown) =>
			error instanceof AthenaBillingProviderError &&
			error.code === ATHENA_BILLING_LOCAL_RUNTIME_SERVER_REQUIRED &&
			!error.message.includes("Node-capable"),
	);
});

function paymentCreateInput() {
	return {
		amount: { currency: "EUR", value: "10.00" },
		description: "Topology capability",
		redirectUrl: "https://example.com/return",
	};
}

async function capabilityReasonFromExecute(
	runtime: {
		payments: {
			create: (input: ReturnType<typeof paymentCreateInput>) => Promise<unknown>;
		};
	},
): Promise<string | undefined> {
	try {
		await runtime.payments.create(paymentCreateInput());
		return undefined;
	} catch (error) {
		if (error instanceof AthenaBillingCapabilityError) {
			return error.reason;
		}
		throw error;
	}
}

test("T-BIL-TOPO-007: getCapabilities reason matches execute for same target", async () => {
	const { createLocalBillingRuntime } = await import(
		"../../src/billing/runtime/local/runtime.ts"
	);
	const { createBillingProviderRegistry } = await import(
		"../../src/billing/runtime/local/providers/create-registry.ts"
	);
	const cases = [
		{
			configured: { mollie: { sdk: FetchMollieSdk, testKey: "test_cap_ssot" } },
			testMode: false,
			provider: "mollie" as const,
		},
		{
			configured: {
				stripe: { testKey: "sk_test_cap_ssot", liveKey: "sk_live_cap_ssot" },
			},
			testMode: true,
			provider: "stripe" as const,
		},
	];
	for (const item of cases) {
		const runtime = createLocalBillingRuntime({
			configuredProviders: item.configured,
			registry: createBillingProviderRegistry(item.configured),
			testMode: item.testMode,
		});
		const capabilities = await runtime.getCapabilities({
			provider: item.provider,
		});
		const listed = capabilities.operations["payments.create"]?.reason;
		const executed = await capabilityReasonFromExecute(runtime);
		assert.equal(
			executed,
			listed,
			`${item.provider} execute reason ${String(executed)} !== getCapabilities ${String(listed)}`,
		);
	}
});

test("T-BIL-TOPO-007-SSOT: execute and getCapabilities share decideLocalBillingOperationCapability", () => {
	const decideImport =
		/from ["']\.\/capability-decision\.ts["']|from ["']\.\.\/capability-decision\.ts["']/;
	const executeSrc = readSrc("billing/runtime/local/execute/shared.ts");
	const runtimeSrc = readSrc("billing/runtime/local/runtime.ts");
	assert.match(executeSrc, /decideLocalBillingOperationCapability/);
	assert.match(runtimeSrc, /decideLocalBillingOperationCapability/);
	assert.match(executeSrc, decideImport);
	assert.match(runtimeSrc, decideImport);
});

test("T-BIL-TOPO-008: registered Stripe is unsupported_operation, not not-registered", async () => {
	const { createLocalBillingRuntime } = await import(
		"../../src/billing/runtime/local/runtime.ts"
	);
	const { createBillingProviderRegistry } = await import(
		"../../src/billing/runtime/local/providers/create-registry.ts"
	);
	const configured = {
		stripe: { testKey: "sk_test_topo_008", liveKey: "sk_live_topo_008" },
	};
	const runtime = createLocalBillingRuntime({
		configuredProviders: configured,
		registry: createBillingProviderRegistry(configured),
		testMode: true,
	});
	const capabilities = await runtime.getCapabilities({ provider: "stripe" });
	assert.equal(
		capabilities.operations["payments.create"]?.reason,
		"unsupported_operation",
	);
	await assert.rejects(
		() => runtime.payments.create(paymentCreateInput()),
		(error: unknown) =>
			error instanceof AthenaBillingCapabilityError &&
			error.reason === "unsupported_operation" &&
			!(error instanceof AthenaBillingProviderError &&
				error.code === ATHENA_BILLING_PROVIDER_NOT_REGISTERED),
	);
});

test("T-BIL-TOPO-009: capability fixture matches Mollie and Stripe static metadata", async () => {
	const { BILLING_PROVIDER_CAPABILITY_FIXTURE } = await import(
		"../../src/billing/runtime/capability-fixture.ts"
	);
	const { MOLLIE_BILLING_PROVIDER_CAPABILITIES } = await import(
		"../../src/billing/runtime/local/providers/mollie/capabilities.ts"
	);
	const { STRIPE_BILLING_PROVIDER_CAPABILITIES } = await import(
		"../../src/billing/runtime/local/providers/stripe/capabilities.ts"
	);
	assert.deepEqual(
		BILLING_PROVIDER_CAPABILITY_FIXTURE.mollie,
		MOLLIE_BILLING_PROVIDER_CAPABILITIES,
	);
	assert.deepEqual(
		BILLING_PROVIDER_CAPABILITY_FIXTURE.stripe,
		STRIPE_BILLING_PROVIDER_CAPABILITIES,
	);
	assert.equal(
		BILLING_PROVIDER_CAPABILITY_FIXTURE.mollie.operations["payments.list"],
		true,
	);
	assert.equal(
		BILLING_PROVIDER_CAPABILITY_FIXTURE.mollie.operations["refunds.get"],
		true,
	);
	assert.equal(
		BILLING_PROVIDER_CAPABILITY_FIXTURE.stripe.operations["payments.create"],
		false,
	);
});

test("T-BIL-TOPO-009-DOCS: Blume matrix is generated from the fixture", () => {
	const shapeTables = readFileSync(
		join(docsAthenaJs, "lib", "shape-tables.ts"),
		"utf8",
	);
	const generated = readFileSync(
		join(docsAthenaJs, "lib", "generated", "billing-capabilities.ts"),
		"utf8",
	);
	const localPage = readFileSync(
		join(docsAthenaJs, "docs", "billing", "local.mdx"),
		"utf8",
	);
	assert.match(generated, /BILLING_PROVIDER_CAPABILITY_FIXTURE/);
	assert.match(generated, /"payments.list": true/);
	assert.match(shapeTables, /generated\/billing-capabilities/);
	assert.doesNotMatch(
		shapeTables,
		/payments\.list \/ get \/ cancel stay false locally/,
	);
	assert.doesNotMatch(
		shapeTables,
		/HTTP even when providers are configured/,
	);
	assert.match(shapeTables, /ATHENA_BILLING_CONFIG_CONFLICT/);
	assert.doesNotMatch(localPage, /payments\.list \/ get \/ cancel stay false/);
});

test("T-BIL-TOPO-010: local payment snippet is Promise<BillingPayment>", () => {
	const snippet = readFileSync(
		join(docsAthenaJs, "examples", "billing", "local", "02.ts"),
		"utf8",
	);
	assert.match(snippet, /Promise<BillingPayment>/);
	assert.doesNotMatch(snippet, /Promise<unknown>/);
	const portSrc = readSrc("billing/runtime/types.ts");
	assert.match(
		portSrc,
		/create\(input: BillingCreatePaymentInput\): Promise<BillingPayment>/,
	);
});

test("T-BIL-TOPO-011: Cloudflare runtime materializes local Billing", async () => {
	const { createAthenaRuntime } = await import(
		"../../src/cloudflare/runtime.ts"
	);
	const { client } = createAthenaRuntime({
		billing: { providers: mollieProviders, testMode: true },
		key: "ak_topology_cf",
		url: "https://athena.example",
	});
	const capabilities = await client.billing.getCapabilities({
		provider: "mollie",
	});
	assert.equal(capabilities.runtime, "local");
	assert.equal(capabilities.operations["payments.create"]?.available, true);
});

test("T-BIL-TOPO-011-EDGE: createCloudflareClient forwards billing and materializes", async () => {
	const { createCloudflareClient } = await import(
		"../../src/cloudflare/edge-client.ts"
	);
	const { createMockD1 } = await import("../helpers/d1-r2-mocks.ts");
	const client = createCloudflareClient({
		billing: { providers: mollieProviders, testMode: true },
		d1: createMockD1({}),
		key: "ak_topology_cf_edge",
		url: "https://athena.example",
	});
	const capabilities = await client.billing.getCapabilities({
		provider: "mollie",
	});
	assert.equal(capabilities.runtime, "local");
	assert.equal(capabilities.operations["payments.create"]?.available, true);
});

test("T-BIL-TOPO-012: local composition lives on the trusted-runtime spine", () => {
	const materialize = readSrc("billing/runtime/local/materialize.ts");
	const nodeClient = readSrc("v3-client.ts");
	const cfRuntime = readSrc("cloudflare/runtime.ts");
	const cfEdge = readSrc("cloudflare/edge-client.ts");
	const core = readSrc("v3-client-core.ts");
	assert.match(materialize, /createLocalBillingRuntime/);
	assert.match(materialize, /export function attachLocalBillingRuntime/);
	assert.match(nodeClient, /attachLocalBillingRuntime/);
	assert.match(cfRuntime, /createClientWithAttachedLocalBilling/);
	assert.match(cfEdge, /createClientWithAttachedLocalBilling/);
	assert.doesNotMatch(core, /createLocalBillingRuntime/);
	assert.doesNotMatch(core, /attachLocalBillingRuntime/);
	assert.doesNotMatch(core, /billing\/runtime\/local\/materialize/);
});

function unusedMollieResource(): Record<string, () => Promise<unknown>> {
	return {
		cancel: async () => ({}),
		create: async () => ({}),
		delete: async () => ({}),
		get: async () => ({}),
		list: async () => ({}),
		update: async () => ({}),
	};
}

function injectedMolliePaymentRaw() {
	return {
		amount: { currency: "EUR", value: "10.00" },
		amountRefunded: { currency: "EUR", value: "0.00" },
		createdAt: "2026-08-24T00:00:00+00:00",
		description: "Injected SDK",
		id: "tr_sdk_1",
		metadata: {},
		profileId: "pfl_sdk",
		resource: "payment",
		status: "open",
	};
}

test("T-BIL-TOPO-013: Mollie provider config accepts injected sdk", async () => {
	const { normalizeMollieBillingProviderConfig } = await import(
		"../../src/billing/runtime/local/providers/config.ts"
	);
	class InjectedMollieClient {
		payments = { create: async () => injectedMolliePaymentRaw() };
		constructor(_options?: { security?: { apiKey?: string } }) {}
	}
	const normalized = normalizeMollieBillingProviderConfig({
		sdk: InjectedMollieClient,
		testKey: "test_topology_sdk",
	});
	assert.equal(normalized.sdk, InjectedMollieClient);
});

test("T-BIL-TOPO-014: injected Mollie sdk executes payments.create without fetch", async () => {
	const { createClient } = await import("../../src/v3-client.ts");
	let constructedWith: string | undefined;
	let createCalls = 0;
	class InjectedMollieClient {
		customers = unusedMollieResource();
		invoices = unusedMollieResource();
		paymentLinks = unusedMollieResource();
		refunds = unusedMollieResource();
		subscriptions = unusedMollieResource();
		payments = {
			cancel: async () => ({}),
			get: async () => ({}),
			list: async () => ({}),
			create: async () => {
				createCalls += 1;
				return injectedMolliePaymentRaw();
			},
		};
		constructor(options?: { security?: { apiKey?: string } }) {
			constructedWith = options?.security?.apiKey;
		}
	}
	const previousFetch = globalThis.fetch;
	let fetchCalls = 0;
	globalThis.fetch = (async () => {
		fetchCalls += 1;
		throw new Error("fetch must not run when sdk is injected");
	}) as typeof fetch;
	try {
		const client = createClient({
			billing: {
				providers: {
					mollie: {
						sdk: InjectedMollieClient,
						testKey: "test_topology_sdk",
					},
				},
				testMode: true,
			},
			key: "ak_topology_sdk",
			url: "https://athena.example",
		});
		const payment = await client.billing.payments.create({
			amount: { currency: "EUR", value: "10.00" },
			description: "Injected SDK",
			idempotencyKey: "idem-topology-014",
			redirectUrl: "https://example.com/return",
		});
		assert.equal(payment.id, "tr_sdk_1");
		assert.equal(createCalls, 1);
		assert.equal(constructedWith, "test_topology_sdk");
		assert.equal(fetchCalls, 0);
	} finally {
		globalThis.fetch = previousFetch;
	}
});

test("T-BIL-TOPO-015: Mollie provider does not import a bundled Mollie SDK", () => {
	const mollieDir = join(srcRoot, "billing", "runtime", "local", "providers", "mollie");
	const files = [
		"payments.ts",
		"runtime.ts",
		"sdk/client-factory.ts",
		"index.ts",
	];
	for (const file of files) {
		const source = readFileSync(join(mollieDir, file), "utf8");
		assert.doesNotMatch(source, /@mollie\/api-client/);
		assert.doesNotMatch(source, /mollie-api-typescript/);
		assert.doesNotMatch(source, /requireNode\(/);
	}
	const types = readSrc("billing/providers/types.ts");
	assert.match(types, /sdk: MollieSdkConstructor/);
});
