/**
 * Athena 5 Finality — runtime resolver dual-suite (T-RES-01…04).
 *
 * Public seam: `createClient` materialization. Embedded Auth is observed via
 * `athena.auth.server` / `athena.auth.handlers`, not internals.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import {
	AthenaConfigurationError,
	createClient as createBrowserClient,
} from "../src/browser.ts";
import { createClient } from "../src/v3-client.ts";

const SAMPLE_PG = "postgresql://postgres@127.0.0.1:5432/athena_finality_test";

function isEmbeddedAuth(client: { auth: object }): boolean {
	const auth = client.auth as {
		handlers?: { GET?: unknown };
		server?: { handle?: unknown };
	};
	// Unavailable-service proxies make every property look callable; require
	// an own binding written by createClient's composition root.
	// Remote clients may expose proxy `handlers`; embedded Auth owns `server`.
	return (
		Object.hasOwn(auth, "server") && typeof auth.server?.handle === "function"
	);
}

test("T-RES-01: Node + pgUri with omitted auth.mode materializes embedded Auth", () => {
	const client = createClient({
		db: { pgUri: SAMPLE_PG },
		env: {},
	});
	assert.equal(isEmbeddedAuth(client), true);
});

test("T-RES-02: auth.url wins over a database URI (remote Auth)", () => {
	const client = createClient({
		auth: { url: "https://auth.example.com" },
		db: { pgUri: SAMPLE_PG },
		env: {},
		key: "key",
	});
	assert.equal(isEmbeddedAuth(client), false);
	assert.equal(typeof client.auth.getSession, "function");
});

test("T-RES-03: databaseUrl aliases db.pgUri for transport and Auth inference", () => {
	const viaAlias = createClient({
		databaseUrl: SAMPLE_PG,
		env: {},
	});
	const viaNested = createClient({
		db: { pgUri: SAMPLE_PG },
		env: {},
	});
	assert.equal(viaAlias.capabilities?.db.engine, "postgresql");
	assert.equal(viaAlias.capabilities?.db.local, true);
	assert.equal(viaNested.capabilities?.db.engine, "postgresql");
	assert.equal(isEmbeddedAuth(viaAlias), true);
	assert.throws(
		() =>
			createClient({
				databaseUrl: SAMPLE_PG,
				db: { pgUri: "postgresql://other@127.0.0.1:5432/other" },
				env: {},
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_DATABASE_URL_CONFLICT",
	);
});

test("T-RES-05: env.DATABASE_URL only materializes embedded Auth", () => {
	const client = createClient({
		env: { DATABASE_URL: SAMPLE_PG },
	});
	assert.equal(isEmbeddedAuth(client), true);
	assert.equal(client.capabilities?.db.engine, "postgresql");
});

test("T-RES-06: databaseUrl + auth:false disables Auth without changing DB", () => {
	const client = createClient({
		auth: false,
		databaseUrl: SAMPLE_PG,
		env: {},
	});
	assert.equal(isEmbeddedAuth(client), false);
	assert.equal(Object.hasOwn(client.auth as object, "handlers"), false);
	assert.equal(Object.hasOwn(client.auth as object, "server"), false);
	assert.equal(client.capabilities?.db.engine, "postgresql");
	assert.equal(client.capabilities?.db.local, true);
});

test("T-RES-07: databaseUrl + auth.mode=remote stays remote", () => {
	const client = createClient({
		auth: { mode: "remote" },
		databaseUrl: SAMPLE_PG,
		env: {},
		key: "key",
	});
	assert.equal(isEmbeddedAuth(client), false);
});

test("T-RES-08: databaseUrl + auth.mode=local stays embedded", () => {
	const client = createClient({
		auth: { mode: "local" },
		databaseUrl: SAMPLE_PG,
		env: {},
	});
	assert.equal(isEmbeddedAuth(client), true);
});

test("T-RES-09: auth:false wins over env ATHENA_AUTH_URL (no remote handlers)", () => {
	const client = createClient({
		auth: false,
		databaseUrl: SAMPLE_PG,
		env: { ATHENA_AUTH_URL: "https://auth.example.com" },
	});
	assert.equal(isEmbeddedAuth(client), false);
	assert.equal(Object.hasOwn(client.auth as object, "handlers"), false);
	assert.equal(client.capabilities?.db.engine, "postgresql");
});

test("T-RES-04: browser + databaseUrl fail-closed without leaking the URI", () => {
	assert.throws(
		() =>
			createBrowserClient({
				databaseUrl: SAMPLE_PG,
				env: {},
			}),
		(error: unknown) => {
			if (
				!(error instanceof AthenaConfigurationError) ||
				error.code !== "ATHENA_POSTGRES_DIRECT_NODE_REQUIRED"
			) {
				return false;
			}
			const text = `${error.message}\n${String(error)}`;
			assert.equal(text.includes(SAMPLE_PG), false);
			assert.equal(text.includes("127.0.0.1"), false);
			return true;
		},
	);
});
