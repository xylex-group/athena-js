import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { executeLocalBillingPaymentCreate } from "../src/billing/runtime/local/execute/payments.ts";
import { createMollieBillingProviderRuntime } from "../src/billing/runtime/local/providers/mollie/runtime.ts";
import { BillingProviderRegistry } from "../src/billing/runtime/local/providers/registry.ts";
import type { BillingProviderRuntime } from "../src/billing/runtime/local/providers/types.ts";
import { FetchMollieSdk } from "./helpers/fetch-mollie-sdk.ts";

const executeDir = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"src",
	"billing",
	"runtime",
	"local",
	"execute",
);

function executeSource(file: string): string {
	return readFileSync(join(executeDir, file), "utf8");
}

function preflightBeforeResolve(src: string): boolean {
	const body = src.slice(src.indexOf("export async function"));
	const prepareIdx = body.indexOf("prepareBillingCommand({");
	const resolveIdx = body.indexOf("resolveLocalBillingProviderExecution({");
	return prepareIdx >= 0 && resolveIdx >= 0 && prepareIdx < resolveIdx;
}

test("P2: Run local preflight before resolving providers", async () => {
	let capabilityCalls = 0;
	const inner = createMollieBillingProviderRuntime({
		sdk: FetchMollieSdk,
		testKey: "test_xxx",
	});
	const runtime: BillingProviderRuntime = {
		customers: inner.customers,
		getCapabilities: async (binding) => {
			capabilityCalls += 1;
			return inner.getCapabilities(binding);
		},
		invoices: inner.invoices,
		paymentLinks: inner.paymentLinks,
		payments: inner.payments,
		provider: inner.provider,
		refunds: inner.refunds,
		subscriptions: inner.subscriptions,
		webhooks: inner.webhooks,
	};
	await assert.rejects(
		() =>
			executeLocalBillingPaymentCreate({
				configuredProviders: {
					mollie: { sdk: FetchMollieSdk, testKey: "test_xxx" },
				},
				payload: {
					amount: { currency: "EUR", value: "10.001" },
					idempotencyKey: "idem_local_create",
					provider: "mollie",
				},
				registry: new BillingProviderRegistry([runtime]),
				testMode: true,
			}),
		{ message: "ATHENA_BILLING_MONEY_SCALE_INVALID" },
	);
	assert.equal(capabilityCalls, 0);
	assert.equal(preflightBeforeResolve(executeSource("payments.ts")), true);
	assert.equal(preflightBeforeResolve(executeSource("customers.ts")), true);
	assert.equal(preflightBeforeResolve(executeSource("payment-links.ts")), true);
	assert.equal(preflightBeforeResolve(executeSource("refunds.ts")), true);
	assert.equal(preflightBeforeResolve(executeSource("subscriptions.ts")), true);
});
