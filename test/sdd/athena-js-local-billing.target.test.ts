/**
 * Target — PR 1–2 billing runtime contracts + RemoteBillingRuntime extract.
 *
 * See docs/sdd/xylex/athena-js-local-billing/SPEC.md
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	createBillingModule,
} from "../../src/billing/module.ts";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "src");
const billingDir = join(srcRoot, "billing");

function readBilling(rel: string): string {
	return readFileSync(join(billingDir, rel), "utf8");
}

test("P?: AthenaBillingRuntime is a narrow-port interface, not execute(operation)", () => {
	const typesPath = join(billingDir, "runtime", "types.ts");
	assert.equal(existsSync(typesPath), true);
	const src = readBilling("runtime/types.ts");
	assert.match(src, /export interface AthenaBillingRuntime/);
	assert.match(src, /readonly payments: BillingPaymentPort/);
	assert.match(src, /readonly customers: BillingCustomerPort/);
	assert.match(src, /readonly refunds: BillingRefundPort/);
	assert.match(src, /readonly paymentLinks: BillingPaymentLinkPort/);
	assert.match(src, /readonly subscriptions: BillingSubscriptionPort/);
	assert.match(src, /readonly invoices: BillingInvoicePort/);
	assert.match(src, /readonly webhooks: BillingWebhookPort/);
	assert.doesNotMatch(src, /execute\s*\(\s*operation/);
});

test("P?: every list contract uses BillingPage<T>", () => {
	const src = readBilling("runtime/types.ts");
	assert.match(src, /export interface BillingPage\s*<\s*T\s*>/);
	assert.match(src, /items:\s*T\[\]/);
	assert.match(src, /nextCursor\?:/);
	assert.match(src, /previousCursor\?:/);
	assert.match(
		src,
		/list\([^)]*\):\s*(?:\n\s*)?Promise<BillingPage<BillingPayment>>/,
	);
});

test("P?: payment port is list/create/get/cancel", () => {
	const src = readBilling("runtime/types.ts");
	assert.match(src, /export interface BillingPaymentPort/);
	assert.match(src, /list\(/);
	assert.match(src, /create\(/);
	assert.match(src, /get\(/);
	assert.match(src, /cancel\(/);
});

test("P?: BillingCapabilities is truthful per port and operation", () => {
	const src = readBilling("runtime/capabilities.ts");
	assert.match(src, /export interface BillingCapabilities/);
	assert.match(src, /payments:\s*boolean/);
	assert.match(src, /operations:\s*Partial</);
	assert.match(src, /export interface BillingOperationCapability/);
	assert.match(src, /unsupported_provider/);
	assert.match(src, /unsupported_operation/);
	assert.match(src, /missing_connection/);
	assert.match(src, /missing_permission/);
	assert.match(src, /missing_provider_scope/);
	assert.match(src, /runtime_unavailable/);
	assert.match(src, /missing_credential/);
	assert.match(src, /connectionId\?:/);
	assert.match(src, /export interface BillingCapabilityTarget/);
	assert.match(src, /target:\s*BillingCapabilityTarget/);
	assert.match(src, /kind:\s*"configured"\s*\|\s*"connection"/);
});

test("P?: unsupported operations throw a typed capability error", async () => {
	const { AthenaBillingCapabilityError } = await import(
		"../../src/billing/errors.ts"
	);
	const { assertBillingOperationAvailable } = await import(
		"../../src/billing/runtime/capabilities.ts"
	);
	const error = new AthenaBillingCapabilityError({
		operation: "payments.create",
		reason: "unsupported_operation",
	});
	assert.equal(error.code, "ATHENA_BILLING_OPERATION_UNAVAILABLE");
	assert.equal(error.reason, "unsupported_operation");
	assert.throws(
		() =>
			assertBillingOperationAvailable(
				{
					connected: false,
					connectionId: "conn_1",
					target: {
						kind: "connection",
						provider: "mollie",
						connectionId: "conn_1",
					},
					operations: {
						"payments.create": {
							available: false,
							reason: "unsupported_operation",
						},
					},
					ports: {
						customers: false,
						invoices: false,
						paymentLinks: false,
						payments: false,
						refunds: false,
						subscriptions: false,
						webhooks: false,
					},
					provider: "mollie",
					runtime: "local",
				},
				"payments.create",
			),
		(thrown: unknown) =>
			thrown instanceof AthenaBillingCapabilityError &&
			thrown.code === "ATHENA_BILLING_OPERATION_UNAVAILABLE",
	);
});

test("P?: capability module never silently falls back to remote", () => {
	const src = readBilling("runtime/capabilities.ts");
	assert.doesNotMatch(src, /fallback to remote/i);
	assert.doesNotMatch(src, /silently fall/i);
	assert.doesNotMatch(src, /fallBackToRemote/);
});

test("P?: createBillingModule HTTP mapping remains", async () => {
	const calls: string[] = [];
	const billing = createBillingModule({
		apiKey: "admin-key",
		baseUrl: "https://athena.example.com",
		fetchImpl: async (url, init) => {
			calls.push(`${(init?.method ?? "GET").toUpperCase()} ${String(url)}`);
			return new Response(JSON.stringify({ data: { ok: true } }), {
				headers: { "content-type": "application/json" },
				status: 200,
			});
		},
	});
	await billing.listPayments({
		connectionId: "11111111-1111-1111-1111-111111111111",
	});
	assert.ok(
		calls.some((call) =>
			call.includes("GET https://athena.example.com/billing/v1/payments"),
		),
	);
});

test("P?: RemoteBillingRuntime is extracted behind HTTP transport", async () => {
	assert.equal(
		existsSync(join(billingDir, "runtime", "remote", "transport.ts")),
		true,
	);
	assert.equal(
		existsSync(join(billingDir, "runtime", "remote", "runtime.ts")),
		true,
	);
	const { createRemoteBillingRuntime } = await import(
		"../../src/billing/runtime/remote/runtime.ts"
	);
	const calls: string[] = [];
	const runtime = createRemoteBillingRuntime({
		apiKey: "admin-key",
		baseUrl: "https://athena.example.com",
		fetchImpl: async (url, init) => {
			calls.push(`${(init?.method ?? "GET").toUpperCase()} ${String(url)}`);
			return new Response(JSON.stringify({ data: [{ id: "pay_1" }] }), {
				headers: { "content-type": "application/json" },
				status: 200,
			});
		},
	});
	assert.equal(runtime.mode, "remote");
	const page = await runtime.payments.list({
		connectionId: "11111111-1111-1111-1111-111111111111",
	});
	assert.equal(page.items.length, 1);
	assert.ok(
		calls.some((call) =>
			call.includes("GET https://athena.example.com/billing/v1/payments"),
		),
	);
});

const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";

function jsonResponse(data: unknown): Response {
	return new Response(JSON.stringify({ data }), {
		headers: { "content-type": "application/json" },
		status: 200,
	});
}

test("T-BIL-REMOTE-CAPS: remote getCapabilities calls /billing/v1/capabilities and preserves unavailable operations", async () => {
	const { createRemoteBillingRuntime } = await import(
		"../../src/billing/runtime/remote/runtime.ts"
	);
	const calls: string[] = [];
	const runtime = createRemoteBillingRuntime({
		apiKey: "admin-key",
		baseUrl: "https://athena.example.com",
		fetchImpl: async (url, init) => {
			calls.push(`${(init?.method ?? "GET").toUpperCase()} ${String(url)}`);
			return jsonResponse({
				actionCapabilities: [
					{
						available: true,
						operation: "list_payments",
						portAvailable: true,
					},
					{
						available: false,
						missingAthenaRights: [],
						missingProviderRequirements: [],
						operation: "create_payment",
						portAvailable: false,
					},
				],
				capabilities: {
					connected: true,
					provider: "stripe",
					status: "active",
				},
				ports: {
					customers: false,
					invoices: false,
					paymentLinks: false,
					payments: true,
					refunds: false,
					subscriptions: false,
					webhooks: false,
				},
			});
		},
	});
	const capabilities = await runtime.getCapabilities({
		connectionId: CONNECTION_ID,
		profileId: "pfl_remote",
	});
	assert.ok(
		calls.some((call) =>
			call.includes(
				`GET https://athena.example.com/billing/v1/capabilities?connectionId=${CONNECTION_ID}&profileId=pfl_remote`,
			),
		),
	);
	assert.equal(capabilities.provider, "stripe");
	assert.equal(capabilities.runtime, "remote");
	assert.equal(capabilities.connectionId, CONNECTION_ID);
	assert.deepEqual(capabilities.target, {
		kind: "connection",
		provider: "stripe",
		connectionId: CONNECTION_ID,
	});
	assert.equal(capabilities.ports.payments, true);
	assert.equal(capabilities.ports.customers, false);
	assert.equal(capabilities.operations["payments.list"]?.available, true);
	assert.equal(capabilities.operations["payments.create"]?.available, false);
	assert.equal(
		capabilities.operations["payments.create"]?.reason,
		"unsupported_operation",
	);
});

test("T-BIL-REMOTE-PAYMENT-SHAPE: a realistic canonical Rust payment is returned without remapping", async () => {
	const { createRemoteBillingRuntime } = await import(
		"../../src/billing/runtime/remote/runtime.ts"
	);
	const rustPayment = {
		amount: { currency: "EUR", value: "10.00" },
		amountRefunded: { currency: "EUR", value: "2.00" },
		createdAt: "2026-08-23T12:00:00Z",
		description: "Order 42",
		metadata: { orderId: "42" },
		paidAt: "2026-08-23T12:01:00Z",
		provider: "mollie",
		providerCustomerId: "cst_1",
		providerPaymentId: "tr_1",
		providerPaymentLinkId: "pl_1",
		providerProfileId: "pfl_1",
		providerSubscriptionId: "sub_1",
		raw: { id: "tr_1" },
		status: "paid",
	};
	const runtime = createRemoteBillingRuntime({
		apiKey: "admin-key",
		baseUrl: "https://athena.example.com",
		fetchImpl: async () => jsonResponse(rustPayment),
	});
	const payment = await runtime.payments.get({
		connectionId: CONNECTION_ID,
		id: "tr_1",
	});
	assert.equal(payment.providerPaymentId, "tr_1");
	assert.equal(payment.providerCustomerId, "cst_1");
	assert.equal(payment.providerProfileId, "pfl_1");
	assert.equal(payment.providerSubscriptionId, "sub_1");
	assert.equal(payment.providerPaymentLinkId, "pl_1");
	assert.equal(payment.amountRefunded?.value, "2.00");
	assert.equal(payment.paidAt, "2026-08-23T12:01:00Z");
	assert.equal((payment as { customerId?: unknown }).customerId, undefined);
});

test("T-BIL-REMOTE-REFUND-SHAPE: refund amount, status, and providerPaymentId stay optional", async () => {
	const { createRemoteBillingRuntime } = await import(
		"../../src/billing/runtime/remote/runtime.ts"
	);
	const rustRefund = {
		description: null,
		metadata: {},
		provider: "mollie",
		providerPaymentId: null,
		providerRefundId: "re_1",
		raw: { id: "re_1" },
	};
	const runtime = createRemoteBillingRuntime({
		apiKey: "admin-key",
		baseUrl: "https://athena.example.com",
		fetchImpl: async () => jsonResponse(rustRefund),
	});
	const refund = await runtime.refunds.get({
		connectionId: CONNECTION_ID,
		paymentId: "tr_1",
		refundId: "re_1",
	});
	assert.equal(refund.providerRefundId, "re_1");
	assert.equal(refund.providerPaymentId, null);
	assert.equal(refund.amount, undefined);
	assert.equal(refund.status, undefined);
	assert.equal((refund as { paymentId?: unknown }).paymentId, undefined);
});

test("T-BIL-PAGE-CURSORS: remote paginated response preserves nextCursor and previousCursor", async () => {
	const { createRemoteBillingRuntime } = await import(
		"../../src/billing/runtime/remote/runtime.ts"
	);
	const runtime = createRemoteBillingRuntime({
		apiKey: "admin-key",
		baseUrl: "https://athena.example.com",
		fetchImpl: async () =>
			jsonResponse({
				items: [{ provider: "mollie", providerPaymentId: "tr_1" }],
				nextCursor: "cur_next",
				previousCursor: "cur_prev",
			}),
	});
	const page = await runtime.payments.list({
		connectionId: CONNECTION_ID,
	});
	assert.equal(page.items.length, 1);
	assert.equal(page.nextCursor, "cur_next");
	assert.equal(page.previousCursor, "cur_prev");
});

test("T-BIL-CONNECTION-REF-SSOT: runtime imports BillingConnectionRef from billing/types.ts", () => {
	const runtimeTypes = readBilling("runtime/types.ts");
	assert.doesNotMatch(runtimeTypes, /export interface BillingConnectionRef/);
	assert.match(
		runtimeTypes,
		/import type \{[\s\S]*BillingConnectionRef[\s\S]*\} from "\.\.\/types\.ts"/,
	);
});

test("T-BIL-LOCAL-ERROR-EXPORT: public billing barrel exports local-runtime error", () => {
	const barrel = readBilling("index.ts");
	assert.match(barrel, /ATHENA_BILLING_LOCAL_RUNTIME_SERVER_REQUIRED/);
});
