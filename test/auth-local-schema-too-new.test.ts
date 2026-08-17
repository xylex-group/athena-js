import assert from "node:assert/strict";
import { test } from "node:test";

import { ATHENA_AUTH_SCHEMA_GENERATION } from "../src/auth/contract/index.ts";
import { AthenaAuthRuntimeError } from "../src/auth/local/errors.ts";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";
import { readAthenaAuthSchemaStatus } from "../src/auth/local/schema.ts";
import { createObservingAuthDatabase } from "./auth-schema-observer.ts";

test("newer Auth schema is runtime-too-old and fails closed", async () => {
	const database = createObservingAuthDatabase({
		version: ATHENA_AUTH_SCHEMA_GENERATION + 8,
	});
	const status = await readAthenaAuthSchemaStatus(database);
	assert.equal(status.compatible, false);
	assert.equal(status.direction, "runtime-too-old");

	const runtime = createAthenaAuthRuntime({
		database,
		secret: "test-secret",
	});
	await assert.rejects(
		() => runtime.getStores(),
		(error: unknown) =>
			error instanceof AthenaAuthRuntimeError &&
			error.code === "ATHENA_AUTH_SCHEMA_TOO_NEW",
	);
	await runtime.close();
});
