/**
 * Characterization: current HEAD behavior that Milestone 1 must not break.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createAthenaRuntime } from "../../src/cloudflare/runtime.ts";
import { ATHENA_GATEWAY_ROUTES } from "../../src/gateway/routes.ts";
import * as nextServer from "../../src/next/server.ts";
import { createClient } from "../../src/v3-client.ts";

const SAMPLE_PG = "postgresql://postgres@127.0.0.1:5432/athena_direct_test";

test("baseline: createClient({ databaseUrl }) still materializes Node PG", () => {
	const client = createClient({
		databaseUrl: SAMPLE_PG,
		env: {},
	});
	assert.equal(typeof client.from, "function");
	assert.equal(client.capabilities?.db.local, true);
	assert.equal(client.capabilities?.db.engine, "postgresql");
});

test("baseline: ATHENA_GATEWAY_ROUTES still expose fetch/insert/update/delete", () => {
	assert.equal(ATHENA_GATEWAY_ROUTES.select, "/gateway/fetch");
	assert.equal(ATHENA_GATEWAY_ROUTES.insert, "/gateway/insert");
	assert.equal(ATHENA_GATEWAY_ROUTES.update, "/gateway/update");
	assert.equal(ATHENA_GATEWAY_ROUTES.delete, "/gateway/delete");
	assert.equal(ATHENA_GATEWAY_ROUTES.rawQuery, "/gateway/query");
});

test("baseline: createAthenaRuntime remains a Cloudflare client façade", () => {
	const { client, mode } = createAthenaRuntime({
		url: "https://athena.example.com",
		key: "key",
	});
	assert.equal(typeof client.from, "function");
	assert.equal(typeof mode, "string");
});

test("baseline: next/server still exports createAthenaServerClient", () => {
	assert.equal(typeof nextServer.createAthenaServerClient, "function");
});
