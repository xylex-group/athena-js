/**
 * Characterization: Embedded Billing HTTP is absent.
 * See docs/sdd/xylex/athena-js-embedded-billing-http/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import { createAthenaNextHandlers } from "../../src/next/data-handlers.ts";
import { createClient as createCoreClient } from "../../src/v3-client-core.ts";
import { createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

function mockTransport(): AthenaGatewayClient {
	const ok = async () =>
		({
			count: null,
			data: [],
			error: null,
			ok: true,
			raw: { data: [] },
			status: 200,
			statusText: "OK",
		}) as never;
	return {
		baseUrl: "https://athena.local/postgres-direct",
		buildHeaders() {
			return {};
		},
		deleteGateway: ok,
		fetchGateway: ok,
		insertGateway: ok,
		queryGateway: ok,
		async resolveCallOptions(options) {
			return options;
		},
		rpcGateway: ok,
		updateGateway: ok,
		async verifyConnection() {
			return { ok: true } as never;
		},
	};
}

test("B-BIL-HTTP-NO-HANDLERS: P?: createAthenaBillingHandlers does not exist", () => {
	assert.equal(existsSync(join(srcRoot, "next", "billing-handlers.ts")), false);
	const data = readFileSync(join(srcRoot, "next", "data-handlers.ts"), "utf8");
	assert.equal(data.includes("createAthenaBillingHandlers"), false);
});

test("B-BIL-HTTP-NEXT-SHAPE: P?: createAthenaNextHandlers does not return billing", () => {
	const client = createClient({
		auth: false,
		databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_bill_http",
		gatewayTransport: mockTransport(),
	});
	const next = createAthenaNextHandlers({
		client,
		security: { mode: "trusted" },
		unsafeAllowUnauthenticated: true,
	});
	assert.equal("billing" in next, false);
	assert.equal(typeof next.auth.GET, "function");
	assert.equal(typeof next.storage.POST, "function");
});

test("B-BIL-HTTP-NO-DISCOVERY: P?: discovery does not advertise endpoints.billing", async () => {
	const client = createClient({
		auth: false,
		databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_bill_http",
		gatewayTransport: mockTransport(),
	});
	const next = createAthenaNextHandlers({
		client,
		security: { mode: "trusted" },
		unsafeAllowUnauthenticated: true,
	});
	const response = await next.storage.GET(
		new Request("http://localhost/api/athena/storage"),
	);
	const json = (await response.json()) as {
		endpoints?: { billing?: string };
	};
	assert.equal(json.endpoints?.billing, undefined);
});

test("B-BIL-HTTP-BROWSER-REMOTE: P?: browser billing uses inferred remote URL not same-origin embedded", () => {
	const g = globalThis as { window?: unknown };
	const previous = g.window;
	g.window = {};
	try {
		const client = createCoreClient({
			url: "https://gateway.example.com",
			key: "ak_test",
		});
		assert.equal(
			typeof (client.billing as { payments?: { create?: unknown } }).payments
				?.create,
			"function",
		);
		const core = readFileSync(join(srcRoot, "v3-client-core.ts"), "utf8");
		assert.equal(core.includes("createBrowserBillingTransport"), false);
		assert.equal(core.includes("/api/athena/billing"), false);
	} finally {
		if (previous === undefined) {
			delete g.window;
		} else {
			g.window = previous;
		}
	}
});

test("B-BIL-HTTP-NO-CTOR: P?: createBillingClient is not a package export", async () => {
	const mod = await import("../../src/index.ts");
	assert.equal("createBillingClient" in mod, false);
});
