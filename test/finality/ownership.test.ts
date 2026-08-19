/**
 * N1 — AthenaRequestClient / request client cannot become the handler root.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import { createAthenaDataHandlers } from "../../src/next/data-handlers.ts";
import { AthenaRuntimeOwnershipError } from "../../src/runtime/client-internals.ts";
import { createClient } from "../../src/v3-client.ts";

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

test("N1: RequestClient / request client cannot become handler root", () => {
	const root = createClient({
		auth: false,
		databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_finality_n1",
		gatewayTransport: mockTransport(),
	});
	const view = root.withContext({ userId: "user-1" });
	assert.throws(
		() =>
			createAthenaDataHandlers({
				client: view as unknown as typeof root,
			}),
		(error: unknown) => {
			assert.ok(error instanceof AthenaRuntimeOwnershipError);
			assert.equal(error.code, "ATHENA_HANDLER_ROOT_CLIENT_REQUIRED");
			assert.equal(error.received, "request-view");
			return true;
		},
	);
});
