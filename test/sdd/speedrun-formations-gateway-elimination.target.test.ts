/**
 * Target contract — Speedrun Formations gateway elimination.
 *
 * Desired public contract from
 * docs/sdd/xylex/athena-js-speedrun-formations-pg/SPEC.md.
 *
 * Must stay RED on current HEAD until: count-preferred canonical row-count,
 * requireAffected fallback without { count: "exact" } on PG/D1, fluent CAS,
 * PG .or(string), and mutation single/maybeSingle ↔ toSingleResult parity.
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { requireAffected } from "../../src/auxiliaries.ts";
import { createAthenaRequest } from "../../src/client-request.ts";
import {
	type AthenaResult,
	applyCardinality,
	createResultFormatter,
	toSingleResult,
} from "../../src/client-result.ts";
import { compileD1Update } from "../../src/cloudflare/d1/sql.ts";
import { createAthenaGatewayClient } from "../../src/gateway/client.ts";
import { AthenaGatewayError } from "../../src/gateway/errors.ts";
import { postgresSuccessResponse } from "../../src/postgres/execute.ts";
import {
	compilePostgresFetch,
	compilePostgresUpdate,
	PostgresSqlCompileError,
} from "../../src/postgres/sql.ts";
import { parseLegacyOrExpression } from "../../src/query/legacy-boolean.ts";
import { resolveMutationAffectedRows } from "../../src/result/mutation-meta.ts";
import { createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_PG = "postgresql://postgres@127.0.0.1:5432/athena_direct_test";

function mockJsonFetch(body: unknown) {
	const original = globalThis.fetch;
	const calls: Array<{ init?: RequestInit; url: string }> = [];
	globalThis.fetch = async (url, init) => {
		calls.push({ init, url: String(url) });
		return new Response(JSON.stringify(body), { status: 200 });
	};
	return {
		calls,
		restore() {
			globalThis.fetch = original;
		},
	};
}

/** Desired canonical mutation row-count: numeric count, else numeric affectedRows. */
function canonicalMutationRowCount(
	result: Pick<AthenaResult<unknown>, "affectedRows" | "count">,
): number | null {
	if (typeof result.count === "number" && Number.isFinite(result.count)) {
		return result.count;
	}
	if (
		typeof result.affectedRows === "number" &&
		Number.isFinite(result.affectedRows)
	) {
		return result.affectedRows;
	}
	return null;
}

test("target: requireAffected uses numeric count else numeric affectedRows", () => {
	assert.equal(
		requireAffected({
			affectedRows: 1,
			count: 99,
			data: { id: 1 },
			error: null,
			raw: null,
			status: 200,
		}),
		99,
	);
	assert.equal(
		requireAffected({
			affectedRows: 1,
			count: 0,
			data: [],
			error: null,
			raw: null,
			status: 200,
		}),
		0,
	);
	assert.equal(
		requireAffected({
			affectedRows: 3,
			data: [{ id: 1 }],
			error: null,
			raw: null,
			status: 200,
		}),
		3,
	);
	assert.equal(
		requireAffected({
			count: 2,
			data: [{ id: 1 }],
			error: null,
			raw: null,
			status: 200,
		}),
		2,
	);
});

test("target: requireAffected miss hint must not require count:exact on PG/D1", () => {
	try {
		requireAffected({
			data: { id: 1 },
			error: null,
			raw: { data: { id: 1 } },
			status: 200,
		});
		assert.fail("expected requireAffected to throw");
	} catch (error) {
		assert.ok(error instanceof AthenaGatewayError);
		assert.match(
			error.message,
			/Expected affected row count but response\.(count|affectedRows)/,
		);
		assert.equal(typeof error.hint, "string");
		assert.doesNotMatch(String(error.hint), /count:\s*"exact"/);
		assert.doesNotMatch(String(error.hint), /count: "exact"/);
	}
});

test("target: formatted mutation result copies honest count and affectedRows", () => {
	const format = createResultFormatter();
	const result = format({
		affectedRows: 1,
		count: 1,
		data: { id: "form-1" },
		error: undefined,
		errorDetails: null,
		ok: true,
		raw: { affected_rows: 1, count: 1 },
		status: 200,
		statusText: "OK",
	});
	assert.equal(result.count, 1);
	assert.equal(result.affectedRows, 1);
	assert.equal(canonicalMutationRowCount(result), 1);
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
	assert.equal(Object.hasOwn(result, "affectedRows"), false);
});

test("target: never fabricate affectedRows 0 when mutation meta is absent", () => {
	assert.equal(
		resolveMutationAffectedRows({
			endpoint: "/gateway/update",
			raw: { data: [] },
		}),
		null,
	);
	assert.equal(
		resolveMutationAffectedRows({
			endpoint: "/gateway/fetch",
			raw: { count: 5 },
		}),
		undefined,
	);
});

test("target: Gateway envelope count is preferred; else affectedRows from honest alias", async () => {
	const withCount = mockJsonFetch({
		affected_rows: 9,
		count: 1,
		data: { id: "form-1" },
	});
	try {
		const client = createAthenaGatewayClient({
			baseUrl: "https://gateway.example.test",
		});
		const response = await client.updateGateway({
			conditions: [{ column: "id", operator: "eq", value: "form-1" }],
			table_name: "forms.forms",
			update_body: { name: "x" },
		});
		assert.equal(response.count, 1);
		assert.equal(response.affectedRows, 9);
		const formatted = createResultFormatter()(response);
		assert.equal(canonicalMutationRowCount(formatted), 1);
		assert.equal(requireAffected(formatted), 1);
	} finally {
		withCount.restore();
	}

	const aliasOnly = mockJsonFetch({
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
		aliasOnly.restore();
	}
});

test("target: PG/D1 mutation success always exposes a numeric canonical row-count", () => {
	const pgHit = createResultFormatter()(
		postgresSuccessResponse(
			{ id: "job-1" },
			1,
			{ command: "UPDATE", rowCount: 1 },
			1,
		),
	);
	assert.equal(typeof pgHit.count, "number");
	assert.equal(pgHit.count, 1);
	assert.equal(pgHit.affectedRows, 1);
	assert.equal(requireAffected(pgHit), 1);

	const pgMiss = createResultFormatter()(
		postgresSuccessResponse([], 0, { command: "UPDATE", rowCount: 0 }, 0),
	);
	assert.equal(pgMiss.count, 0);
	assert.equal(pgMiss.affectedRows, 0);
	assert.equal(canonicalMutationRowCount(pgMiss), 0);

	const d1 = createResultFormatter()({
		affectedRows: 1,
		count: 1,
		data: { id: "n-1" },
		error: undefined,
		errorDetails: null,
		ok: true,
		raw: { meta: { changes: 1 } },
		status: 200,
		statusText: "OK",
	});
	assert.equal(d1.count, 1);
	assert.equal(requireAffected(d1), 1);
});

test("target: consumer CAS is fluent update().eq().eq() without request('/gateway/update')", () => {
	const compiled = compilePostgresUpdate({
		conditions: [
			{ column: "id", operator: "eq", value: "form-1" },
			{ column: "schema_revision", operator: "eq", value: 10 },
		],
		table_name: "forms.forms",
		update_body: { schema_revision: 11 },
	});
	assert.equal(
		compiled.text,
		'UPDATE "forms"."forms" SET "schema_revision" = $1 WHERE "id" = $2 AND "schema_revision" = $3',
	);
	assert.deepEqual(compiled.values, [11, "form-1", 10]);
	assert.doesNotMatch(compiled.text, /SELECT/i);
	assert.match(compiled.text, /\$1/);
	assert.match(compiled.text, /\$2/);
	assert.match(compiled.text, /\$3/);

	const client = createClient({ db: { pgUri: SAMPLE_PG }, env: {} });
	assert.equal(typeof client.from, "function");
	assert.equal(typeof client.request, "function");
	assert.equal(client.capabilities?.db.engine, "postgresql");
	assert.equal(client.capabilities?.db.local, true);
	const fromJobs = client.from("jobs");
	assert.equal(typeof fromJobs.eq, "function");
	assert.equal(typeof fromJobs.update, "function");
	const bag = client as unknown as Record<string, unknown>;
	assert.equal(typeof bag.cas, "undefined");
	assert.equal(typeof bag.speedrunUpdate, "undefined");
	assert.equal(typeof bag.speedrunCas, "undefined");
	assert.equal(typeof bag.createPool, "undefined");
});

test("target: CAS miss is success with affected 0, not a transport error", () => {
	const miss = createResultFormatter()(
		postgresSuccessResponse([], 0, { command: "UPDATE", rowCount: 0 }, 0),
	);
	assert.equal(miss.error, null);
	assert.equal(canonicalMutationRowCount(miss), 0);
	assert.throws(
		() => requireAffected(miss, { min: 1 }),
		/Expected at least 1 affected rows but received 0/,
	);
});

test("target: bounded PG update stays fail-closed and parameterized", () => {
	assert.throws(
		() =>
			compilePostgresUpdate({
				table_name: "jobs",
				update_body: { state: "done" },
			}),
		(error: unknown) =>
			error instanceof PostgresSqlCompileError &&
			error.code === "unfiltered_update",
	);
	const compiled = compilePostgresUpdate(
		{
			conditions: [{ column: "state", operator: "eq", value: "queued" }],
			limit: 1,
			table_name: "jobs",
			update_body: { state: "running" },
		},
		{ identityColumn: "id" },
	);
	assert.match(compiled.text, /"id" IN \(SELECT "id" FROM "jobs"/);
	assert.deepEqual(compiled.values, ["running", "queued"]);
});

test("target: D1 multi-eq update compiles SET/WHERE as bind parameters", () => {
	const compiled = compileD1Update({
		conditions: [
			{ column: "id", operator: "eq", value: "job-1" },
			{ column: "version", operator: "eq", value: 3 },
		],
		table_name: "jobs",
		update_body: { state: "done", version: 4 },
	});
	assert.match(compiled.sql, /UPDATE "jobs" SET/);
	assert.match(compiled.sql, /"id" = \?/);
	assert.match(compiled.sql, /"version" = \?/);
	assert.ok(compiled.params.includes("done"));
	assert.ok(compiled.params.includes("job-1"));
	assert.ok(compiled.params.includes(3));
});

test("target: PG compiler compiles Speedrun fluent .or(string) to parameterized OR", () => {
	const compiled = compilePostgresFetch({
		conditions: [{ operator: "or", value: "deleted.eq.false,deleted.is.null" }],
		table_name: "notifications",
	});
	assert.match(compiled.text, /"deleted" = \$1/);
	assert.match(compiled.text, /"deleted" IS NULL/);
	assert.match(compiled.text, / OR /);
	assert.deepEqual(compiled.values, [false]);
	assert.doesNotMatch(compiled.text, /deleted\.eq\.false/);
});

test("target: unsafe / unknown fluent .or() stays fail-closed", () => {
	assert.throws(
		() =>
			compilePostgresFetch({
				conditions: [{ operator: "or", value: "1=1" }],
				table_name: "users",
			}),
		(error: unknown) =>
			error instanceof PostgresSqlCompileError &&
			error.code === "unsupported_operator",
	);
	assert.throws(
		() => parseLegacyOrExpression("deleted.unknown.true"),
		/Legacy boolean operator/,
	);
	assert.deepEqual(
		parseLegacyOrExpression("deleted.eq.false,deleted.is.null"),
		[
			{ column: "deleted", operator: "eq", value: false },
			{ column: "deleted", operator: "is", value: null },
		],
	);
});

test("target: mutation single/maybeSingle match read-path toSingleResult projection", () => {
	const empty = {
		count: 0,
		data: [] as { id: number }[],
		error: null,
		raw: null,
		status: 200,
	};
	const viaToSingle = toSingleResult(empty);
	assert.equal(viaToSingle.error, null);
	assert.equal(viaToSingle.data, null);

	const viaSingle = applyCardinality(empty, "single");
	assert.equal(viaSingle.error, viaToSingle.error);
	assert.equal(viaSingle.data, viaToSingle.data);

	const viaMaybe = applyCardinality(empty, "maybeSingle");
	assert.equal(viaMaybe.error, null);
	assert.equal(viaMaybe.data, null);

	const many = {
		count: 2,
		data: [{ id: 1 }, { id: 2 }],
		error: null,
		raw: null,
		status: 200,
	};
	const manySingle = applyCardinality(many, "single");
	const manyToSingle = toSingleResult(many);
	assert.equal(manyToSingle.error, null);
	assert.deepEqual(manyToSingle.data, { id: 1 });
	assert.equal(manySingle.error, manyToSingle.error);
	assert.deepEqual(manySingle.data, manyToSingle.data);
});

test("target: request() stays HTTP-only and never emulates Gateway SQL locally", async () => {
	const request = createAthenaRequest({ pgUri: SAMPLE_PG }, () => undefined);
	await assert.rejects(
		() => request({ url: "postgres://127.0.0.1:5432/athena" }),
		/url must be an absolute http\(s\) URL/,
	);
	await assert.rejects(
		() => request({ url: "file:///tmp/athena.sql" }),
		/url must be an absolute http\(s\) URL/,
	);

	const { calls, restore } = mockJsonFetch({ data: { id: "job-1" } });
	try {
		const client = createClient({ db: { pgUri: SAMPLE_PG }, env: {} });
		const response = await client.request({
			body: {
				conditions: [{ column: "id", operator: "eq", value: "job-1" }],
				table_name: "jobs",
				update_body: { state: "done" },
			},
			method: "POST",
			path: "/gateway/update",
		});
		assert.equal(calls.length, 1);
		assert.equal(
			calls[0]?.url,
			"https://athena.local/postgres-direct/gateway/update",
		);
		assert.equal(response.ok, true);
		assert.equal(typeof (client as { cas?: unknown }).cas, "undefined");
	} finally {
		restore();
	}
});

test("target: fluent Gateway CAS payload is update + two eq predicates (no request helper)", async () => {
	const { calls, restore } = mockJsonFetch({
		count: 1,
		data: { id: "job-1" },
	});
	try {
		const client = createClient({
			db: { url: "https://athena-db.example.test" },
			key: "secret",
		});
		const result = await client
			.from("jobs")
			.eq("id", "job-1")
			.eq("version", 3)
			.update({ state: "done", version: 4 });
		assert.equal(calls.length, 1);
		assert.match(calls[0]?.url ?? "", /\/gateway\/update/);
		const payload = JSON.parse(String(calls[0]?.init?.body));
		assert.equal(payload.table_name, "jobs");
		assert.deepEqual(payload.update_body, { state: "done", version: 4 });
		assert.equal(payload.conditions.length, 2);
		assert.equal(canonicalMutationRowCount(result), 1);
		assert.equal(requireAffected(result), 1);
	} finally {
		restore();
	}
});

test("target: consumer-contract Speedrun app-DB patterns stay on one createClient", () => {
	const fixture = JSON.parse(
		readFileSync(
			join(here, "../fixtures/consumer-contracts/speedrun-formations.json"),
			"utf8",
		),
	) as {
		consumer: string;
		entries: Array<{
			id: string;
			methods: string[];
			queryFamily: string;
		}>;
	};
	assert.equal(fixture.consumer, "speedrun-formations");
	const cas = fixture.entries.find((entry) => entry.id === "forms-schema-cas");
	assert.ok(cas);
	assert.ok(
		cas.methods.includes("from") &&
			cas.methods.includes("update") &&
			cas.methods.includes("eq"),
		"forms-schema-cas must be fluent from().eq().eq().update(), not request('/gateway/update')",
	);
	assert.doesNotMatch(cas.queryFamily, /request\.gateway/);

	const inbox = fixture.entries.find(
		(entry) => entry.id === "notifications-or-inbox",
	);
	assert.ok(inbox);
	assert.ok(inbox.methods.includes("or"));
});

test("target: browser entry still fail-closes db.pgUri without bundling pg", () => {
	const browserSrc = readFileSync(join(here, "../../src/browser.ts"), "utf8");
	assert.match(browserSrc, /ATHENA_POSTGRES_DIRECT_NODE_REQUIRED/);
	assert.doesNotMatch(browserSrc, /from ["']pg["']/);
	assert.doesNotMatch(browserSrc, /from ["']\.\/postgres\//);
});
