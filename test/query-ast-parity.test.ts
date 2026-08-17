/**
 * Cross-backend parity: one public query → AST → plan → PG / D1 / Gateway.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { compileD1Ast } from "../src/cloudflare/d1/compile-ast.ts";
import { serializeGatewayPlan } from "../src/gateway/serialize-ast.ts";
import { compilePostgresAst } from "../src/postgres/compile-ast.ts";
import {
  normalizeFindManyInput,
  resetQueryPlanAliases,
  resolveQueryPlan,
  type AthenaRelationCatalog,
} from "../src/query/index.ts";

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

const publicQuery = {
  select: {
    instruments: { select: { name: true } },
    name: true,
  },
  table: "orchestral_sections",
  where: { name: { eq: "Brass" } },
};

test("same public query compiles on PostgreSQL, D1, and Gateway", () => {
  resetQueryPlanAliases();
  const ast = normalizeFindManyInput(publicQuery);
  const plan = resolveQueryPlan(ast, { catalog });

  const pg = compilePostgresAst(plan);
  const d1 = compileD1Ast(plan);
  const gateway = serializeGatewayPlan(plan);

  assert.match(pg.text, /json_agg\(row_to_json\(/);
  assert.match(pg.text, /\$1/);
  assert.deepEqual(pg.values, ["Brass"]);

  assert.match(d1.sql, /json_group_array/);
  assert.match(d1.sql, /\?/);
  assert.deepEqual(d1.params, ["Brass"]);

  assert.equal(gateway.table_name, "orchestral_sections");
  assert.deepEqual(gateway.where, { name: { eq: "Brass" } });
  assert.match(String(gateway.select), /instruments\(name\)/);
});
