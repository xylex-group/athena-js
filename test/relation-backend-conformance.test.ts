import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeFindManyInput,
  normalizeTransportPayload,
  resolveQueryPlan,
} from "../src/query/engine/index.ts";
import { compileD1Ast } from "../src/cloudflare/d1/compile-ast.ts";
import { compilePostgresAst } from "../src/postgres/compile-ast.ts";
import {
  readRelationFixture,
  relationFixtureCatalog,
} from "./relation-fixture-support.ts";

function compileCase(
  item: ReturnType<typeof readRelationFixture>["cases"][number],
  catalog: ReturnType<typeof relationFixtureCatalog>
) {
  const relationWhere: Record<string, unknown> = { some: {} };
  if (item.request.via) {
    relationWhere.via = item.request.via;
  }
  const ast = normalizeFindManyInput({
    select: { id: true },
    table: item.request.source.schema
      ? `${item.request.source.schema}.${item.request.source.table}`
      : item.request.source.table,
    where: {
      [item.request.relation]: relationWhere,
    },
  });
  const plan = resolveQueryPlan(ast, { catalog });
  return {
    d1: compileD1Ast(plan),
    plan,
    postgres: compilePostgresAst(plan),
  };
}

test("neutral relation fixtures compile through D1 and PostgreSQL plans", () => {
  for (const name of [
    "simple.json",
    "many-to-many.json",
    "composite.json",
  ]) {
    const fixture = readRelationFixture(name);
    const catalog = relationFixtureCatalog(fixture);
    const validCatalog = {
      entries: catalog.entries.filter((entry) => entry.name !== "invalid"),
    };

    for (const item of fixture.cases) {
      if (item.expected.outcome === "error") {
        continue;
      }
      const compiled = compileCase(item, validCatalog);
      assert.match(compiled.d1.sql, /SELECT/, `${name}:${item.name}`);
      assert.match(compiled.postgres.text, /SELECT/, `${name}:${item.name}`);
      assert.ok(
        compiled.plan.filter?.kind === "resolved-relation",
        item.name
      );
      if (compiled.plan.filter?.kind === "resolved-relation") {
        assert.equal(
          compiled.plan.filter.descriptor.cardinality,
          item.expected.cardinality,
          item.name
        );
        assert.deepEqual(
          compiled.plan.filter.descriptor.from.columns,
          item.expected.fromColumns,
          item.name
        );
        assert.deepEqual(
          compiled.plan.filter.descriptor.to.columns,
          item.expected.toColumns,
          item.name
        );
      }
    }
  }
});

test("inner compatibility selectors filter parent rows on D1 and PostgreSQL", () => {
  const ast = normalizeTransportPayload({
    select: "users!inner(id)",
    table_name: "posts",
  });
  const catalog = relationFixtureCatalog(readRelationFixture("simple.json"));
  const plan = resolveQueryPlan(ast, { catalog });
  const d1 = compileD1Ast(plan);
  const postgres = compilePostgresAst(plan);

  assert.match(d1.sql, /EXISTS/);
  assert.match(postgres.text, /EXISTS/);
  assert.doesNotMatch(d1.sql, /UNKNOWN_RELATION/);
  assert.doesNotMatch(postgres.text, /UNKNOWN_RELATION/);
});

test("recursive inner compatibility selectors filter ancestors on both backends", () => {
  const ast = normalizeTransportPayload({
    select: "posts!inner(comments!inner(id))",
    table_name: "users",
  });
  const catalog = {
    entries: [
      {
        cardinality: "one-to-many" as const,
        from: { columns: ["id"], table: "users" },
        id: "users.posts",
        name: "posts",
        to: { columns: ["user_id"], table: "posts" },
      },
      {
        cardinality: "one-to-many" as const,
        from: { columns: ["id"], table: "posts" },
        id: "posts.comments",
        name: "comments",
        to: { columns: ["post_id"], table: "comments" },
      },
    ],
  };
  const plan = resolveQueryPlan(ast, { catalog });
  const d1 = compileD1Ast(plan);
  const postgres = compilePostgresAst(plan);

  for (const sql of [d1.sql, postgres.text]) {
    const outerExists = sql.indexOf('EXISTS (SELECT 1 FROM "posts"');
    assert.notEqual(outerExists, -1);
    assert.match(
      sql.slice(outerExists),
      /WHERE .*EXISTS \(SELECT 1 FROM "comments"/
    );
  }
});

test("neutral many-to-many fixtures preserve both traversal orientations", () => {
  const fixture = readRelationFixture("many-to-many.json");
  const catalog = relationFixtureCatalog(fixture);

  for (const item of fixture.cases) {
    const compiled = compileCase(item, catalog);
    const condition = compiled.plan.filter;

    assert.ok(condition?.kind === "resolved-relation");
    if (condition?.kind !== "resolved-relation") {
      continue;
    }
    assert.equal(condition.descriptor.cardinality, "many-to-many");
    assert.equal(item.expected.outcome, "resolved");
    if (item.expected.outcome === "resolved") {
      assert.deepEqual(
        condition.descriptor.junction?.fromColumns,
        item.expected.junction?.fromColumns,
        item.name
      );
      assert.deepEqual(
        condition.descriptor.junction?.toColumns,
        item.expected.junction?.toColumns,
        item.name
      );
    }
    assert.match(compiled.d1.sql, /user_roles/);
    assert.match(compiled.postgres.text, /user_roles/);
  }
});
