import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { compileD1Ast } from "../src/cloudflare/d1/compile-ast.ts";
import { compilePostgresAst } from "../src/postgres/compile-ast.ts";
import {
  AthenaQueryError,
  GATEWAY_QUERY_CAPABILITIES,
  type AthenaRelationCatalog,
  normalizeFindManyInput,
  relationResultShape,
  resolveQueryPlan,
  serializeRelationalQueryV1,
  serializeRelationalQueryV2,
  SQLITE_LOCAL_QUERY_CAPABILITIES,
  validatePlanAgainstCapabilities,
} from "../src/query/engine/index.ts";

const catalog: AthenaRelationCatalog = {
  entries: [
    {
      cardinality: "one-to-many",
      from: {
        columns: ["organization_id", "node_id"],
        schema: "wa_execution",
        table: "execution_nodes",
      },
      id: "relation:v1/wa_execution/wa_execution/execution_nodes/execution_attempts",
      name: "execution_attempts",
      to: {
        columns: ["organization_id", "node_id"],
        schema: "wa_execution",
        table: "execution_attempts",
      },
    },
  ],
};

function waInput() {
  return normalizeFindManyInput({
    orderBy: { node_id: "asc" },
    select: {
      execution_attempts: {
        as: "latest_attempt",
        orderBy: [{ claimed_at: "desc" }, { attempt_id: "desc" }],
        select: {
          failure_code: true,
          failure_kind: true,
          failure_message: true,
        },
        selection: "first",
        where: { finished_at: { neq: null } },
      },
      node_id: true,
      state: true,
    },
    table: "wa_execution.execution_nodes",
    where: {
      organization_id: "org:1",
      plan_id: "plan:1",
    },
  });
}

test("relationResultShape keeps physical cardinality distinct from First", () => {
  assert.equal(
    relationResultShape("one-to-many", "first"),
    "at-most-one"
  );
  assert.equal(relationResultShape("one-to-many", "natural"), "many");
  assert.equal(relationResultShape("many-to-one", "natural"), "at-most-one");
});

test("normalize and resolve retain descriptor cardinality and First selection", () => {
  const plan = resolveQueryPlan(waInput(), { catalog });
  const relation = plan.selection.find((field) => field.kind === "relation");
  assert.equal(relation?.kind, "relation");
  if (relation?.kind !== "relation") {
    throw new Error("expected relation");
  }
  assert.equal(relation.descriptor.cardinality, "one-to-many");
  assert.equal(relation.selection, "first");
});

test("First rejects limit unless it is absent or 1", () => {
  for (const limit of [0, 20]) {
    assert.throws(
      () =>
        normalizeFindManyInput({
          select: {
            latest_attempt: {
              as: "latest_attempt",
              limit,
              select: { failure_kind: true },
              selection: "first",
            },
          },
          table: "execution_nodes",
        }),
      (error: AthenaQueryError) =>
        error.code === "ATHENA_QUERY_INVALID_SELECTION"
    );
  }
});

test("root orderBy remains a single expression", () => {
  assert.throws(
    () =>
      normalizeFindManyInput({
        orderBy: [{ claimed_at: "desc" }, { attempt_id: "desc" }] as never,
        select: { node_id: true },
        table: "execution_nodes",
      }),
    (error: AthenaQueryError) =>
      error.code === "ATHENA_QUERY_UNSUPPORTED_OPERATOR"
  );
});

test("direct Postgres and D1 compile First as a scalar nested object", () => {
  const plan = resolveQueryPlan(waInput(), { catalog });
  const postgres = compilePostgresAst(plan);
  const d1 = compileD1Ast(plan);
  assert.match(postgres.text, /row_to_json/);
  assert.doesNotMatch(postgres.text, /json_agg/);
  assert.match(postgres.text, /LIMIT 1/);
  assert.match(postgres.text, /claimed_at/);
  assert.match(postgres.text, /attempt_id/);
  assert.doesNotMatch(d1.sql, /json_group_array/);
  assert.match(d1.sql, /LIMIT 1/);
  assert.match(d1.sql, /claimed_at/);
  assert.match(d1.sql, /attempt_id/);
});

test("natural to-one preserves limit 0", () => {
  const toOne: AthenaRelationCatalog = {
    entries: [
      {
        cardinality: "many-to-one",
        from: {
          columns: ["user_id"],
          table: "posts",
        },
        id: "relation:v1/public/public/posts/users",
        name: "author",
        to: {
          columns: ["id"],
          table: "users",
        },
      },
    ],
  };
  const plan = resolveQueryPlan(
    normalizeFindManyInput({
      select: {
        author: {
          limit: 0,
          select: { id: true },
        },
        id: true,
      },
      table: "posts",
    }),
    { catalog: toOne }
  );
  const postgres = compilePostgresAst(plan);
  const d1 = compileD1Ast(plan);
  assert.match(postgres.text, /LIMIT 0/);
  assert.doesNotMatch(postgres.text, /LIMIT 1/);
  assert.match(d1.sql, /LIMIT 0/);
  assert.doesNotMatch(d1.sql, /LIMIT 1/);
});

test("Natural limit 1 still aggregates to an array on Postgres", () => {
  const plan = resolveQueryPlan(
    normalizeFindManyInput({
      select: {
        execution_attempts: {
          as: "latest_attempt",
          limit: 1,
          select: { failure_kind: true },
        },
        node_id: true,
      },
      table: "wa_execution.execution_nodes",
    }),
    { catalog }
  );
  const postgres = compilePostgresAst(plan);
  assert.match(postgres.text, /json_agg/);
});

test("V1 serializer refuses First; V2 preserves it", () => {
  const plan = resolveQueryPlan(waInput(), { catalog });
  assert.throws(
    () => serializeRelationalQueryV1(plan),
    (error: AthenaQueryError) =>
      error.code === "ATHENA_QUERY_UNSUPPORTED_CAPABILITY"
  );
  const v2 = serializeRelationalQueryV2(plan);
  assert.equal(v2.version, "v2");
  assert.equal(v2.relations[0]?.selection, "first");
  assert.equal(v2.relations[0]?.alias, "latest_attempt");
});

test("gateway and sqlite-local reject First before execution", () => {
  const plan = resolveQueryPlan(waInput(), { catalog });
  assert.throws(
    () => validatePlanAgainstCapabilities(plan, GATEWAY_QUERY_CAPABILITIES),
    (error: AthenaQueryError) =>
      error.code === "ATHENA_QUERY_UNSUPPORTED_CAPABILITY"
  );
  assert.throws(
    () =>
      validatePlanAgainstCapabilities(plan, SQLITE_LOCAL_QUERY_CAPABILITIES),
    (error: AthenaQueryError) =>
      error.code === "ATHENA_QUERY_UNSUPPORTED_CAPABILITY"
  );
});
