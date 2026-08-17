/**
 * Target suite: backend-neutral affectedRows, Gateway alias normalization,
 * Speedrun legacy `.or()`, and single/maybeSingle cardinality.
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { requireAffected } from "../../src/auxiliaries.ts";
import {
	applyCardinality,
	createResultFormatter,
} from "../../src/client-result.ts";
import { createAthenaGatewayClient } from "../../src/gateway/client.ts";
import {
	compilePostgresFetch,
	compilePostgresUpdate,
} from "../../src/postgres/sql.ts";
import { parseLegacyOrExpression } from "../../src/query/legacy-boolean.ts";
import { resolveMutationAffectedRows } from "../../src/result/mutation-meta.ts";

const here = dirname(fileURLToPath(import.meta.url));

function mockJsonFetch(body: unknown) {
	const original = globalThis.fetch;
	globalThis.fetch = async () =>
		new Response(JSON.stringify(body), { status: 200 });
	return () => {
		globalThis.fetch = original;
	};
}

test("target: formatted mutation result exposes affectedRows from transport", () => {
	const format = createResultFormatter();
	const result = format({
		affectedRows: 1,
		count: 1,
		data: { id: "form-1" },
		error: undefined,
		errorDetails: null,
		ok: true,
		raw: { affected_rows: 1 },
		status: 200,
		statusText: "OK",
	});
	assert.equal(result.affectedRows, 1);
	assert.equal(result.count, 1);
});

test("target: SELECT / fetch must not populate affectedRows from count", () => {
	const format = createResultFormatter();
	const result = format({
		count: 4,
		data: [{ id: 1 }],
		error: undefined,
		errorDetails: null,
		ok: true,
		raw: { count: 4 },
		status: 200,
		statusText: "OK",
	});
	assert.equal(result.count, 4);
	assert.equal(result.affectedRows, undefined);
});

test("target: never fabricate affectedRows 0 when mutation meta is absent", () => {
	assert.equal(
		resolveMutationAffectedRows({
			endpoint: "/gateway/update",
			raw: { data: [] },
		}),
		null,
	);
});

test("target: Gateway aliases normalize to affectedRows and count", async () => {
	const restore = mockJsonFetch({
		affected_rows: 1,
		data: { id: "form-1" },
	});
	try {
		const client = createAthenaGatewayClient({
			baseUrl: "https://gateway.example.test",
		});
		const response = await client.updateGateway({
			conditions: [{ column: "id", operator: "eq", value: "form-1" }],
			table_name: "forms.forms",
			update_body: { schema_revision: 11 },
		});
		assert.equal(response.affectedRows, 1);
		assert.equal(response.count, 1);
	} finally {
		restore();
	}
});

test("target: Gateway row_count / rows_affected aliases normalize", () => {
	assert.equal(
		resolveMutationAffectedRows({
			endpoint: "/gateway/update",
			raw: { row_count: 0 },
		}),
		0,
	);
	assert.equal(
		resolveMutationAffectedRows({
			endpoint: "/gateway/delete",
			raw: { rows_affected: 2 },
		}),
		2,
	);
});

test("target: fetch endpoint ignores mutation aliases on count honesty", () => {
	assert.equal(
		resolveMutationAffectedRows({
			count: 5,
			endpoint: "/gateway/fetch",
			raw: { affected_rows: 5, count: 5 },
		}),
		undefined,
	);
});

test("target: D1 meta.changes maps as mutation affectedRows", () => {
	assert.equal(
		resolveMutationAffectedRows({
			endpoint: "/gateway/update",
			raw: { meta: { changes: 1 } },
		}),
		1,
	);
});

test("target: requireAffected uses numeric count else numeric affectedRows", () => {
	const n = requireAffected({
		affectedRows: 1,
		count: 99,
		data: { id: 1 },
		error: null,
		raw: null,
		status: 200,
	});
	assert.equal(n, 99);
});

test("target: legacy or() Speedrun inbox filter normalizes to structured OR", () => {
	const parsed = parseLegacyOrExpression("deleted.eq.false,deleted.is.null");
	assert.deepEqual(parsed, [
		{ column: "deleted", operator: "eq", value: false },
		{ column: "deleted", operator: "is", value: null },
	]);
});

test("target: PG fetch compiles Speedrun .or() into parameterized OR", () => {
	const compiled = compilePostgresFetch({
		conditions: [{ operator: "or", value: "deleted.eq.false,deleted.is.null" }],
		table_name: "notifications",
	});
	assert.match(compiled.text, /"deleted" = \$1/);
	assert.match(compiled.text, /"deleted" IS NULL/);
	assert.match(compiled.text, / OR /);
	assert.deepEqual(compiled.values, [false]);
});

test("target: schema CAS update remains a single parameterized statement", () => {
	const compiled = compilePostgresUpdate({
		conditions: [
			{ column: "id", operator: "eq", value: "form-1" },
			{ column: "schema_revision", operator: "eq", value: 10 },
		],
		table_name: "forms.forms",
		update_body: { schema_revision: 11 },
	});
	assert.doesNotMatch(compiled.text, /SELECT/i);
	assert.equal(
		compiled.text,
		'UPDATE "forms"."forms" SET "schema_revision" = $1 WHERE "id" = $2 AND "schema_revision" = $3',
	);
});

test("target: single 0 rows is null (toSingleResult parity); maybeSingle is null", () => {
	const empty = {
		count: 0,
		data: [] as { id: number }[],
		error: null,
		raw: null,
		status: 200,
	};
	const single = applyCardinality(empty, "single");
	assert.equal(single.error, null);
	assert.equal(single.data, null);
	const maybe = applyCardinality(empty, "maybeSingle");
	assert.equal(maybe.error, null);
	assert.equal(maybe.data, null);
});

test("target: 2+ rows take the first row for both single and maybeSingle", () => {
	const many = {
		count: 2,
		data: [{ id: 1 }, { id: 2 }],
		error: null,
		raw: null,
		status: 200,
	};
	const single = applyCardinality(many, "single");
	const maybe = applyCardinality(many, "maybeSingle");
	assert.equal(single.error, null);
	assert.equal(maybe.error, null);
	assert.deepEqual(single.data, { id: 1 });
	assert.deepEqual(maybe.data, { id: 1 });
});

test("target: consumer contract fixture classifies Speedrun gateway updates", () => {
	const fixturePath = join(
		here,
		"../fixtures/consumer-contracts/speedrun-formations.json",
	);
	const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
		entries: Array<{
			category: string;
			consumerFile: string;
			status: string;
		}>;
	};
	const gateway = fixture.entries.filter((e) => e.category === "RAW_GATEWAY");
	assert.ok(gateway.length >= 3);
	assert.ok(
		gateway.every((e) => e.status === "migration-needed"),
		"raw /gateway/update paths must be classified as migration-needed",
	);
	assert.ok(
		fixture.entries.some(
			(e) =>
				e.consumerFile.includes("notification-threads") &&
				e.category === "READ_LEGACY_BOOLEAN",
		),
	);
});
