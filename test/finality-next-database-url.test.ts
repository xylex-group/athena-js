import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { createAthenaServerClient } from "../src/next/server.ts";
import { getAthenaClientInternals } from "../src/runtime/client-internals.ts";
import { ATHENA_PG_DIRECT_BASE_URL } from "../src/postgres/constants.ts";

test("createAthenaServerClient({ databaseUrl }) materializes Node postgres internals", async () => {
	const client = await createAthenaServerClient({
		auth: false,
		databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_finality",
		requestCookies: "",
		requestHeaders: {},
	});
	assert.equal(typeof client.from, "function");
	const internals = getAthenaClientInternals(client);
	assert.ok(internals);
	assert.equal(internals.plan.db.transport, "postgres");
	assert.equal(internals.plan.auth.runtime, "disabled");
	assert.equal(internals.gatewayTransport?.baseUrl, ATHENA_PG_DIRECT_BASE_URL);
});
