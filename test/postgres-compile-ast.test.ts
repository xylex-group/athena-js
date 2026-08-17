import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  compilePostgresAst,
  compilePostgresAstCount,
} from "../src/postgres/compile-ast.ts";
import {
  normalizeFindManyInput,
  resetQueryPlanAliases,
  resolveQueryPlan,
  type AthenaRelationCatalog,
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

test("compilePostgresAst emits one parameterized nested json_agg statement", () => {
  resetQueryPlanAliases();
  const ast = normalizeFindManyInput({
    select: {
      name: true,
      instruments: { select: { name: true } },
    },
    table: "orchestral_sections",
    where: { name: { eq: "Brass" } },
  });
  const compiled = compilePostgresAst(resolveQueryPlan(ast, { catalog }));
  assert.match(compiled.text, /json_agg\(row_to_json\(/);
  assert.match(compiled.text, /FROM "orchestral_sections" AS "t1"/);
  assert.match(compiled.text, /"t1"\."id" = "r2"\."section_id"/);
  assert.match(compiled.text, /WHERE "t1"\."name" = \$1/);
  assert.doesNotMatch(compiled.text, /for \(.*of/);
  assert.deepEqual(compiled.values, ["Brass"]);
});

test("compilePostgresAst applies nested filter, order, and child limit", () => {
  resetQueryPlanAliases();
  const ast = normalizeFindManyInput({
    limit: 2,
    select: {
      name: true,
      instruments: {
        limit: 1,
        orderBy: { name: "desc" },
        select: { name: true },
        where: { name: { ilike: "T%" } },
      },
    },
    table: "orchestral_sections",
  });
  const compiled = compilePostgresAst(resolveQueryPlan(ast, { catalog }));
  assert.match(compiled.text, /LIMIT 2$/);
  assert.match(compiled.text, /"r2"\."name" ILIKE \$1/);
  assert.match(compiled.text, /ORDER BY "r2"\."name" DESC/);
  assert.match(compiled.text, /LIMIT 1/);
  assert.deepEqual(compiled.values, ["T%"]);
});

test("compilePostgresAst binds user values and quotes identifiers", () => {
  resetQueryPlanAliases();
  const ast = normalizeFindManyInput({
    select: { name: true },
    table: "orchestral_sections",
    where: { name: { ilike: "%wood%" } },
    limit: 5,
  });
  const compiled = compilePostgresAst(resolveQueryPlan(ast, { catalog }));
  assert.equal(
    compiled.text,
    'SELECT "t1"."name" FROM "orchestral_sections" AS "t1" WHERE "t1"."name" ILIKE $1 LIMIT 5'
  );
  assert.deepEqual(compiled.values, ["%wood%"]);
});

test("compilePostgresAstCount counts parent rows only", () => {
  resetQueryPlanAliases();
  const ast = normalizeFindManyInput({
    select: {
      name: true,
      instruments: { select: { name: true } },
    },
    table: "orchestral_sections",
    where: { name: { eq: "Brass" } },
  });
  const compiled = compilePostgresAstCount(resolveQueryPlan(ast, { catalog }));
  assert.equal(
    compiled.text,
    'SELECT COUNT(*)::bigint AS __athena_count FROM "orchestral_sections" AS "t1" WHERE "t1"."name" = $1'
  );
  assert.deepEqual(compiled.values, ["Brass"]);
});
