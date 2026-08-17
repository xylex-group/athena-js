import assert from "node:assert/strict";
import { test } from "node:test";

import { ATHENA_AUTH_SCHEMA_GENERATION } from "../src/auth/contract/index.ts";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";
import {
	getAthenaAuthExpectedLedger,
	readAthenaAuthSchemaStatus,
} from "../src/auth/local/schema.ts";
import { createObservingAuthDatabase } from "./auth-schema-observer.ts";

test("current Auth schema is compatible and starts without DDL", async () => {
	const database = createObservingAuthDatabase({
		ledger: getAthenaAuthExpectedLedger(),
		version: ATHENA_AUTH_SCHEMA_GENERATION,
	});
	const status = await readAthenaAuthSchemaStatus(database);
	assert.equal(status.current, ATHENA_AUTH_SCHEMA_GENERATION);
	assert.equal(status.expected, ATHENA_AUTH_SCHEMA_GENERATION);
	assert.equal(status.compatible, true);
	assert.equal(status.direction, "current");

	const runtime = createAthenaAuthRuntime({
		database,
		secret: "test-secret",
	});
	await runtime.getStores();
	assert.equal(
		database.statements.some((sql) =>
			/\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|SCHEMA)\b/i.test(sql),
		),
		false,
	);
	await runtime.close();
});
