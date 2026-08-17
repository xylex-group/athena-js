import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
	compilePostgresCount,
	compilePostgresDelete,
	compilePostgresFetch,
	compilePostgresInsert,
	compilePostgresRpc,
	compilePostgresUpdate,
	PostgresSqlCompileError,
} from "../src/postgres/sql.ts";

test("fetch compiles $n binds and quoted identifiers", () => {
	const compiled = compilePostgresFetch({
		conditions: [{ column: "email", operator: "eq", value: "a@b.c" }],
		limit: 10,
		table_name: "users",
	});
	assert.equal(
		compiled.text,
		'SELECT * FROM "users" WHERE "email" = $1 LIMIT 10',
	);
	assert.deepEqual(compiled.values, ["a@b.c"]);
});

test("schema-qualified table is preserved", () => {
	const compiled = compilePostgresFetch({
		table_name: "public.users",
	});
	assert.equal(compiled.text, 'SELECT * FROM "public"."users"');
});

test("ilike uses native ILIKE", () => {
	const compiled = compilePostgresFetch({
		conditions: [{ column: "email", operator: "ilike", value: "%Ada%" }],
		table_name: "users",
	});
	assert.equal(compiled.text, 'SELECT * FROM "users" WHERE "email" ILIKE $1');
	assert.deepEqual(compiled.values, ["%Ada%"]);
});

test("eq null compiles to IS NULL", () => {
	const compiled = compilePostgresFetch({
		conditions: [{ column: "deleted_at", operator: "eq", value: null }],
		table_name: "users",
	});
	assert.equal(
		compiled.text,
		'SELECT * FROM "users" WHERE "deleted_at" IS NULL',
	);
	assert.deepEqual(compiled.values, []);
});

test("empty IN compiles to 1 = 0", () => {
	const compiled = compilePostgresFetch({
		conditions: [{ column: "id", operator: "in", value: [] }],
		table_name: "users",
	});
	assert.equal(compiled.text, 'SELECT * FROM "users" WHERE 1 = 0');
	assert.deepEqual(compiled.values, []);
});

test("rejects SQL injection via select expression", () => {
	assert.throws(
		() =>
			compilePostgresFetch({
				columns: "id; drop table users",
				table_name: "users",
			}),
		(error: unknown) =>
			error instanceof PostgresSqlCompileError &&
			error.code === "unsafe_select",
	);
});

test("rejects nested relation select", () => {
	assert.throws(
		() =>
			compilePostgresFetch({
				select: {
					id: true,
					posts: { select: { id: true } },
				} as never,
				table_name: "users",
			}),
		(error: unknown) =>
			error instanceof PostgresSqlCompileError &&
			error.code === "relations_unsupported",
	);
});

test("rejects raw or/not expressions", () => {
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
});

test("legacy or() inbox filter compiles to parameterized OR", () => {
	const compiled = compilePostgresFetch({
		conditions: [{ operator: "or", value: "deleted.eq.false,deleted.is.null" }],
		table_name: "notifications",
	});
	assert.equal(
		compiled.text.includes('"deleted" = $1') &&
			compiled.text.includes('"deleted" IS NULL'),
		true,
	);
	assert.deepEqual(compiled.values, [false]);
});

test("contains uses jsonb @>", () => {
	const compiled = compilePostgresFetch({
		conditions: [
			{
				column: "meta",
				operator: "contains",
				value: { role: "admin" } as never,
			},
		],
		table_name: "users",
	});
	assert.equal(
		compiled.text,
		'SELECT * FROM "users" WHERE "meta" @> $1::jsonb',
	);
	assert.deepEqual(compiled.values, [JSON.stringify({ role: "admin" })]);
});

test("count compiles __athena_count", () => {
	const compiled = compilePostgresCount({
		conditions: [{ column: "active", operator: "eq", value: true }],
		table_name: "users",
	});
	assert.equal(
		compiled.text,
		'SELECT COUNT(*)::bigint AS __athena_count FROM "users" WHERE "active" = $1',
	);
	assert.deepEqual(compiled.values, [true]);
});

test("insert multi-row with $n and DEFAULT for sparse", () => {
	const compiled = compilePostgresInsert({
		columns: "*",
		insert_body: [{ email: "a@b.c" }, { email: "c@d.e", name: "Ada" }],
		table_name: "users",
	});
	assert.equal(
		compiled.text,
		'INSERT INTO "users" ("email", "name") VALUES ($1, DEFAULT), ($2, $3) RETURNING *',
	);
	assert.deepEqual(compiled.values, ["a@b.c", "c@d.e", "Ada"]);
});

test("upsert on_conflict uses EXCLUDED", () => {
	const compiled = compilePostgresInsert({
		columns: "*",
		insert_body: { email: "a@example.com", name: "Ada" },
		on_conflict: "email",
		table_name: "users",
	});
	assert.match(compiled.text, /ON CONFLICT \("email"\) DO UPDATE SET/);
	assert.match(compiled.text, /"name" = EXCLUDED\."name"/);
	assert.deepEqual(compiled.values, ["a@example.com", "Ada"]);
});

test("update binds SET then WHERE", () => {
	const compiled = compilePostgresUpdate({
		conditions: [{ column: "id", operator: "eq", value: 7 }],
		table_name: "users",
		update_body: { name: "Bob" },
	});
	assert.equal(compiled.text, 'UPDATE "users" SET "name" = $1 WHERE "id" = $2');
	assert.deepEqual(compiled.values, ["Bob", 7]);
});

test("rejects unfiltered update", () => {
	assert.throws(
		() =>
			compilePostgresUpdate({
				table_name: "users",
				update_body: { name: "x" },
			}),
		(error: unknown) =>
			error instanceof PostgresSqlCompileError &&
			error.code === "unfiltered_update",
	);
});

test("bounded update requires identity column", () => {
	assert.throws(
		() =>
			compilePostgresUpdate({
				conditions: [{ column: "active", operator: "eq", value: true }],
				limit: 1,
				table_name: "users",
				update_body: { name: "x" },
			}),
		(error: unknown) =>
			error instanceof PostgresSqlCompileError &&
			error.code === "bounded_mutation_no_unique_identity",
	);
});

test("bounded update with identity uses IN subquery", () => {
	const compiled = compilePostgresUpdate(
		{
			conditions: [{ column: "active", operator: "eq", value: true }],
			limit: 2,
			table_name: "users",
			update_body: { name: "x" },
		},
		{ identityColumn: "id" },
	);
	assert.equal(
		compiled.text,
		'UPDATE "users" SET "name" = $1 WHERE "id" IN (SELECT "id" FROM "users" WHERE "active" = $2 LIMIT 2)',
	);
	assert.deepEqual(compiled.values, ["x", true]);
});

test("delete requires filter", () => {
	assert.throws(
		() =>
			compilePostgresDelete({
				table_name: "users",
			}),
		(error: unknown) =>
			error instanceof PostgresSqlCompileError &&
			error.code === "unfiltered_delete",
	);
});

test("delete compiles WHERE binds", () => {
	const compiled = compilePostgresDelete({
		conditions: [{ column: "id", operator: "eq", value: "abc" }],
		table_name: "users",
	});
	assert.equal(compiled.text, 'DELETE FROM "users" WHERE "id" = $1');
	assert.deepEqual(compiled.values, ["abc"]);
});

test("delete resource_id-only maps to id predicate", () => {
	const compiled = compilePostgresDelete({
		resource_id: "u_1",
		table_name: "users",
	});
	assert.equal(compiled.text, 'DELETE FROM "users" WHERE "id" = $1');
	assert.deepEqual(compiled.values, ["u_1"]);
});

test("delete resource_id preserves explicit resource_id filter", () => {
	const compiled = compilePostgresDelete({
		conditions: [{ column: "resource_id", operator: "eq", value: "r_1" }],
		resource_id: "r_1",
		table_name: "users",
	});
	assert.equal(compiled.text, 'DELETE FROM "users" WHERE "resource_id" = $1');
	assert.deepEqual(compiled.values, ["r_1"]);
});

test("values never appear in SQL text (injection)", () => {
	const evil = "1; DROP TABLE users;--";
	const compiled = compilePostgresFetch({
		conditions: [{ column: "name", operator: "eq", value: evil }],
		table_name: "users",
	});
	assert.equal(compiled.text.includes(evil), false);
	assert.deepEqual(compiled.values, [evil]);
});

test("rpc zero-arg compiles quoted function and empty call", () => {
	const compiled = compilePostgresRpc({ function: "now_utc" });
	assert.equal(compiled.text, 'SELECT * FROM "now_utc"()');
	assert.deepEqual(compiled.values, []);
});

test("rpc named args are bound, never interpolated", () => {
	const evil = "1); DROP TABLE users;--";
	const compiled = compilePostgresRpc({
		args: { a: 1, b: null, note: evil },
		function: "add_note",
	});
	assert.equal(
		compiled.text,
		'SELECT * FROM "add_note"("a" => $1, "b" => $2, "note" => $3)',
	);
	assert.equal(compiled.text.includes(evil), false);
	assert.equal(compiled.values.length, 3);
	assert.equal(compiled.values[0], 1);
	assert.equal(compiled.values[1], null);
	assert.equal(compiled.values[2], evil);
});

test("rpc schema-qualified name is quote-split", () => {
	const compiled = compilePostgresRpc({
		function: "score",
		schema: "app",
	});
	assert.equal(compiled.text, 'SELECT * FROM "app"."score"()');
});

test("rpc rejects injected function identifier", () => {
	assert.throws(
		() => compilePostgresRpc({ function: "fn; drop table users" }),
		(error: unknown) =>
			error instanceof PostgresSqlCompileError &&
			error.code === "invalid_identifier",
	);
});

test("rpc rejects injected argument name", () => {
	assert.throws(
		() =>
			compilePostgresRpc({
				args: { "a) ; drop": 1 },
				function: "score",
			}),
		(error: unknown) =>
			error instanceof PostgresSqlCompileError &&
			error.code === "invalid_identifier",
	);
});

test("rpc head compiles count over the function result", () => {
	const compiled = compilePostgresRpc({
		function: "list_rows",
		head: true,
	});
	assert.equal(
		compiled.text,
		'SELECT COUNT(*)::bigint AS __athena_count FROM "list_rows"()',
	);
});

test("rpc missing function is fail-closed", () => {
	assert.throws(
		() => compilePostgresRpc({ function: "   " }),
		(error: unknown) =>
			error instanceof PostgresSqlCompileError &&
			error.code === "missing_function",
	);
});
