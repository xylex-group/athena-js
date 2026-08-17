import { strict as assert } from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import {
	assertInt,
	normalizeAthenaError,
	requireAffected,
	requireSuccess,
	unwrapOne,
	unwrapRows,
	withRetry,
} from "../src/auxiliaries.ts";
import { AthenaGatewayError } from "../src/gateway/errors.ts";
import { createClient } from "../src/v3-client.ts";

const ATHENA_URL =
	process.env.ATHENA_URL ?? "https://mirror3.athena-cluster.com";
const ATHENA_API_KEY = process.env.ATHENA_API_KEY ?? "x";
const ATHENA_CLIENT = process.env.ATHENA_CLIENT ?? "athena_logging";
const RUN_ATHENA_E2E =
	process.env.ATHENA_E2E === "1" &&
	ATHENA_API_KEY !== "x" &&
	ATHENA_API_KEY !== "replace-me";

if (!(ATHENA_URL && ATHENA_API_KEY)) {
	throw new Error("ATHENA_URL and ATHENA_API_KEY are required for E2E tests");
}

const e2eTest = RUN_ATHENA_E2E ? test : test.skip;

function makePayload(runId: string) {
	return {
		test_bool: true,
		test_json: { ok: true, runId },
		test_number: 42,
		test_text: runId,
		test_time: null,
		test_uuid: crypto.randomUUID(),
	};
}

function createE2EClient() {
	return createClient({
		client: ATHENA_CLIENT,
		db: { url: ATHENA_URL },
		key: ATHENA_API_KEY,
	});
}

e2eTest(
	"e2e helpers: requireSuccess + unwrap helpers work on live insert/select flow",
	async (t) => {
		const client = createE2EClient();
		const runId = `helpers-e2e-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
		const payload = makePayload(runId);

		let insertedId: number | undefined;

		try {
			const insertResult = await client
				.from("test")
				.insert(payload)
				.single("id,test_uuid,test_text,test_number", { count: "exact" });

			const ensuredInsert = requireSuccess(insertResult, {
				identity: { test_text: runId },
				operation: "insert",
				table: "test",
			});

			const insertedRow = unwrapOne(ensuredInsert, {
				context: {
					identity: { test_text: runId },
					operation: "insert",
					table: "test",
				},
			}) as Record<string, unknown>;

			insertedId = assertInt(insertedRow.id, "inserted id", { min: 1 });
			const rowId = insertedId;

			if (ensuredInsert.count === null) {
				t.diagnostic(
					"Gateway did not return count for count=exact request; skipping requireAffected success assertion",
				);
			} else {
				const affected = requireAffected(
					ensuredInsert,
					{ min: 1 },
					{
						identity: { id: rowId },
						operation: "insert",
						table: "test",
					},
				);
				assert.ok(affected >= 1);
			}

			const fetchResult = await client
				.from("test")
				.select("id,test_uuid,test_text,test_number")
				.eq("id", rowId);

			const ensuredFetch = requireSuccess(fetchResult, {
				identity: { id: rowId },
				operation: "select",
				table: "test",
			});
			const rows = unwrapRows(ensuredFetch, {
				context: {
					identity: { id: rowId },
					operation: "select",
					table: "test",
				},
			});

			assert.equal(rows.length, 1);
			const row = rows[0] as Record<string, unknown>;
			assert.equal(row.test_uuid, payload.test_uuid);
			assert.equal(row.test_text, runId);
			assert.equal(row.test_number, 42);
		} finally {
			if (insertedId !== undefined) {
				await client.from("test").eq("id", insertedId).delete();
			}
		}
	},
);

e2eTest(
	"e2e helpers: normalizeAthenaError + requireSuccess handle real query failures",
	async () => {
		const client = createE2EClient();

		const badResult = await client.query(
			`select id from definitely_missing_${Date.now()}`,
		);

		assert.throws(
			() =>
				requireSuccess(badResult, {
					operation: "select",
					table: "definitely_missing_table",
				}),
			AthenaGatewayError,
		);

		const normalized = normalizeAthenaError(badResult, {
			operation: "select",
			table: "definitely_missing_table",
		});

		assert.equal(normalized.operation, "select");
		assert.equal(normalized.table, "definitely_missing_table");
		assert.equal(normalized.status, badResult.status);
		assert.ok(normalized.message.length > 0);
	},
);

e2eTest(
	"e2e helpers: withRetry can recover and complete a live read",
	async () => {
		const client = createE2EClient();

		let attempts = 0;
		const result = await withRetry(
			{
				baseDelayMs: 0,
				jitter: false,
				retries: 2,
				shouldRetry: (error) =>
					normalizeAthenaError(error).kind === "transient",
			},
			async () => {
				attempts += 1;
				if (attempts === 1) {
					throw new AthenaGatewayError({
						code: "NETWORK_ERROR",
						endpoint: "/gateway/fetch",
						message: "synthetic transient for retry e2e",
						method: "POST",
						status: 0,
					});
				}

				return client.from("test").select("id").limit(1);
			},
		);

		assert.equal(attempts, 2);

		const ensured = requireSuccess(result, {
			operation: "select",
			table: "test",
		});
		const rows = unwrapRows(ensured, {
			context: { operation: "select", table: "test" },
		});
		assert.ok(Array.isArray(rows));
	},
);
