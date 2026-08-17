import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { compileD1Ast } from "../src/cloudflare/d1/compile-ast.ts";
import {
	type AthenaRelationCatalog,
	normalizeFindManyInput,
	resetQueryPlanAliases,
	resolveQueryPlan,
} from "../src/query/engine/index.ts";

const catalog: AthenaRelationCatalog = {
	entries: [
		{
			cardinality: "many-to-one",
			from: { columns: ["section_id"], table: "instruments" },
			id: "instruments.section_id",
			name: "orchestral_sections",
			to: { columns: ["id"], table: "orchestral_sections" },
		},
	],
};

test("compileD1Ast emits json_group_array with ? binds", () => {
	resetQueryPlanAliases();
	const ast = normalizeFindManyInput({
		select: {
			name: true,
			instruments: { select: { name: true } },
		},
		table: "orchestral_sections",
		where: { name: { eq: "Brass" } },
	});
	const compiled = compileD1Ast(resolveQueryPlan(ast, { catalog }));
	assert.match(compiled.sql, /json_group_array/);
	assert.match(compiled.sql, /json_object\('name', "r2"\."name"\)/);
	assert.match(compiled.sql, /"t1"\."name" = \?/);
	assert.deepEqual(compiled.params, ["Brass"]);
});

test("compileD1Ast applies nested filter, order, and child limit", () => {
	resetQueryPlanAliases();
	const ast = normalizeFindManyInput({
		select: {
			instruments: {
				limit: 1,
				orderBy: { name: "desc" },
				select: { name: true },
				where: { name: { eq: "Tuba" } },
			},
			name: true,
		},
		table: "orchestral_sections",
	});
	const compiled = compileD1Ast(resolveQueryPlan(ast, { catalog }));
	assert.match(compiled.sql, /"r2"\."name" = \?/);
	assert.match(compiled.sql, /ORDER BY "r2"\."name" DESC/);
	assert.match(compiled.sql, /LIMIT 1/);
	assert.deepEqual(compiled.params, ["Tuba"]);
});
