import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
	AthenaQueryError,
	normalizeFindManyInput,
	resolveQueryPlan,
	validateQueryComplexity,
	type AthenaRelationCatalog,
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
			cardinality: "one-to-many",
			from: { columns: ["id"], table: "posts" },
			id: "posts.comments",
			name: "comments",
			to: { columns: ["post_id"], table: "comments" },
		},
		{
			cardinality: "many-to-one",
			from: { columns: ["author_id"], table: "posts" },
			id: "posts.author",
			name: "author",
			to: { columns: ["id"], table: "users" },
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

test("normalizeWhere lifts some/none/every into relation condition AST", () => {
	const ast = normalizeFindManyInput({
		select: { id: true },
		table: "users",
		where: {
			posts: {
				some: { published: true },
			},
		},
	});
	assert.equal(ast.filter?.kind, "relation");
	if (ast.filter?.kind !== "relation") {
		return;
	}
	assert.equal(ast.filter.relation, "posts");
	assert.equal(ast.filter.predicate, "some");
	assert.equal(ast.filter.filter?.kind, "compare");
});

test("eq true and published: true normalize equivalently under some", () => {
	const shorthand = normalizeFindManyInput({
		select: { id: true },
		table: "users",
		where: { posts: { some: { published: true } } },
	});
	const explicit = normalizeFindManyInput({
		select: { id: true },
		table: "users",
		where: { posts: { some: { published: { eq: true } } } },
	});
	assert.deepEqual(shorthand.filter, explicit.filter);
});

test("to-one is/isNot normalize as relation predicates", () => {
	const ast = normalizeFindManyInput({
		select: { id: true },
		table: "posts",
		where: { author: { is: { active: true } } },
	});
	assert.equal(ast.filter?.kind, "relation");
	if (ast.filter?.kind === "relation") {
		assert.equal(ast.filter.predicate, "is");
		assert.equal(ast.filter.relation, "author");
	}
});

test("scalar is: null remains a column null check", () => {
	const ast = normalizeFindManyInput({
		select: { id: true },
		table: "users",
		where: { deleted_at: { is: null } },
	});
	assert.equal(ast.filter?.kind, "is-null");
});

test("empty some/none/every have defined existence semantics", () => {
	const some = normalizeFindManyInput({
		select: { id: true },
		table: "users",
		where: { posts: { some: {} } },
	});
	const none = normalizeFindManyInput({
		select: { id: true },
		table: "users",
		where: { posts: { none: {} } },
	});
	const every = normalizeFindManyInput({
		select: { id: true },
		table: "users",
		where: { posts: { every: {} } },
	});
	assert.equal(some.filter?.kind, "relation");
	assert.equal(none.filter?.kind, "relation");
	assert.equal(every.filter?.kind, "relation");
	if (some.filter?.kind === "relation") {
		assert.equal(some.filter.predicate, "some");
		assert.equal(some.filter.filter, undefined);
	}
});

test("cyclic where objects fail closed", () => {
	const where: Record<string, unknown> = {};
	where.self = where;
	assert.throws(
		() =>
			normalizeFindManyInput({
				select: { id: true },
				table: "users",
				where,
			}),
		(error: unknown) =>
			error instanceof AthenaQueryError &&
			error.code === "ATHENA_QUERY_CYCLIC_INPUT",
	);
});

test("resolveQueryPlan resolves nested relation predicates and many-to-many", () => {
	const ast = normalizeFindManyInput({
		select: {
			id: true,
			roles: { select: { name: true } },
		},
		table: "users",
		where: {
			posts: {
				some: {
					comments: { some: { approved: true } },
				},
			},
		},
	});
	const plan = resolveQueryPlan(ast, { catalog });
	assert.equal(plan.filter?.kind, "resolved-relation");
	if (plan.filter?.kind !== "resolved-relation") {
		return;
	}
	assert.equal(plan.filter.descriptor.name, "posts");
	assert.equal(plan.filter.predicate, "some");
	assert.equal(plan.filter.filter?.kind, "resolved-relation");
	const roles = plan.selection.find((field) => field.kind === "relation");
	assert.ok(roles && roles.kind === "relation");
	assert.equal(roles.descriptor.cardinality, "many-to-many");
	assert.ok(roles.junctionAlias);
});

test("parent relation predicate is independent of nested selection filters", () => {
	const ast = normalizeFindManyInput({
		select: {
			posts: {
				select: { title: true },
				where: { published: true },
			},
		},
		table: "users",
		where: { posts: { some: { published: true } } },
	});
	const plan = resolveQueryPlan(ast, { catalog });
	assert.equal(plan.filter?.kind, "resolved-relation");
	const posts = plan.selection.find((field) => field.kind === "relation");
	assert.ok(posts && posts.kind === "relation");
	assert.equal(posts.plan.filter?.kind, "compare");
});

test("relation predicates consume the same nesting budget as selection", () => {
	const ast = normalizeFindManyInput({
		select: { id: true },
		table: "users",
		where: {
			posts: {
				some: {
					comments: { some: { approved: true } },
				},
			},
		},
	});
	assert.throws(
		() => validateQueryComplexity(ast, { maxNestedDepth: 1 }),
		(error: unknown) =>
			error instanceof AthenaQueryError &&
			(error.code === "ATHENA_QUERY_INVALID_NESTING" ||
				error.code === "ATHENA_QUERY_MAX_DEPTH_EXCEEDED"),
	);
});
