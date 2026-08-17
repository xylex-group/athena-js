import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
	AthenaQueryError,
	catalogFromModels,
	normalizeFindManyInput,
	resetQueryPlanAliases,
	resolveQueryPlan,
	validateQueryComplexity,
	type AthenaRelationCatalog,
} from "../src/query/engine/index.ts";

const catalog: AthenaRelationCatalog = {
	entries: [
		{
			cardinality: "many-to-one",
			from: {
				columns: ["section_id"],
				schema: "public",
				table: "instruments",
			},
			id: "public.instruments.instruments_section_id_fkey",
			name: "orchestral_sections",
			to: {
				columns: ["id"],
				schema: "public",
				table: "orchestral_sections",
			},
		},
	],
};

test("resolveQueryPlan inverts a unique incoming FK for to-many embeds", () => {
	resetQueryPlanAliases();
	const ast = normalizeFindManyInput({
		select: {
			name: true,
			instruments: { select: { name: true } },
		},
		table: "orchestral_sections",
	});
	const plan = resolveQueryPlan(ast, { catalog });
	const relation = plan.selection.find((field) => field.kind === "relation");
	assert.ok(relation && relation.kind === "relation");
	assert.equal(relation.descriptor.cardinality, "one-to-many");
	assert.deepEqual(relation.descriptor.from.columns, ["id"]);
	assert.deepEqual(relation.descriptor.to.columns, ["section_id"]);
	assert.equal(relation.plan.source.table, "instruments");
});

test("resolveQueryPlan fails closed without catalog evidence", () => {
	const ast = normalizeFindManyInput({
		select: {
			name: true,
			instruments: { select: { name: true } },
		},
		table: "orchestral_sections",
	});
	assert.throws(
		() => resolveQueryPlan(ast),
		(error: unknown) =>
			error instanceof AthenaQueryError &&
			error.code === "ATHENA_QUERY_UNKNOWN_RELATION",
	);
});

test("resolveQueryPlan fails closed when two FKs target the same table", () => {
	resetQueryPlanAliases();
	const ast = normalizeFindManyInput({
		select: {
			name: true,
			instruments: { select: { name: true } },
		},
		table: "orchestral_sections",
	});
	assert.throws(
		() =>
			resolveQueryPlan(ast, {
				catalog: {
					entries: [
						{
							cardinality: "many-to-one",
							from: { columns: ["section_id"], table: "instruments" },
							id: "fk-1",
							name: "orchestral_sections",
							to: { columns: ["id"], table: "orchestral_sections" },
						},
						{
							cardinality: "many-to-one",
							from: { columns: ["alt_section_id"], table: "instruments" },
							id: "fk-2",
							name: "orchestral_sections",
							to: { columns: ["id"], table: "orchestral_sections" },
						},
					],
				},
			}),
		(error: unknown) =>
			error instanceof AthenaQueryError &&
			error.code === "ATHENA_QUERY_AMBIGUOUS_RELATION",
	);
});

test("catalogFromModels is priority-1 named relation metadata", () => {
	resetQueryPlanAliases();
	const catalog = catalogFromModels({
		Section: {
			meta: {
				primaryKey: ["id"],
				relations: {
					instruments: {
						kind: "one-to-many",
						sourceColumns: ["id"],
						targetColumns: ["section_id"],
						targetModel: "instruments",
						targetSchema: "public",
					},
				},
				schema: "public",
				tableName: "orchestral_sections",
			},
		},
	});
	const ast = normalizeFindManyInput({
		select: {
			instruments: { select: { name: true } },
			name: true,
		},
		table: "orchestral_sections",
	});
	const plan = resolveQueryPlan(ast, { catalog });
	const relation = plan.selection.find((field) => field.kind === "relation");
	assert.equal(relation?.kind, "relation");
	if (relation?.kind === "relation") {
		assert.equal(relation.descriptor.name, "instruments");
		assert.equal(relation.descriptor.cardinality, "one-to-many");
		assert.deepEqual(relation.descriptor.to.columns, ["section_id"]);
	}
});

test("validateQueryComplexity rejects runaway nesting", () => {
	const nest = (depth: number): Record<string, unknown> =>
		depth === 0
			? { name: true }
			: { child: { select: nest(depth - 1) }, name: true };
	const ast = normalizeFindManyInput({
		select: nest(3) as never,
		table: "root",
	});
	assert.throws(
		() => validateQueryComplexity(ast, { maxNestedDepth: 2 }),
		(error: unknown) =>
			error instanceof AthenaQueryError &&
			error.code === "ATHENA_QUERY_INVALID_NESTING",
	);
});
