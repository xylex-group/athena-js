import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  AthenaQueryError,
  normalizeFindManyInput,
  resolveQueryPlan,
} from "../src/query/engine/index.ts";
import {
  readRelationFixture,
  relationFixtureCatalog,
} from "./relation-fixture-support.ts";

test("neutral relation fixtures cover the Lane 1 relation families", () => {
  const simple = readRelationFixture("simple.json");
  assert.equal(simple.schema, "athena/relations-fixture/v1");
  assert.ok(simple.cases.length >= 3);
  assert.ok(simple.relations.some((relation) => relation.cardinality === "one-to-many"));
  assert.ok(simple.relations.some((relation) => relation.cardinality === "one-to-one"));

  const manyToMany = readRelationFixture("many-to-many.json");
  assert.equal(manyToMany.relations.length, 1);
  const roles = manyToMany.relations.find((relation) => relation.name === "roles");
  assert.ok(roles?.through);
  assert.deepEqual(roles?.through, {
    fromColumns: ["user_id"],
    table: "user_roles",
    toColumns: ["role_id"],
  });

  const composite = readRelationFixture("composite.json");
  const membership = composite.relations.find((relation) => relation.name === "members");
  assert.deepEqual(membership?.through?.fromColumns, ["organization_id"]);
  assert.deepEqual(membership?.through?.toColumns, ["tenant_id", "member_id"]);
  assert.equal(composite.cases.some((item) => item.expected.outcome === "error"), true);

  const schemas = readRelationFixture("schemas.json");
  assert.equal(schemas.tables.filter((table) => table.table === "posts").length, 2);
  assert.ok(schemas.cases.some((item) => item.expected.outcome === "error"));
});

test("neutral relation fixtures keep alternate foreign keys distinguishable", () => {
  const ambiguous = readRelationFixture("ambiguous.json");
  const userRelations = ambiguous.relations.filter(
    (relation) =>
      relation.from.table === "posts" && relation.to.table === "users"
  );
  assert.equal(userRelations.length, 2);
  assert.deepEqual(
    userRelations.map((relation) => relation.id).sort(),
    ["public.posts.posts_author_id_fkey", "public.posts.posts_editor_id_fkey"]
  );
  assert.ok(
    ambiguous.cases.some(
      (item) =>
        item.expected.outcome === "error" &&
        item.expected.code === "ATHENA_QUERY_AMBIGUOUS_RELATION"
    )
  );
  assert.ok(
    ambiguous.cases.some(
      (item) =>
        item.request.via === "posts_editor_id_fkey" &&
        item.expected.outcome === "resolved"
    )
  );
});

test("semantic relation vectors independently verify direction and failures", () => {
  for (const name of [
    "simple.json",
    "many-to-many.json",
    "composite.json",
    "schemas.json",
    "ambiguous.json",
    "invalid.json",
  ]) {
    const fixture = readRelationFixture(name);
    const catalog = relationFixtureCatalog(fixture);

    for (const item of fixture.cases) {
      const caseCatalog =
        item.expected.outcome === "error"
          ? catalog
          : {
              entries: catalog.entries.filter(
                (entry) => entry.name !== "invalid"
              ),
            };
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

      if (item.expected.outcome === "error") {
        assert.throws(
          () => resolveQueryPlan(ast, { catalog }),
          (error: unknown) =>
            error instanceof AthenaQueryError &&
            error.code === item.expected.code,
          `${name}:${item.name}`
        );
        continue;
      }

      const plan = resolveQueryPlan(ast, { catalog: caseCatalog });
      assert.ok(
        plan.filter?.kind === "resolved-relation",
        `${name}:${item.name}`
      );
      if (plan.filter?.kind !== "resolved-relation") {
        continue;
      }
      const descriptor = plan.filter.descriptor;
      assert.equal(
        descriptor.cardinality,
        item.expected.cardinality,
        `${name}:${item.name}`
      );
      const canonical = fixture.relations.find(
        (relation) => relation.id === descriptor.id
      );
      assert.ok(canonical, `${name}:${item.name}`);
      assert.equal(
        canonical.from.table === item.request.source.table
          ? "forward"
          : "reverse",
        item.expected.direction,
        `${name}:${item.name}`
      );
      assert.deepEqual(
        descriptor.from.columns,
        item.expected.fromColumns,
        `${name}:${item.name}`
      );
      assert.deepEqual(
        descriptor.to.columns,
        item.expected.toColumns,
        `${name}:${item.name}`
      );
      assert.deepEqual(
        descriptor.junction &&
          {
            fromColumns: descriptor.junction.fromColumns,
            toColumns: descriptor.junction.toColumns,
          },
        item.expected.junction,
        `${name}:${item.name}`
      );
    }
  }
});
