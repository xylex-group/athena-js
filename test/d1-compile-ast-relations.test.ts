import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { compileD1Ast } from "../src/cloudflare/d1/compile-ast.ts";
import {
	AthenaQueryError,
	type AthenaRelationCatalog,
	normalizeFindManyInput,
	resolveQueryPlan,
} from "../src/query/engine/index.ts";

const catalog: AthenaRelationCatalog = {
	entries: [
		{
			cardinality: "one-to-many",
			from: { columns: ["id"], table: "users" },
			id: "users.posts",
			name: "posts",
			to: { columns: ["user_id"], table: "posts" },
		},
		{
			cardinality: "many-to-many",
			from: { columns: ["id"], table: "users" },
			id: "users.roles",
			junction: {
				fromColumns: ["user_id"],
				table: "user_roles",
				toColumns: ["role_id"],
			},
			name: "roles",
			to: { columns: ["id"], table: "roles" },
		},
	],
};

function compile(input: {
	select: Record<string, unknown>;
	where?: Record<string, unknown>;
}) {
	const ast = normalizeFindManyInput({
		select: input.select as never,
		table: "users",
		where: input.where,
	});
	return compileD1Ast(resolveQueryPlan(ast, { catalog }));
}

test("D1 some compiles to correlated EXISTS with ? binds", () => {
	const compiled = compile({
		select: { id: true },
		where: { posts: { some: { published: true } } },
	});
	assert.match(compiled.sql, /EXISTS \(/);
	assert.match(compiled.sql, /"t1"\."id" = "r\d+"\."user_id"/);
	assert.match(compiled.sql, /"published" = \?/);
	assert.deepEqual(compiled.params, [true]);
});

test("D1 every uses CASE rather than IS NOT TRUE", () => {
	const compiled = compile({
		select: { id: true },
		where: { posts: { every: { published: true } } },
	});
	assert.match(compiled.sql, /NOT EXISTS \(/);
	assert.match(compiled.sql, /CASE WHEN/);
	assert.doesNotMatch(compiled.sql, /IS NOT TRUE/);
	assert.deepEqual(compiled.params, [true]);
});

test("D1 many-to-many nested selection joins the junction once", () => {
	const compiled = compile({
		select: {
			id: true,
			roles: {
				limit: 5,
				select: { name: true },
			},
		},
	});
	assert.match(compiled.sql, /json_group_array/);
	assert.match(compiled.sql, /JOIN "user_roles" AS "/);
	assert.match(compiled.sql, /LIMIT 5/);
	assert.doesNotMatch(compiled.sql, /for \(.*of/);
});

test("D1 compare with null after normalize fails closed", () => {
	const ast = normalizeFindManyInput({
		select: { id: true },
		table: "users",
		where: { name: { eq: "ok" } },
	});
	const plan = resolveQueryPlan(ast, { catalog });
	if (plan.filter?.kind === "compare") {
		(plan.filter as { value: unknown }).value = null;
	}
	assert.throws(
		() => compileD1Ast(plan),
		(error: unknown) =>
			error instanceof AthenaQueryError &&
			error.code === "ATHENA_QUERY_INVALID_NORMALIZED_AST",
	);
});
