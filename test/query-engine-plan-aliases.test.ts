import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
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
			cardinality: "one-to-many",
			from: { columns: ["id"], table: "posts" },
			id: "posts.comments",
			name: "comments",
			to: { columns: ["post_id"], table: "comments" },
		},
	],
};

function usersWithNestedPosts() {
	return normalizeFindManyInput({
		select: {
			id: true,
			posts: {
				select: {
					comments: { select: { id: true } },
					title: true,
				},
			},
		},
		table: "users",
	});
}

function collectAliases(plan: ReturnType<typeof resolveQueryPlan>): string[] {
	const aliases = [plan.source.alias];
	for (const field of plan.selection) {
		if (field.kind === "relation") {
			aliases.push(...collectAliases(field.plan));
		}
	}
	return aliases;
}

test("same AST produces identical plan aliases on every invocation", () => {
	const ast = usersWithNestedPosts();
	const first = collectAliases(resolveQueryPlan(ast, { catalog }));
	for (let index = 0; index < 100; index += 1) {
		assert.deepEqual(collectAliases(resolveQueryPlan(ast, { catalog })), first);
	}
	assert.deepEqual(first, ["t1", "r2", "r3"]);
});

test("concurrent planning does not couple alias allocation", async () => {
	const ast = usersWithNestedPosts();
	const plans = await Promise.all(
		Array.from({ length: 32 }, () =>
			Promise.resolve(resolveQueryPlan(ast, { catalog })),
		),
	);
	const expected = collectAliases(
		plans[0] as ReturnType<typeof resolveQueryPlan>,
	);
	for (const plan of plans) {
		assert.deepEqual(collectAliases(plan), expected);
	}
});

test("independent planners do not affect one another", () => {
	const ast = usersWithNestedPosts();
	const left = collectAliases(resolveQueryPlan(ast, { catalog }));
	const right = collectAliases(resolveQueryPlan(ast, { catalog }));
	assert.deepEqual(left, right);
	assert.deepEqual(left, ["t1", "r2", "r3"]);
});
