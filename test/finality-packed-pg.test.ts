/**
 * Packed-package direct PostgreSQL consumer (release artifact path).
 * Source-tree createClient is the same contract; CI installs the tarball separately.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "../src/index.ts";

const uri = (
	process.env.ATHENA_PG_DIRECT_URI ??
	process.env.DATABASE_URL ??
	""
).trim();

test("T-PACK-PG-01 createClient({ databaseUrl, auth: false }) can query", async (t) => {
	if (!uri) {
		t.skip("DATABASE_URL / ATHENA_PG_DIRECT_URI required");
		return;
	}
	const athena = createClient({
		auth: false,
		databaseUrl: uri,
	});
	const result = await athena.query("select 1 as ok");
	assert.equal(result.error, undefined, String(result.error ?? ""));
	const rows = result.data as { ok?: number }[] | undefined;
	assert.ok(Array.isArray(rows));
	assert.equal(Number(rows[0]?.ok), 1);
});
