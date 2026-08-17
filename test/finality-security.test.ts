/**
 * Athena 5 Finality — P16 inference / secret redaction.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createClient as createBrowserClient } from "../src/browser.ts";
import { AthenaConfigurationError, createClient } from "../src/v3-client.ts";

const SECRET_URI = "postgresql://supersecret:hunter2@db.internal:5432/prod";

test("P16: Node URI conflict does not leak either connection string", () => {
	assert.throws(
		() =>
			createClient({
				databaseUrl: SECRET_URI,
				db: { pgUri: "postgresql://other:also-secret@127.0.0.1:5432/other" },
				env: {},
			}),
		(error: unknown) => {
			if (!(error instanceof AthenaConfigurationError)) {
				return false;
			}
			const text = `${error.message}\n${String(error)}`;
			assert.equal(text.includes("supersecret"), false);
			assert.equal(text.includes("hunter2"), false);
			assert.equal(text.includes("also-secret"), false);
			assert.equal(text.includes(SECRET_URI), false);
			return error.code === "ATHENA_DATABASE_URL_CONFLICT";
		},
	);
});

test("P16: browser cannot infer embedded Auth from databaseUrl", () => {
	assert.throws(
		() =>
			createBrowserClient({
				databaseUrl: SECRET_URI,
				env: {},
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_POSTGRES_DIRECT_NODE_REQUIRED" &&
			!String(error.message).includes("hunter2"),
	);
});
