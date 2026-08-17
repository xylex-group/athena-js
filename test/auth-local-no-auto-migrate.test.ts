import assert from "node:assert/strict";
import { test } from "node:test";

import { AthenaAuthRuntimeError } from "../src/auth/local/errors.ts";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";
import { createClient } from "../src/v3-client.ts";
import {
	createObservingAuthDatabase,
	isAuthDdl,
} from "./auth-schema-observer.ts";

const SAMPLE_PG =
	"postgresql://postgres@127.0.0.1:5432/athena_runtime_finality";

test("createAthenaAuthRuntime does not run DDL unless autoMigrate is true", async () => {
	const database = createObservingAuthDatabase({ missing: true });
	const runtime = createAthenaAuthRuntime({
		database,
		secret: "test-secret",
	});
	await assert.rejects(
		() => runtime.getStores(),
		(error: unknown) =>
			error instanceof AthenaAuthRuntimeError &&
			error.code === "ATHENA_AUTH_SCHEMA_MISSING",
	);
	assert.equal(database.statements.some(isAuthDdl), false);
	await runtime.close();
});

test("createClient construction never issues Auth DDL", () => {
	const client = createClient({
		databaseUrl: SAMPLE_PG,
		env: {},
	});
	assert.ok(client.auth);
	assert.equal(typeof client.close, "function");
});
