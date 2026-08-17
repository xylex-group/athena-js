import assert from "node:assert/strict";
import { test } from "node:test";
import {
	ATHENA_ADMIN_QUERY_EMPTY_SQL,
	ATHENA_ADMIN_QUERY_MULTI_STATEMENT,
	assertNonEmptySql,
	classifyRawSqlOperation,
	createAdminQuery,
	defaultExpectedShapeForOperation,
	sqlLooksLikeMultipleStatements,
} from "../src/admin/query.ts";
import {
	buildCompatibilityReportFromHealth,
	buildUndiscoveredCompatibilityReport,
} from "../src/compatibility/report.ts";
import {
	ATHENA_GATEWAY_ROUTES,
	ATHENA_ROUTE_MANIFEST,
	getAthenaRouteDescriptor,
	isDeprecatedAthenaRoute,
} from "../src/gateway/routes.ts";
import {
	normalizeAthenaHealthPayload,
	normalizeAthenaReleaseIdentity,
} from "../src/release/identity.ts";
import { createClient } from "../src/v3-client.ts";

test("normalizeAthenaReleaseIdentity maps snake_case display_name and preserves channel", () => {
	const identity = normalizeAthenaReleaseIdentity({
		channel: "stable",
		codename: "Dragunov",
		display_name: "Athena 5.0.0 — Dragunov",
		product: "Athena",
		version: "5.0.0",
	});
	assert.deepEqual(identity, {
		channel: "stable",
		codename: "Dragunov",
		displayName: "Athena 5.0.0 — Dragunov",
		product: "Athena",
		version: "5.0.0",
	});
});

test("Athena 4 health without release synthesizes identity without fabricating codename", () => {
	const health = normalizeAthenaHealthPayload({
		message: "athena is online",
		status: "ok",
		version: "4.1.3",
	});
	assert.equal(health.release.codename, null);
	assert.equal(health.release.version, "4.1.3");
	assert.equal(health.release.displayName, "Athena 4.1.3");
	assert.equal(health.release.channel, "stable");
});

test("Athena 5 health release object is preserved", () => {
	const health = normalizeAthenaHealthPayload({
		release: {
			channel: "development",
			codename: "Dragunov",
			display_name: "Athena 5.0.0 — Dragunov",
			product: "Athena",
			version: "5.0.0",
		},
		version: "5.0.0",
	});
	assert.equal(health.release.codename, "Dragunov");
	assert.equal(health.release.channel, "development");
});

test("compatibility report is compatible for Athena 4 and 5 health", () => {
	const a4 = buildCompatibilityReportFromHealth({ version: "4.1.3" });
	assert.equal(a4.compatible, true);
	assert.equal(a4.server.codename, null);
	assert.equal(a4.protocols.health, 1);

	const a5 = buildCompatibilityReportFromHealth({
		release: {
			channel: "development",
			codename: "Dragunov",
			display_name: "Athena 5.0.0 — Dragunov",
			product: "Athena",
			version: "5.0.0",
		},
		version: "5.0.0",
	});
	assert.equal(a5.compatible, true);
	assert.equal(a5.server.codename, "Dragunov");
	assert.equal(a5.protocols.health, 2);
});

test("undiscovered compatibility remains compatible with info warning", () => {
	const report = buildUndiscoveredCompatibilityReport();
	assert.equal(report.compatible, true);
	assert.equal(report.discovered, false);
	assert.ok(
		report.warnings.some((w) => w.code === "ATHENA_COMPAT_UNDISCOVERED"),
	);
});

test("route manifest marks /gateway/query deprecated and CRUD retained", () => {
	assert.equal(ATHENA_GATEWAY_ROUTES.rawQuery, "/gateway/query");
	assert.equal(isDeprecatedAthenaRoute("/gateway/query"), true);
	assert.equal(getAthenaRouteDescriptor("/gateway/fetch")?.status, "retained");
	assert.ok(
		ATHENA_ROUTE_MANIFEST.some(
			(r) => r.path === "/gateway/query" && r.classification === "Deprecate",
		),
	);
});

test("classifyRawSqlOperation is conservative", () => {
	assert.equal(classifyRawSqlOperation("select 1"), "select");
	assert.equal(
		classifyRawSqlOperation("WITH x AS (SELECT 1) SELECT * FROM x"),
		"select",
	);
	assert.equal(classifyRawSqlOperation("update t set a=1"), "update");
	assert.equal(classifyRawSqlOperation("VACUUM"), "unknown");
	assert.equal(defaultExpectedShapeForOperation("select"), "rows");
	assert.equal(defaultExpectedShapeForOperation("update"), "affected-only");
});

test("sqlLooksLikeMultipleStatements detects trailing statements", () => {
	assert.equal(sqlLooksLikeMultipleStatements("select 1"), false);
	assert.equal(sqlLooksLikeMultipleStatements("select 1;"), false);
	assert.equal(sqlLooksLikeMultipleStatements("select 1; select 2"), true);
	assert.equal(
		sqlLooksLikeMultipleStatements("select ';' as x; select 2"),
		true,
	);
});

test("assertNonEmptySql rejects blank", () => {
	assert.throws(
		() => assertNonEmptySql("   "),
		(error: Error & { code?: string }) =>
			error.code === ATHENA_ADMIN_QUERY_EMPTY_SQL,
	);
});

test("admin.query rejects multi-statement SQL", async () => {
	const adminQuery = createAdminQuery({
		client: {
			queryGateway: async () => {
				throw new Error("should not call gateway");
			},
		},
		formatGatewayResult: (response) => ({
			data: response.data ?? null,
			error: null,
			raw: response.raw,
			status: response.status,
		}),
	});

	await assert.rejects(
		() =>
			adminQuery({
				expectedShape: "rows",
				operation: "select",
				sql: "select 1; select 2",
			}),
		(error: Error & { code?: string }) =>
			error.code === ATHENA_ADMIN_QUERY_MULTI_STATEMENT,
	);
});

test("admin.query sends operation + expectedShape on /gateway/query payload", async () => {
	const calls: Array<{ url: string; body: unknown }> = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		calls.push({
			body: init?.body ? JSON.parse(String(init.body)) : null,
			url,
		});
		return new Response(JSON.stringify({ count: 1, data: [{ id: 1 }] }), {
			headers: { "content-type": "application/json" },
			status: 200,
		});
	};
	try {
		const client = createClient({
			key: "test-key",
			url: "https://athena.example",
		});
		const result = await client.admin.query({
			expectedShape: "rows",
			operation: "select",
			params: [true],
			sql: "select id from users where active = $1",
		});
		assert.equal(calls.length, 1);
		assert.ok(calls[0].url.endsWith("/gateway/query"));
		assert.deepEqual(calls[0].body, {
			expectedShape: "rows",
			operation: "select",
			params: [true],
			query: "select id from users where active = $1",
		});
		assert.equal(result.status, 200);
		assert.equal(result.metadata.route, "/gateway/query");
		assert.equal(result.metadata.operation, "select");
		assert.equal(result.metadata.deprecated, true);
	} finally {
		globalThis.fetch = original;
	}
});

test("root query remains callable and still hits /gateway/query", async () => {
	const calls: Array<{ url: string; body: unknown }> = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		calls.push({
			body: init?.body ? JSON.parse(String(init.body)) : null,
			url: String(input),
		});
		return new Response(JSON.stringify({ count: 0, data: [] }), {
			headers: { "content-type": "application/json" },
			status: 200,
		});
	};
	try {
		const client = createClient({
			key: "test-key",
			url: "https://athena.example",
		});
		const result = await client.query("select now()");
		assert.equal(calls.length, 1);
		assert.ok(calls[0].url.endsWith("/gateway/query"));
		assert.equal((calls[0].body as { query: string }).query, "select now()");
		assert.equal(result.error, null);
		assert.equal(result.status, 200);
		// Legacy result has no required metadata property on root query
		assert.equal(Object.hasOwn(result as object, "metadata"), false);
	} finally {
		globalThis.fetch = original;
	}
});

test("health() normalizes Athena 5 release from /health", async () => {
	const original = globalThis.fetch;
	globalThis.fetch = async (input) => {
		const url = String(input);
		if (url.endsWith("/health")) {
			return new Response(
				JSON.stringify({
					release: {
						channel: "development",
						codename: "Dragunov",
						display_name: "Athena 5.0.0 — Dragunov",
						product: "Athena",
						version: "5.0.0",
					},
					status: "ok",
					version: "5.0.0",
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			);
		}
		return new Response("not found", { status: 404 });
	};
	try {
		const client = createClient({
			key: "test-key",
			url: "https://athena.example",
		});
		const health = await client.health();
		assert.equal(health.release.codename, "Dragunov");
		const release = await client.system.release();
		assert.equal(release.displayName, "Athena 5.0.0 — Dragunov");
		const compat = await client.system.compatibility();
		assert.equal(compat.compatible, true);
		assert.equal(compat.discovered, true);
	} finally {
		globalThis.fetch = original;
	}
});

test("affectedRows stays null when mutation meta is absent", async () => {
	const original = globalThis.fetch;
	globalThis.fetch = async () =>
		new Response(JSON.stringify({ data: null }), {
			headers: { "content-type": "application/json" },
			status: 200,
		});
	try {
		const client = createClient({
			key: "test-key",
			url: "https://athena.example",
		});
		const result = await client.admin.query({
			expectedShape: "affected-only",
			operation: "update",
			params: ["u1"],
			sql: "update users set active = false where id = $1",
		});
		assert.equal(result.metadata.affectedRows, null);
		assert.equal(result.metadata.lastInsertId, null);
	} finally {
		globalThis.fetch = original;
	}
});

test("P2: Avoid reporting SELECT counts as affected rows", async () => {
	const original = globalThis.fetch;
	// Gateway SELECT responses often include `count` as row-count metadata.
	// That must not surface as metadata.affectedRows (honest mutation metadata).
	globalThis.fetch = async () =>
		new Response(
			JSON.stringify({
				count: 2,
				data: [{ id: 1 }, { id: 2 }],
			}),
			{
				headers: { "content-type": "application/json" },
				status: 200,
			},
		);
	try {
		const client = createClient({
			key: "test-key",
			url: "https://athena.example",
		});
		const result = await client.admin.query({
			expectedShape: "rows",
			operation: "select",
			sql: "select id from users",
		});
		assert.equal(
			result.metadata.affectedRows,
			null,
			"SELECT row-count must not be reported as affectedRows",
		);
		assert.equal(result.count, 2);
	} finally {
		globalThis.fetch = original;
	}
});

test("P2: Avoid rejecting legacy query scripts", async () => {
	// Original found case: root query() with semicolon-separated script used to
	// hit queryGateway; after routing through adminQuery it threw MULTI_STATEMENT.
	// Legacy alias must still forward multi-statement SQL; admin.query still rejects.
	const calls: Array<{ url: string; body: unknown }> = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		calls.push({
			body: init?.body ? JSON.parse(String(init.body)) : null,
			url: String(input),
		});
		return new Response(JSON.stringify({ count: 0, data: [] }), {
			headers: { "content-type": "application/json" },
			status: 200,
		});
	};
	try {
		const client = createClient({
			key: "test-key",
			url: "https://athena.example",
		});
		const script = "create table t(id int); insert into t values (1);";
		const result = await client.query(script);
		assert.equal(calls.length, 1, "legacy query must reach gateway");
		assert.ok(calls[0].url.endsWith("/gateway/query"));
		assert.equal((calls[0].body as { query: string }).query, script.trim());
		assert.equal(result.error, null);
		assert.equal(result.status, 200);

		await assert.rejects(
			() =>
				client.admin.query({
					expectedShape: "affected-only",
					operation: "insert",
					sql: script,
				}),
			(error: Error & { code?: string }) =>
				error.code === ATHENA_ADMIN_QUERY_MULTI_STATEMENT,
		);
	} finally {
		globalThis.fetch = original;
	}
});
