import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { AthenaConfigurationError, createClient } from "../src/index.ts";
import { ATHENA_PG_DIRECT_BASE_URL } from "../src/postgres/constants.ts";

const SAMPLE_PG = "postgresql://postgres@127.0.0.1:5432/athena_direct_test";

test("createClient accepts pgUri-only without ATHENA_URL or API key", () => {
	const client = createClient({
		db: { pgUri: SAMPLE_PG },
		env: {},
	});
	assert.ok(client);
	assert.equal(client.capabilities?.db.engine, "postgresql");
	assert.equal(client.capabilities?.db.local, true);
	assert.equal(client.capabilities?.db.layers.flatCrud, true);
	assert.equal(client.capabilities?.db.layers.rpc, true);
});

test("createClient accepts pgUri-only with mode auto", () => {
	const client = createClient({
		db: { pgUri: SAMPLE_PG },
		mode: "auto",
		env: {},
	});
	assert.ok(client);
	assert.equal(client.capabilities?.db.engine, "postgresql");
	assert.equal(client.capabilities?.db.local, true);
});

test("createClient accepts pgUri-only with ATHENA_EXECUTION_MODE=auto", () => {
	const client = createClient({
		db: { pgUri: SAMPLE_PG },
		env: { ATHENA_EXECUTION_MODE: "auto" },
	});
	assert.ok(client);
	assert.equal(client.capabilities?.db.engine, "postgresql");
	assert.equal(client.capabilities?.db.local, true);
});

test("createClient pgUri-only does not require HTTP services for construction", () => {
	assert.doesNotThrow(() =>
		createClient({
			db: { pgUri: SAMPLE_PG },
		}),
	);
});

test("withContext over pgUri client does not throw and keeps capabilities", () => {
	const base = createClient({ db: { pgUri: SAMPLE_PG }, env: {} });
	const scoped = base.withContext({ userId: "user-1" });
	assert.equal(scoped.capabilities?.db.local, true);
	assert.equal(scoped.capabilities?.db.engine, "postgresql");
});

test("d1 + pgUri without mode is rejected", () => {
	const d1 = {
		prepare() {
			return {
				bind() {
					return this;
				},
				async all() {
					return { results: [], success: true, meta: {} };
				},
				async first() {
					return null;
				},
				async run() {
					return { results: [], success: true, meta: {} };
				},
			};
		},
	};
	assert.throws(
		() =>
			createClient({
				db: {
					d1: d1 as never,
					pgUri: SAMPLE_PG,
				},
				env: {},
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_NO_SERVICE_CONFIGURED",
	);
});

test("mode gateway keeps pgUri as header-only path requiring API key when no other credentials", () => {
	assert.throws(
		() =>
			createClient({
				db: { pgUri: SAMPLE_PG },
				mode: "gateway",
				env: {},
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			(error.code === "ATHENA_NO_SERVICE_CONFIGURED" ||
				error.code === "ATHENA_API_KEY_REQUIRED"),
	);
});

test("hybrid pgUri DB + auth URL requires key for remote HTTP", () => {
	assert.throws(
		() =>
			createClient({
				db: { pgUri: SAMPLE_PG },
				auth: { url: "https://auth.example.com" },
				env: {},
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_API_KEY_REQUIRED",
	);

	const client = createClient({
		db: { pgUri: SAMPLE_PG },
		auth: { url: "https://auth.example.com" },
		key: "test-key",
		env: {},
	});
	assert.equal(client.capabilities?.db.local, true);
	assert.equal(client.capabilities?.auth.remote, true);
});

test("empty client still fails with ATHENA_NO_SERVICE_CONFIGURED", () => {
	assert.throws(
		() => createClient({ env: {} }),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_NO_SERVICE_CONFIGURED",
	);
});

test("pg direct sentinel URL is local athena.local host", () => {
	assert.match(ATHENA_PG_DIRECT_BASE_URL, /^https:\/\/athena\.local\//);
});
