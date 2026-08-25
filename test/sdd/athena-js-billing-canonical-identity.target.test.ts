/**
 * Target — canonical billing identities and required fields.
 *
 * Phase 0 freeze (Rust adapter SSOT):
 * | Resource     | Operation | Required identities           | Frozen TS shape              |
 * | ------------ | --------- | ----------------------------- | ---------------------------- |
 * | refund       | get       | paymentId + refundId          | paymentId + refundId         |
 * | refund       | cancel    | paymentId + refundId          | paymentId + refundId         |
 * | subscription | get       | customerId + subscriptionId   | customerId + subscriptionId  |
 * | subscription | update    | customerId + subscriptionId   | customerId + subscriptionId  |
 * | subscription | cancel    | customerId + subscriptionId   | customerId + subscriptionId  |
 * | invoice      | get       | invoiceId                     | invoiceId                    |
 * | invoice      | list      | cursor pagination             | cursor/limit; no offset live |
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const typesSrc = readFileSync(
	join(here, "..", "..", "src", "billing", "types.ts"),
	"utf8",
);

function interfaceBody(name: string): string {
	const match = typesSrc.match(
		new RegExp(`export interface ${name}[^{]*\\{([\\s\\S]*?)\\n\\}`),
	);
	assert.ok(match, `missing interface ${name}`);
	return match[1] ?? "";
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		status,
	});
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

test("T-BIL-CAN-REFUND-ID: refund get/cancel require payment + refund IDs", () => {
	for (const name of ["BillingGetRefundInput", "BillingCancelRefundInput"]) {
		const body = interfaceBody(name);
		assert.match(body, /^\tpaymentId: string;/m);
		assert.match(body, /^\trefundId: string;/m);
		assert.doesNotMatch(body, /^\tid: string;/m);
	}
});

test("T-BIL-CAN-SUB-ID: subscription identity matches provider/Rust route", () => {
	for (const name of [
		"BillingGetSubscriptionInput",
		"BillingUpdateSubscriptionInput",
		"BillingCancelSubscriptionInput",
	]) {
		const body = interfaceBody(name);
		assert.match(body, /^\tcustomerId: string;/m);
		assert.match(body, /^\tsubscriptionId: string;/m);
		assert.doesNotMatch(body, /^\tid: string;/m);
	}
	const invoice = interfaceBody("BillingGetInvoiceInput");
	assert.match(invoice, /^\tinvoiceId: string;/m);
	assert.doesNotMatch(invoice, /^\tid: string;/m);
});

test("T-BIL-CAN-REQUIRED: canonical required fields match Rust", () => {
	const refund = interfaceBody("BillingCreateRefundInput");
	assert.match(refund, /^\tamount: BillingMoney;/m);
	assert.doesNotMatch(refund, /^\tamount\?:/m);

	const paymentLink = interfaceBody("BillingCreatePaymentLinkInput");
	assert.match(paymentLink, /^\tamount: BillingMoney;/m);
	assert.match(paymentLink, /^\tdescription: string;/m);
	assert.doesNotMatch(paymentLink, /^\tamount\?:/m);
	assert.doesNotMatch(paymentLink, /^\tdescription\?:/m);

	const subscription = interfaceBody("BillingCreateSubscriptionInput");
	assert.match(subscription, /^\tamount: BillingMoney;/m);
	assert.match(subscription, /^\tinterval: string;/m);
	assert.match(subscription, /^\tdescription: string;/m);
	assert.doesNotMatch(subscription, /^\tamount\?:/m);
	assert.doesNotMatch(subscription, /^\tinterval\?:/m);
	assert.doesNotMatch(subscription, /^\tdescription\?:/m);
});

test("T-BIL-REMOTE-PARITY: corrected public shape works remote", async () => {
	const urls: string[] = [];
	const client = createClient({
		billing: { mode: "remote" },
		key: "ak_test",
		url: "https://athena.example.com",
	});
	await withMockedFetch(async (url, init) => {
		urls.push(`${(init?.method ?? "GET").toUpperCase()} ${String(url)}`);
		return jsonResponse({
			provider: "mollie",
			providerRefundId: "re_1",
			raw: {},
		});
	}, async () => {
		await client.billing.refunds.get({
			connectionId: "11111111-1111-1111-1111-111111111111",
			paymentId: "tr_1",
			refundId: "re_1",
		});
		await client.billing.subscriptions.get({
			connectionId: "11111111-1111-1111-1111-111111111111",
			customerId: "cst_1",
			subscriptionId: "sub_1",
		});
		await client.billing.invoices.get({
			connectionId: "11111111-1111-1111-1111-111111111111",
			invoiceId: "inv_1",
		});
	});
	assert.ok(
		urls.some(
			(url) =>
				url.includes("GET ") &&
				url.includes("/billing/v1/refunds/re_1") &&
				url.includes("paymentId=tr_1"),
		),
	);
	assert.ok(
		urls.some(
			(url) =>
				url.includes("GET ") &&
				url.includes("/billing/v1/subscriptions/sub_1") &&
				url.includes("customerId=cst_1"),
		),
	);
	assert.ok(
		urls.some(
			(url) => url.includes("GET ") && url.includes("/billing/v1/invoices/inv_1"),
		),
	);
	assert.equal(urls.some((url) => url.includes("api.mollie.com")), false);
});
