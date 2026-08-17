import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import type { AthenaGatewayClient } from "../src/gateway/client.ts";
import {
	createAthenaDataHandlers,
	createAthenaNextHandlers,
} from "../src/next/data-handlers.ts";
import { getAthenaClientInternals } from "../src/runtime/client-internals.ts";
import { createClient } from "../src/v3-client.ts";

function mockTransport(label: string): AthenaGatewayClient & { label: string } {
	const ok = async () =>
		({
			count: null,
			data: [{ id: label }],
			error: null,
			ok: true,
			raw: { data: [{ id: label }] },
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
		label,
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

test("createAthenaDataHandlers({ client }) reuses the root postgres transport", async () => {
	const transport = mockTransport("root-pool");
	const client = createClient({
		auth: false,
		databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_handlers",
		gatewayTransport: transport,
	});
	const internals = getAthenaClientInternals(client);
	assert.equal(internals?.gatewayTransport, transport);

	const handlers = createAthenaDataHandlers({
		client,
		security: { mode: "trusted" },
		unsafeAllowUnauthenticated: true,
	});
	const response = await handlers.GET(
		new Request("http://localhost/api/athena/capabilities"),
	);
	assert.equal(response.ok, true);
	const body = (await response.json()) as { runtime?: string };
	assert.equal(body.runtime, "local");
});

test("createAthenaDataHandlers rejects withContext views", () => {
	const client = createClient({
		auth: false,
		databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_handlers",
		gatewayTransport: mockTransport("view"),
	});
	const view = client.withContext({});
	assert.throws(
		() => createAthenaDataHandlers({ client: view }),
		/root createClient instance/,
	);
});

test("createAthenaDataHandlers rejects hosted-only roots", () => {
	const client = createClient({
		key: "publishable",
		url: "https://hosted.example",
	});
	assert.throws(
		() => createAthenaDataHandlers({ client }),
		/local database transport/,
	);
});

test("createAthenaNextHandlers exposes auth and data from the root", () => {
	const client = createClient({
		auth: {
			mode: "remote",
			routing: "same-origin",
			upstreamUrl: "https://auth.example.com",
		},
		databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_handlers",
		gatewayTransport: mockTransport("next-handlers"),
	});
	const next = createAthenaNextHandlers({
		client,
		security: { mode: "trusted" },
		unsafeAllowUnauthenticated: true,
	});
	assert.equal(typeof next.auth.GET, "function");
	assert.equal(typeof next.auth.POST, "function");
	assert.equal(typeof next.data.POST, "function");
	assert.equal(typeof next.data.GET, "function");
});
