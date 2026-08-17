import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import type { AthenaPostgresPool } from "../src/postgres/driver.ts";
import {
	createPostgresIdentityCache,
	needsBoundedIdentity,
	parsePostgresTableName,
	quotePostgresRegclassName,
	resolvePostgresBoundedIdentityColumn,
} from "../src/postgres/identity.ts";
import { PostgresSqlCompileError } from "../src/postgres/sql.ts";

test("parsePostgresTableName leaves bare names for search_path resolve", () => {
	assert.deepEqual(parsePostgresTableName("users"), {
		bare: true,
		key: "users",
		schema: null,
		table: "users",
	});
});

test("parsePostgresTableName keeps schema", () => {
	assert.deepEqual(parsePostgresTableName("analytics.events"), {
		bare: false,
		key: "analytics.events",
		schema: "analytics",
		table: "events",
	});
});

test("parsePostgresTableName rejects injection-ish names", () => {
	assert.throws(
		() => parsePostgresTableName('users"; drop table x;--'),
		(error: unknown) =>
			error instanceof PostgresSqlCompileError &&
			error.code === "invalid_identifier",
	);
});

test("needsBoundedIdentity detects page bounds", () => {
	assert.equal(needsBoundedIdentity({ limit: 1 }), true);
	assert.equal(needsBoundedIdentity({ current_page: 2, page_size: 10 }), true);
	assert.equal(needsBoundedIdentity({ sort_by: { field: "id" } }), true);
	assert.equal(needsBoundedIdentity({}), false);
});

function mockPool(
	handlers: Array<{ match: RegExp; rows: unknown[] }>,
): AthenaPostgresPool {
	return {
		async connect() {
			throw new Error("not used");
		},
		async end() {},
		async query(text: string) {
			for (const handler of handlers) {
				if (handler.match.test(text)) {
					return {
						command: "SELECT",
						fields: [],
						oid: 0,
						rowCount: handler.rows.length,
						rows: handler.rows,
					} as never;
				}
			}
			return {
				command: "SELECT",
				fields: [],
				oid: 0,
				rowCount: 0,
				rows: [],
			} as never;
		},
	};
}

const bareUsersToApp = {
	match: /to_regclass/,
	rows: [{ schema_name: "app", table_name: "users" }],
};

test("resolve prefers single-column PK via search_path for bare names", async () => {
	const pool = mockPool([
		bareUsersToApp,
		{ match: /contype = 'p'/, rows: [{ column_name: "id" }] },
		{ match: /indisunique/, rows: [{ column_name: "email" }] },
	]);
	const col = await resolvePostgresBoundedIdentityColumn(pool, "users");
	assert.equal(col, "id");
});

test("resolve falls back to unique NOT NULL valid index", async () => {
	const pool = mockPool([
		{ match: /contype = 'p'/, rows: [] },
		{ match: /indisunique/, rows: [{ column_name: "email" }] },
	]);
	// Qualified name skips search_path lookup.
	const col = await resolvePostgresBoundedIdentityColumn(pool, "public.users");
	assert.equal(col, "email");
});

test("resolve throws when no identity", async () => {
	const pool = mockPool([
		bareUsersToApp,
		{ match: /contype = 'p'/, rows: [] },
		{ match: /indisunique/, rows: [] },
	]);
	await assert.rejects(
		() => resolvePostgresBoundedIdentityColumn(pool, "users"),
		(error: unknown) =>
			error instanceof PostgresSqlCompileError &&
			error.code === "bounded_mutation_no_unique_identity",
	);
});

test("bare name missing on search_path throws relation_not_found", async () => {
	const pool = mockPool([{ match: /to_regclass/, rows: [] }]);
	await assert.rejects(
		() => resolvePostgresBoundedIdentityColumn(pool, "missing"),
		(error: unknown) =>
			error instanceof PostgresSqlCompileError &&
			error.code === "relation_not_found",
	);
});

test("quotePostgresRegclassName preserves mixed case", () => {
	assert.equal(quotePostgresRegclassName("Users"), '"Users"');
	assert.equal(quotePostgresRegclassName("users"), '"users"');
});

test("bare mixed-case name is passed quoted to to_regclass", async () => {
	let regclassArg: unknown;
	const pool: AthenaPostgresPool = {
		async connect() {
			throw new Error("not used");
		},
		async end() {},
		async query(text: string, values?: unknown[]) {
			if (/to_regclass/.test(text)) {
				regclassArg = values?.[0];
				return {
					command: "SELECT",
					fields: [],
					oid: 0,
					rowCount: 1,
					rows: [{ schema_name: "public", table_name: "Users" }],
				} as never;
			}
			if (/contype = 'p'/.test(text)) {
				return {
					command: "SELECT",
					fields: [],
					oid: 0,
					rowCount: 1,
					rows: [{ column_name: "id" }],
				} as never;
			}
			return {
				command: "SELECT",
				fields: [],
				oid: 0,
				rowCount: 0,
				rows: [],
			} as never;
		},
	};
	const col = await resolvePostgresBoundedIdentityColumn(pool, "Users");
	assert.equal(col, "id");
	assert.equal(regclassArg, '"Users"');
});

test("identity cache hits avoid second PK query for same qualified target", async () => {
	let pkQueries = 0;
	let regclassQueries = 0;
	const pool: AthenaPostgresPool = {
		async connect() {
			throw new Error("not used");
		},
		async end() {},
		async query(text: string) {
			if (/to_regclass/.test(text)) {
				regclassQueries += 1;
				return {
					command: "SELECT",
					fields: [],
					oid: 0,
					rowCount: 1,
					rows: [{ schema_name: "public", table_name: "t" }],
				} as never;
			}
			if (/contype = 'p'/.test(text)) {
				pkQueries += 1;
				return {
					command: "SELECT",
					fields: [],
					oid: 0,
					rowCount: 1,
					rows: [{ column_name: "uuid" }],
				} as never;
			}
			return {
				command: "SELECT",
				fields: [],
				oid: 0,
				rowCount: 0,
				rows: [],
			} as never;
		},
	};
	const cache = createPostgresIdentityCache();
	const a = await resolvePostgresBoundedIdentityColumn(pool, "t", cache);
	const b = await resolvePostgresBoundedIdentityColumn(pool, "t", cache);
	assert.equal(a, "uuid");
	assert.equal(b, "uuid");
	// Bare names re-resolve search_path every call; identity is cached on public.t.
	assert.equal(pkQueries, 1);
	assert.equal(regclassQueries, 2);
});

test("qualified name cache hits skip catalog entirely", async () => {
	let queries = 0;
	const pool: AthenaPostgresPool = {
		async connect() {
			throw new Error("not used");
		},
		async end() {},
		async query(text: string) {
			queries += 1;
			if (/contype = 'p'/.test(text)) {
				return {
					command: "SELECT",
					fields: [],
					oid: 0,
					rowCount: 1,
					rows: [{ column_name: "id" }],
				} as never;
			}
			return {
				command: "SELECT",
				fields: [],
				oid: 0,
				rowCount: 0,
				rows: [],
			} as never;
		},
	};
	const cache = createPostgresIdentityCache();
	const a = await resolvePostgresBoundedIdentityColumn(
		pool,
		"public.users",
		cache,
	);
	const b = await resolvePostgresBoundedIdentityColumn(
		pool,
		"public.users",
		cache,
	);
	assert.equal(a, "id");
	assert.equal(b, "id");
	assert.equal(queries, 1);
});

test("negative cache rethrows without repeating PK/UNIQUE for same target", async () => {
	let queries = 0;
	let regclassQueries = 0;
	const pool: AthenaPostgresPool = {
		async connect() {
			throw new Error("not used");
		},
		async end() {},
		async query(text: string) {
			queries += 1;
			if (/to_regclass/.test(text)) {
				regclassQueries += 1;
				return {
					command: "SELECT",
					fields: [],
					oid: 0,
					rowCount: 1,
					rows: [{ schema_name: "public", table_name: "empty" }],
				} as never;
			}
			return {
				command: "SELECT",
				fields: [],
				oid: 0,
				rowCount: 0,
				rows: [],
			} as never;
		},
	};
	const cache = createPostgresIdentityCache();
	await assert.rejects(() =>
		resolvePostgresBoundedIdentityColumn(pool, "empty", cache),
	);
	await assert.rejects(() =>
		resolvePostgresBoundedIdentityColumn(pool, "empty", cache),
	);
	// First: regclass + PK + UNIQUE. Second: regclass only (qualified miss cached).
	assert.equal(regclassQueries, 2);
	assert.equal(queries, 4);
});

test("bare name re-resolves when search_path target changes", async () => {
	let regclassCalls = 0;
	const pool: AthenaPostgresPool = {
		async connect() {
			throw new Error("not used");
		},
		async end() {},
		async query(text: string, values?: unknown[]) {
			if (/to_regclass/.test(text)) {
				regclassCalls += 1;
				const schema = regclassCalls === 1 ? "app" : "other";
				return {
					command: "SELECT",
					fields: [],
					oid: 0,
					rowCount: 1,
					rows: [{ schema_name: schema, table_name: "users" }],
				} as never;
			}
			if (/contype = 'p'/.test(text)) {
				const schema = values?.[0];
				const column = schema === "app" ? "id" : "uuid";
				return {
					command: "SELECT",
					fields: [],
					oid: 0,
					rowCount: 1,
					rows: [{ column_name: column }],
				} as never;
			}
			return {
				command: "SELECT",
				fields: [],
				oid: 0,
				rowCount: 0,
				rows: [],
			} as never;
		},
	};
	const cache = createPostgresIdentityCache();
	const first = await resolvePostgresBoundedIdentityColumn(
		pool,
		"users",
		cache,
	);
	const second = await resolvePostgresBoundedIdentityColumn(
		pool,
		"users",
		cache,
	);
	assert.equal(first, "id");
	assert.equal(second, "uuid");
	assert.equal(regclassCalls, 2);
});

test("unique identity query text includes indisvalid", async () => {
	let uniqueSql = "";
	const pool: AthenaPostgresPool = {
		async connect() {
			throw new Error("not used");
		},
		async end() {},
		async query(text: string) {
			if (/indisunique/.test(text)) {
				uniqueSql = text;
			}
			if (/to_regclass/.test(text)) {
				return {
					command: "SELECT",
					fields: [],
					oid: 0,
					rowCount: 1,
					rows: [{ schema_name: "public", table_name: "users" }],
				} as never;
			}
			return {
				command: "SELECT",
				fields: [],
				oid: 0,
				rowCount: 0,
				rows: [],
			} as never;
		},
	};
	await assert.rejects(() =>
		resolvePostgresBoundedIdentityColumn(pool, "users"),
	);
	assert.match(uniqueSql, /i\.indisvalid/);
});
