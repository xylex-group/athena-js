import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  compilePostgresAst,
  compilePostgresAstCount,
} from "../src/postgres/compile-ast.ts";
import {
  AthenaQueryError,
  normalizeFindManyInput,
  resolveQueryPlan,
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
      cardinality: "many-to-many",
      from: { columns: ["id"], table: "users" },
      id: "users.roles",
      junction: {
        fromColumns: ["user_id"],
        schema: "auth",
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
  table?: string;
  where?: Record<string, unknown>;
  limit?: number;
}) {
  const ast = normalizeFindManyInput({
    limit: input.limit,
    select: input.select as never,
    table: input.table ?? "users",
    where: input.where,
  });
  return compilePostgresAst(resolveQueryPlan(ast, { catalog }));
}

test("some compiles to correlated EXISTS", () => {
  const compiled = compile({
    select: { id: true },
    where: { posts: { some: { published: true } } },
  });
  assert.match(compiled.text, /EXISTS \(/);
  assert.match(compiled.text, /FROM "posts" AS "/);
  assert.match(compiled.text, /"t1"\."id" = "r\d+"\."user_id"/);
  assert.match(compiled.text, /"published" = \$1/);
  assert.doesNotMatch(compiled.text, /NOT EXISTS/);
  assert.deepEqual(compiled.values, [true]);
});

test("none compiles to NOT EXISTS", () => {
  const compiled = compile({
    select: { id: true },
    where: { posts: { none: { published: false } } },
  });
  assert.match(compiled.text, /NOT EXISTS \(/);
  assert.deepEqual(compiled.values, [false]);
});

test("every compiles to NOT EXISTS of the negated predicate", () => {
  const compiled = compile({
    select: { id: true },
    where: { posts: { every: { published: true } } },
  });
  assert.match(compiled.text, /NOT EXISTS \(/);
  assert.match(compiled.text, /IS NOT TRUE/);
  assert.deepEqual(compiled.values, [true]);
});

test("null comparisons compile to IS NULL not = $1", () => {
  const eqNull = compile({
    select: { id: true },
    where: { deleted_at: null },
  });
  const opNull = compile({
    select: { id: true },
    where: { deleted_at: { eq: null } },
  });
  const neqNull = compile({
    select: { id: true },
    where: { deleted_at: { neq: null } },
  });
  assert.match(eqNull.text, /"deleted_at" IS NULL/);
  assert.match(opNull.text, /"deleted_at" IS NULL/);
  assert.match(neqNull.text, /"deleted_at" IS NOT NULL/);
  assert.doesNotMatch(eqNull.text, /= \$1/);
  assert.doesNotMatch(neqNull.text, /<> \$1/);
  assert.deepEqual(eqNull.values, []);
});

test("compare with null after normalize fails closed", () => {
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
    () => compilePostgresAst(plan),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_INVALID_NORMALIZED_AST"
  );
});

test("many-to-many nested selection joins the junction table once", () => {
  const compiled = compile({
    select: {
      id: true,
      roles: {
        limit: 5,
        orderBy: { name: "asc" },
        select: { name: true },
      },
    },
  });
  assert.match(compiled.text, /json_agg\(row_to_json\(/);
  assert.match(compiled.text, /JOIN "auth"\."user_roles" AS "/);
  assert.match(compiled.text, /"user_id"/);
  assert.match(compiled.text, /"role_id"/);
  assert.match(compiled.text, /LIMIT 5/);
  assert.doesNotMatch(compiled.text, /for \(.*of/);
});

test("many-to-many some compiles EXISTS across the junction", () => {
  const compiled = compile({
    select: { id: true },
    where: { roles: { some: { name: "admin" } } },
  });
  assert.match(compiled.text, /EXISTS \(/);
  assert.match(compiled.text, /"user_roles"/);
  assert.match(compiled.text, /"roles"/);
  assert.match(compiled.text, /"name" = \$1/);
  assert.deepEqual(compiled.values, ["admin"]);
});

test("count includes relation predicates and omits nested JSON", () => {
  const ast = normalizeFindManyInput({
    select: {
      id: true,
      roles: { select: { name: true } },
    },
    table: "users",
    where: { roles: { some: { name: "admin" } } },
  });
  const compiled = compilePostgresAstCount(resolveQueryPlan(ast, { catalog }));
  assert.match(compiled.text, /COUNT\(\*\)::bigint/);
  assert.match(compiled.text, /EXISTS \(/);
  assert.doesNotMatch(compiled.text, /json_agg/);
  assert.deepEqual(compiled.values, ["admin"]);
});

test("root pagination applies after relational filtering", () => {
  const compiled = compile({
    limit: 10,
    select: { id: true },
    where: { posts: { some: { published: true } } },
  });
  assert.match(compiled.text, /EXISTS \(/);
  assert.match(compiled.text, /LIMIT 10$/);
});
