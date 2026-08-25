import { FetchMollieSdk } from "../helpers/fetch-mollie-sdk.ts";
/**
 * Target — local billing provider registry + canonical environments/credentials.
 *
 * See docs/sdd/xylex/athena-js-local-billing/SPEC.md
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getAthenaClientInternals } from "../../src/runtime/client-internals.ts";
import { createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "src");
const billingDir = join(srcRoot, "billing");
const providerRuntimeDir = join(billingDir, "runtime", "local", "providers");

function readSrc(relFromSrc: string): string {
	return readFileSync(join(srcRoot, relFromSrc), "utf8");
}

function readBilling(rel: string): string {
	return readFileSync(join(billingDir, rel), "utf8");
}

const IMPORT_FROM_RE =
	/^[ \t]*import[ \t]+(type[ \t]+)?[^;]*?[ \t]from[ \t]*["']([^"']+)["']/gm;
const EXPORT_FROM_RE =
	/^[ \t]*export[ \t]+(type[ \t]+)?(?:\*|[^{]*\{[^;]*\})[ \t]*from[ \t]*["']([^"']+)["']/gm;
const SIDE_EFFECT_IMPORT_RE = /^[ \t]*import[ \t]*["']([^"']+)["']/gm;

function collectRelativeSpecifiers(source: string): string[] {
	const specifiers: string[] = [];
	for (const match of source.matchAll(IMPORT_FROM_RE)) {
		if (match[1]) {
			continue;
		}
		if (match[2]?.startsWith(".")) {
			specifiers.push(match[2]);
		}
	}
	for (const match of source.matchAll(EXPORT_FROM_RE)) {
		if (match[1]) {
			continue;
		}
		if (match[2]?.startsWith(".")) {
			specifiers.push(match[2]);
		}
	}
	for (const match of source.matchAll(SIDE_EFFECT_IMPORT_RE)) {
		if (match[1]?.startsWith(".")) {
			specifiers.push(match[1]);
		}
	}
	return specifiers;
}

function resolveRelative(fromFile: string, specifier: string): string | undefined {
	const resolved = fileURLToPath(new URL(specifier, pathToFileURL(`${dirname(fromFile)}/`)));
	const candidates = specifier.endsWith(".ts")
		? [resolved]
		: [`${resolved}.ts`, join(resolved, "index.ts")];
	return candidates.find((candidate) => existsSync(candidate));
}

test("T-BIL-PROVIDER-RUNTIME: BillingProviderRuntime has optional narrow resource ports", () => {
	const typesPath = join(providerRuntimeDir, "types.ts");
	assert.equal(existsSync(typesPath), true);
	const src = readFileSync(typesPath, "utf8");
	assert.match(src, /export interface BillingProviderRuntime/);
	assert.match(src, /readonly payments\?:/);
	assert.match(src, /readonly customers\?:/);
	assert.match(src, /readonly refunds\?:/);
	assert.match(src, /readonly paymentLinks\?:/);
	assert.match(src, /readonly subscriptions\?:/);
	assert.match(src, /readonly invoices\?:/);
	assert.match(src, /readonly webhooks\?:/);
	assert.doesNotMatch(src, /execute\s*\(\s*operation/);
});

test("T-BIL-PROVIDER-NO-CONNECTION: provider payment port does not accept connectionId", () => {
	const src = readFileSync(join(providerRuntimeDir, "types.ts"), "utf8");
	assert.match(src, /export interface BillingProviderPaymentPort/);
	assert.match(src, /export interface BillingProviderCreatePaymentInput/);
	assert.doesNotMatch(
		src,
		/interface BillingProviderCreatePaymentInput[\s\S]*connectionId/,
	);
	assert.doesNotMatch(
		src,
		/interface BillingProviderPaymentPort[\s\S]*connectionId/,
	);
});

test("T-BIL-REGISTRY: registry registers, requires, and lists providers", async () => {
	const { BillingProviderRegistry } = await import(
		"../../src/billing/runtime/local/providers/registry.ts"
	);
	const { createMollieBillingProviderRuntime } = await import(
		"../../src/billing/runtime/local/providers/mollie/runtime.ts"
	);
	const mollie = createMollieBillingProviderRuntime({
		sdk: FetchMollieSdk,
		testKey: "test_xxx",
	});
	const registry = new BillingProviderRegistry([mollie]);
	assert.equal(registry.has("mollie"), true);
	assert.equal(registry.get("mollie")?.provider, "mollie");
	assert.equal(registry.require("mollie").provider, "mollie");
	const listed = registry.list();
	assert.equal(listed.length, 1);
	assert.equal(listed[0]?.provider, "mollie");
	assert.equal(Object.isFrozen(listed), true);
	assert.notEqual(listed, registry.list());
});

test("T-BIL-REGISTRY-DUPLICATE: duplicate provider registration fails", async () => {
	const { BillingProviderRegistry } = await import(
		"../../src/billing/runtime/local/providers/registry.ts"
	);
	const { createMollieBillingProviderRuntime } = await import(
		"../../src/billing/runtime/local/providers/mollie/runtime.ts"
	);
	const registry = new BillingProviderRegistry();
	registry.register(createMollieBillingProviderRuntime({ sdk: FetchMollieSdk, testKey: "test_a" }));
	assert.throws(
		() =>
			registry.register(
				createMollieBillingProviderRuntime({ sdk: FetchMollieSdk, testKey: "test_b" }),
			),
		(error: unknown) =>
			error instanceof Error && /already registered|duplicate/i.test(error.message),
	);
});

test("T-BIL-CONFIG-MOLLIE: configured Mollie binding normalizes without network I/O", async () => {
	const { normalizeBillingProviderConfig } = await import(
		"../../src/billing/runtime/local/providers/config.ts"
	);
	const previousFetch = globalThis.fetch;
	let fetchCalls = 0;
	globalThis.fetch = (async () => {
		fetchCalls += 1;
		return new Response("nope", { status: 500 });
	}) as typeof fetch;
	try {
		const normalized = normalizeBillingProviderConfig({
			mollie: { sdk: FetchMollieSdk, testKey: "test_xxx",
				liveKey: "live_xxx",
				profileId: "pfl_xxx",
			},
		});
		assert.equal(normalized.mollie?.provider, "mollie");
		assert.equal(normalized.mollie?.profileId, "pfl_xxx");
		assert.equal(normalized.mollie?.credentials.test != null, true);
		assert.equal(normalized.mollie?.credentials.live != null, true);
		assert.equal(fetchCalls, 0);
	} finally {
		globalThis.fetch = previousFetch;
	}
});

test("T-BIL-ENVIRONMENT: billing.testMode defaults to test and is not a provider field", async () => {
	const { resolveBillingEnvironment, billingEnvironmentName } = await import(
		"../../src/billing/runtime/environment.ts"
	);
	assert.deepEqual(resolveBillingEnvironment(), {
		testMode: true,
		name: "test",
	});
	assert.deepEqual(resolveBillingEnvironment({ testMode: false }), {
		testMode: false,
		name: "live",
	});
	assert.equal(billingEnvironmentName(true), "test");
	assert.equal(billingEnvironmentName(false), "live");
	const src = readSrc("v3-client-core.ts");
	assert.match(src, /testMode\?:/);
	assert.doesNotMatch(
		readBilling("providers/types.ts"),
		/export type MollieBillingProviderConfig[\s\S]{0,400}testMode\?:/,
	);
});

test("T-BIL-CREDENTIAL-SELECT: testMode selects the matching slot and never falls back", async () => {
	const { normalizeBillingProviderConfig } = await import(
		"../../src/billing/runtime/local/providers/config.ts"
	);
	const { resolveBillingCredential } = await import(
		"../../src/billing/runtime/credentials.ts"
	);
	const normalized = normalizeBillingProviderConfig({
		mollie: { sdk: FetchMollieSdk, testKey: "test_xxx",
			liveKey: "live_xxx",
		},
	});
	const testSelected = resolveBillingCredential({
		provider: "mollie",
		testMode: true,
		binding: {
			kind: "configured",
			provider: "mollie",
			credentials: normalized.mollie?.credentials ?? {},
			providerConfig: {},
		},
	});
	assert.equal(testSelected.environment, "test");
	assert.equal(testSelected.testMode, true);
	assert.equal(testSelected.credential.revealForProviderRuntime(), "test_xxx");
	const liveSelected = resolveBillingCredential({
		provider: "mollie",
		testMode: false,
		binding: {
			kind: "configured",
			provider: "mollie",
			credentials: normalized.mollie?.credentials ?? {},
			providerConfig: {},
		},
	});
	assert.equal(liveSelected.environment, "live");
	assert.equal(liveSelected.credential.revealForProviderRuntime(), "live_xxx");
});

test("T-BIL-CREDENTIAL-UNAVAILABLE: missing selected slot fails closed", async () => {
	const { normalizeBillingProviderConfig } = await import(
		"../../src/billing/runtime/local/providers/config.ts"
	);
	const { resolveBillingCredential } = await import(
		"../../src/billing/runtime/credentials.ts"
	);
	const {
		ATHENA_BILLING_CREDENTIAL_UNAVAILABLE,
		AthenaBillingCredentialError,
	} = await import("../../src/billing/errors.ts");
	const normalized = normalizeBillingProviderConfig({
		mollie: { sdk: FetchMollieSdk, testKey: "test_xxx" },
	});
	assert.throws(
		() =>
			resolveBillingCredential({
				provider: "mollie",
				testMode: false,
				binding: {
					kind: "configured",
					provider: "mollie",
					credentials: normalized.mollie?.credentials ?? {},
					providerConfig: {},
				},
			}),
		(error: unknown) =>
			error instanceof AthenaBillingCredentialError &&
			error.code === ATHENA_BILLING_CREDENTIAL_UNAVAILABLE &&
			error.environment === "live" &&
			error.provider === "mollie" &&
			!error.message.includes("test_xxx"),
	);
});

test("T-BIL-CREDENTIAL-MISMATCH: slot/environment contradictions fail closed", async () => {
	const { normalizeBillingProviderConfig } = await import(
		"../../src/billing/runtime/local/providers/config.ts"
	);
	const {
		ATHENA_BILLING_CREDENTIAL_ENVIRONMENT_MISMATCH,
		AthenaBillingCredentialError,
	} = await import("../../src/billing/errors.ts");
	assert.throws(
		() =>
			normalizeBillingProviderConfig({
				mollie: { sdk: FetchMollieSdk, testKey: "live_xxx" },
			}),
		(error: unknown) =>
			error instanceof AthenaBillingCredentialError &&
			error.code === ATHENA_BILLING_CREDENTIAL_ENVIRONMENT_MISMATCH &&
			!String(error).includes("live_xxx"),
	);
});

test("T-BIL-SECRET: BillingSecret redacts in JSON and string form", async () => {
	const { BillingSecret } = await import(
		"../../src/billing/runtime/credentials.ts"
	);
	const secret = new BillingSecret("live_super_secret_api_key");
	assert.equal(secret.revealForProviderRuntime(), "live_super_secret_api_key");
	assert.equal(JSON.stringify(secret), '"[REDACTED]"');
	assert.equal(String(secret), "[REDACTED]");
	assert.equal(JSON.stringify({ secret }).includes("live_super_secret"), false);
});

test("T-BIL-STRIPE-CONFIG: Stripe contracts normalize keys and register a fail-closed runtime", async () => {
	const { normalizeBillingProviderConfig } = await import(
		"../../src/billing/runtime/local/providers/config.ts"
	);
	const { createBillingProviderRegistry } = await import(
		"../../src/billing/runtime/local/providers/create-registry.ts"
	);
	const src = readBilling("providers/types.ts");
	assert.match(src, /export type StripeBillingProviderConfig/);
	assert.match(src, /secret_key/);
	assert.match(src, /restricted_key/);
	assert.match(src, /oauth_access_token/);
	const normalized = normalizeBillingProviderConfig({
		stripe: {
			testKey: "sk_test_xxx",
			liveKey: "sk_live_xxx",
		},
	});
	assert.equal(normalized.stripe?.provider, "stripe");
	assert.equal(normalized.stripe?.credentials.test != null, true);
	assert.equal(normalized.stripe?.credentials.live != null, true);
	const registry = createBillingProviderRegistry({
		stripe: {
			testKey: "sk_test_xxx",
		},
	});
	assert.equal(registry.has("stripe"), true);
	assert.equal(registry.get("stripe")?.provider, "stripe");
	assert.equal(registry.get("stripe")?.payments, undefined);
});

test("T-BIL-EXECUTION-CONTEXT: context carries resolved environment and credential", async () => {
	const { createBillingProviderExecutionContext } = await import(
		"../../src/billing/runtime/local/providers/execution-context.ts"
	);
	const { normalizeBillingProviderConfig } = await import(
		"../../src/billing/runtime/local/providers/config.ts"
	);
	const normalized = normalizeBillingProviderConfig({
		mollie: { sdk: FetchMollieSdk, testKey: "test_xxx",
			liveKey: "live_xxx",
		},
	});
	const context = createBillingProviderExecutionContext({
		binding: {
			kind: "configured",
			provider: "mollie",
			credentials: normalized.mollie?.credentials ?? {},
			providerConfig: { profileId: "pfl_xxx" },
		},
		testMode: true,
	});
	assert.equal(context.provider, "mollie");
	assert.equal(context.environment.testMode, true);
	assert.equal(context.environment.name, "test");
	assert.equal(context.credential.kind, "api_key");
	assert.equal(context.credential.revealForProviderRuntime(), "test_xxx");
	assert.equal(context.binding.kind, "configured");
});

test("T-BIL-TARGET-PROVIDER: provider:\"mollie\" resolves configured Mollie", async () => {
	const { createMollieBillingProviderRuntime } = await import(
		"../../src/billing/runtime/local/providers/mollie/runtime.ts"
	);
	const { BillingProviderRegistry } = await import(
		"../../src/billing/runtime/local/providers/registry.ts"
	);
	const { resolveBillingExecutionTarget } = await import(
		"../../src/billing/runtime/local/providers/resolve-target.ts"
	);
	const registry = new BillingProviderRegistry([
		createMollieBillingProviderRuntime({ sdk: FetchMollieSdk, testKey: "test_xxx" }),
	]);
	const target = resolveBillingExecutionTarget({
		configuredProviders: {
			mollie: { sdk: FetchMollieSdk, testKey: "test_xxx" },
		},
		registry,
		target: { provider: "mollie" },
	});
	assert.equal(target.provider, "mollie");
	assert.equal(target.kind, "configured");
});

test("T-BIL-TARGET-DEFAULT: one configured provider + no selector resolves it", async () => {
	const { createMollieBillingProviderRuntime } = await import(
		"../../src/billing/runtime/local/providers/mollie/runtime.ts"
	);
	const { BillingProviderRegistry } = await import(
		"../../src/billing/runtime/local/providers/registry.ts"
	);
	const { resolveBillingExecutionTarget } = await import(
		"../../src/billing/runtime/local/providers/resolve-target.ts"
	);
	const registry = new BillingProviderRegistry([
		createMollieBillingProviderRuntime({ sdk: FetchMollieSdk, testKey: "test_xxx" }),
	]);
	const target = resolveBillingExecutionTarget({
		configuredProviders: {
			mollie: { sdk: FetchMollieSdk, testKey: "test_xxx" },
		},
		registry,
		target: {},
	});
	assert.equal(target.provider, "mollie");
});

test("T-BIL-TARGET-AMBIGUOUS: multiple configured providers + no selector fails", async () => {
	const { BillingProviderRegistry } = await import(
		"../../src/billing/runtime/local/providers/registry.ts"
	);
	const { resolveBillingExecutionTarget } = await import(
		"../../src/billing/runtime/local/providers/resolve-target.ts"
	);
	const { ATHENA_BILLING_TARGET_AMBIGUOUS, AthenaBillingProviderError } =
		await import("../../src/billing/errors.ts");
	assert.throws(
		() =>
			resolveBillingExecutionTarget({
				configuredProviders: {
					mollie: { sdk: FetchMollieSdk, testKey: "test_xxx" },
					stripe: { testKey: "sk_test" },
				},
				registry: new BillingProviderRegistry(),
				target: {},
			}),
		(error: unknown) =>
			error instanceof AthenaBillingProviderError &&
			error.code === ATHENA_BILLING_TARGET_AMBIGUOUS,
	);
});

test("T-BIL-TARGET-MISSING: no configured providers fails", async () => {
	const { BillingProviderRegistry } = await import(
		"../../src/billing/runtime/local/providers/registry.ts"
	);
	const { resolveBillingExecutionTarget } = await import(
		"../../src/billing/runtime/local/providers/resolve-target.ts"
	);
	const {
		ATHENA_BILLING_PROVIDER_NOT_CONFIGURED,
		AthenaBillingProviderError,
	} = await import("../../src/billing/errors.ts");
	assert.throws(
		() =>
			resolveBillingExecutionTarget({
				configuredProviders: {},
				registry: new BillingProviderRegistry(),
				target: {},
			}),
		(error: unknown) =>
			error instanceof AthenaBillingProviderError &&
			error.code === ATHENA_BILLING_PROVIDER_NOT_CONFIGURED,
	);
});

test("T-BIL-SECRETS: diagnostics never serialize provider secrets", async () => {
	const { normalizeBillingProviderConfig } = await import(
		"../../src/billing/runtime/local/providers/config.ts"
	);
	const { toBillingProviderDiagnostics } = await import(
		"../../src/billing/runtime/local/providers/config.ts"
	);
	const secret = "live_super_secret_api_key";
	const normalized = normalizeBillingProviderConfig({
		mollie: { sdk: FetchMollieSdk, liveKey: secret, profileId: "pfl_xxx" },
	});
	const diagnostics = toBillingProviderDiagnostics(normalized);
	const serialized = JSON.stringify(diagnostics);
	assert.equal(serialized.includes(secret), false);
	assert.equal(serialized.includes("apiKey"), false);
	assert.equal(serialized.includes("testKey"), false);
	assert.equal(serialized.includes("liveKey"), false);
	assert.match(serialized, /"provider":"mollie"/);
	assert.match(serialized, /"configured":true/);
});

test("T-BIL-BROWSER-GRAPH: browser entry does not import local Mollie implementation", () => {
	const visited = new Set<string>();
	const queue = [join(srcRoot, "browser.ts")];
	while (queue.length > 0) {
		const file = queue.pop() as string;
		const normalized = file.replaceAll("\\", "/");
		if (visited.has(normalized)) {
			continue;
		}
		visited.add(normalized);
		assert.equal(
			normalized.includes("runtime/local/providers/mollie"),
			false,
			normalized,
		);
		const source = readFileSync(file, "utf8");
		assert.doesNotMatch(source, /@mollie\/api-client/);
		for (const specifier of collectRelativeSpecifiers(source)) {
			const resolved = resolveRelative(file, specifier);
			if (resolved) {
				queue.push(resolved);
			}
		}
	}
	assert.ok(visited.size > 10);
});

test("T-BIL-ROOT-OWNERSHIP: provider registry is shared by client views", () => {
	const client = createClient({
		billing: {
			testMode: true,
			providers: {
				mollie: { sdk: FetchMollieSdk, testKey: "test_xxx",
				},
			},
		},
		key: "ak_test",
		url: "https://athena.example.com",
	});
	const view = client.withContext({ userId: "user_1" });
	const rootInternals = getAthenaClientInternals(client);
	const viewInternals = getAthenaClientInternals(view);
	assert.ok(rootInternals?.billingProviderRegistry);
	assert.equal(
		rootInternals?.billingProviderRegistry,
		viewInternals?.billingProviderRegistry,
	);
	assert.equal(rootInternals?.billingProviderRegistry?.has("mollie"), true);
});

test("T-BIL-EXECUTION-TARGET: canonical inputs use BillingExecutionTarget", () => {
	const src = readBilling("types.ts");
	assert.match(src, /export interface BillingExecutionTarget/);
	assert.match(src, /connectionId\?:/);
	assert.match(src, /provider\?:/);
	assert.match(
		src,
		/interface BillingCreatePaymentInput\s+extends BillingExecutionTarget/,
	);
	assert.match(
		src,
		/interface BillingListPaymentsInput\s+extends BillingExecutionTarget/,
	);
	assert.match(
		src,
		/interface BillingCreateCustomerInput\s+extends BillingExecutionTarget/,
	);
	assert.match(
		src,
		/interface BillingCreateRefundInput\s+extends BillingExecutionTarget/,
	);
	assert.match(
		src,
		/interface BillingCreatePaymentLinkInput\s+extends BillingExecutionTarget/,
	);
	assert.match(
		src,
		/interface BillingCreateSubscriptionInput\s+extends BillingExecutionTarget/,
	);
	assert.match(
		src,
		/interface BillingListInvoicesInput\s+extends BillingExecutionTarget/,
	);
	assert.match(
		src,
		/interface BillingCreateWebhookInput\s+extends BillingExecutionTarget/,
	);
	assert.match(src, /export interface BillingConnectionRef/);
	assert.match(src, /connectionId: string/);
});

test("T-BIL-CLIENT-CONFIG: createClient accepts testMode and configured providers", () => {
	const src = readSrc("v3-client-core.ts");
	assert.match(src, /providers\?:/);
	assert.match(src, /mollie\?:/);
	assert.match(src, /stripe\?:/);
	assert.match(src, /testMode\?:/);
	const client = createClient({
		billing: {
			testMode: true,
			providers: {
				mollie: { sdk: FetchMollieSdk, testKey: "test_xxx",
					liveKey: "live_xxx",
				},
				stripe: {
					testKey: "sk_test_xxx",
					liveKey: "sk_live_xxx",
				},
			},
		},
		key: "ak_test",
		url: "https://athena.example.com",
	});
	assert.ok(getAthenaClientInternals(client)?.billingProviderRegistry?.has("mollie"));
	assert.equal(
		getAthenaClientInternals(client)?.billingProviderRegistry?.has("stripe"),
		true,
	);
});
