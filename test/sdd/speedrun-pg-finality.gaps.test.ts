/**
 * Remaining Speedrun-class Athena JS gaps: nested PostgREST or/not,
 * direct-PG RPC compile, many-to-many AST compile.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { compileD1Fetch } from "../../src/cloudflare/d1/sql.ts";
import { compilePostgresAst } from "../../src/postgres/compile-ast.ts";
import {
	compilePostgresFetch,
	compilePostgresRpc,
	PostgresSqlCompileError,
} from "../../src/postgres/sql.ts";
import {
	parseLegacyBooleanExpression,
	parseLegacyOrExpression,
} from "../../src/query/legacy-boolean.ts";
import {
	normalizeFindManyInput,
	resetQueryPlanAliases,
	resolveQueryPlan,
	type AthenaRelationCatalog,
} from "../../src/query/engine/index.ts";

test("nested PostgREST or() parses and/or groups", () => {
	const tree = parseLegacyBooleanExpression(
		"and(status.eq.active,deleted.is.null),role.eq.admin",
	);
	assert.equal(tree.kind, "or");
	if (tree.kind !== "or") {
		return;
	}
	assert.equal(tree.children[0]?.kind, "and");
	assert.equal(tree.children[1]?.kind, "pred");
});

test("flat parseLegacyOrExpression still returns Speedrun inbox predicates", () => {
	assert.deepEqual(
		parseLegacyOrExpression("deleted.eq.false,deleted.is.null"),
		[
			{ column: "deleted", operator: "eq", value: false },
			{ column: "deleted", operator: "is", value: null },
		],
	);
});

test("PG compiles nested or() and .not() to parameterized SQL", () => {
	const orCompiled = compilePostgresFetch({
		conditions: [
			{
				operator: "or",
				value: "and(status.eq.active,deleted.is.null),role.eq.admin",
			},
		],
		table_name: "notifications",
	});
	assert.match(orCompiled.text, /"status" = \$1/);
	assert.match(orCompiled.text, /"deleted" IS NULL/);
	assert.match(orCompiled.text, /"role" = \$2/);
	assert.match(orCompiled.text, / AND /);
	assert.match(orCompiled.text, / OR /);
	assert.deepEqual(orCompiled.values, ["active", "admin"]);

	const notCompiled = compilePostgresFetch({
		conditions: [{ operator: "not", value: "deleted.eq.true" }],
		table_name: "notifications",
	});
	assert.match(notCompiled.text, /\(NOT \(/);
	assert.match(notCompiled.text, /"deleted" = \$1/);
	assert.deepEqual(notCompiled.values, [true]);
});

test("unsafe raw or() still fails closed", () => {
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

test("D1 compiles nested or() and .not()", () => {
	const compiled = compileD1Fetch({
		conditions: [
			{
				operator: "or",
				value: "and(status.eq.active,deleted.is.null),role.eq.admin",
			},
		],
		table_name: "notifications",
	});
	assert.match(compiled.sql, /"status" = \?/);
	assert.match(compiled.sql, /"deleted" IS NULL/);
	assert.match(compiled.sql, /"role" = \?/);
	assert.deepEqual(compiled.params, ["active", "admin"]);

	const notCompiled = compileD1Fetch({
		conditions: [{ operator: "not", value: "status.eq.offline" }],
		table_name: "notifications",
	});
	assert.match(notCompiled.sql, /\(NOT \(/);
	assert.deepEqual(notCompiled.params, ["offline"]);
});

test("direct PG RPC compiles named args and filters without 501", () => {
	const compiled = compilePostgresRpc({
		args: { org_id: "org-1", limit_n: 5 },
		filters: [{ column: "active", operator: "eq", value: true }],
		function: "list_cases",
		limit: 10,
		schema: "public",
		select: "id,name",
	});
	assert.equal(
		compiled.text,
		'SELECT "id", "name" FROM "public"."list_cases"("org_id" => $1, "limit_n" => $2) WHERE "active" = $3 LIMIT 10',
	);
	assert.deepEqual(compiled.values, ["org-1", 5, true]);
});

test("direct PG RPC rejects unsafe function identifiers", () => {
	assert.throws(
		() =>
			compilePostgresRpc({
				function: "list_cases; drop table users",
			}),
		(error: unknown) =>
			error instanceof PostgresSqlCompileError &&
			error.code === "invalid_identifier",
	);
});

test("many-to-many AST compiles a single junction join", () => {
	resetQueryPlanAliases();
	const catalog: AthenaRelationCatalog = {
		entries: [
			{
				cardinality: "many-to-many",
				from: { columns: ["id"], table: "instruments" },
				id: "instruments.tags",
				junction: {
					fromColumns: ["instrument_id"],
					table: "instrument_tags",
					toColumns: ["tag_id"],
				},
				name: "tags",
				to: { columns: ["id"], table: "tags" },
			},
		],
	};
	const ast = normalizeFindManyInput({
		select: {
			name: true,
			tags: { select: { name: true } },
		},
		table: "instruments",
	});
	const compiled = compilePostgresAst(resolveQueryPlan(ast, { catalog }));
	assert.match(compiled.text, /JOIN "instrument_tags" AS "j\d+"/);
	assert.match(compiled.text, /json_agg\(row_to_json\(/);
	assert.match(compiled.text, /"instrument_id"/);
	assert.match(compiled.text, /"tag_id"/);
});
