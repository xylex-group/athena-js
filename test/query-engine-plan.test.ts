import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  AthenaQueryError,
  type AthenaRelationCatalog,
  catalogFromModelRelations,
  catalogFromModels,
  mergeRelationCatalogs,
  normalizeFindManyInput,
  resetQueryPlanAliases,
  resolveRelation,
  resolveQueryPlan,
  validateQueryComplexity,
} from "../src/query/engine/index.ts";

const catalog: AthenaRelationCatalog = {
  entries: [
    {
      cardinality: "many-to-one",
      constraint:
        "constraint:v1/model/public/instruments/instruments_section_id_fkey",
      from: {
        columns: ["section_id"],
        schema: "public",
        table: "instruments",
      },
      id: "relation:v1/model/public/instruments/orchestral_sections",
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
      instruments: { select: { name: true } },
      name: true,
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
      instruments: { select: { name: true } },
      name: true,
    },
    table: "orchestral_sections",
  });

  assert.throws(
    () => resolveQueryPlan(ast),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_UNKNOWN_RELATION"
  );
});

test("model relation catalogs use canonical relation and constraint identities", () => {
  const modelCatalog = catalogFromModels({
    models: {
      orders: {
        tableName: "public.orders",
        meta: {
          primaryKey: ["id"],
          relations: {
            customer: {
              constraintName: "orders_customer_id_fkey",
              kind: "many-to-one",
              sourceColumns: ["customer_id"],
              targetColumns: ["id"],
              targetModel: "customers",
              targetSchema: "public",
            },
          },
        },
      },
    },
  });
  assert.equal(
    modelCatalog.entries[0]?.id,
    "relation:v1/model/public/orders/customer"
  );
  assert.equal(
    modelCatalog.entries[0]?.constraint,
    "constraint:v1/model/public/orders/orders_customer_id_fkey"
  );
});

test("relation catalog rejects zero-width and conflicting identities", () => {
  assert.throws(
    () =>
      catalogFromModelRelations({
        table: "orders",
        relations: {
          customer: {
            kind: "many-to-one",
            sourceColumns: [],
            targetColumns: [],
            targetModel: "customers",
            targetSchema: "public",
          },
        },
      }),
    AthenaQueryError
  );
  const entry = catalog.entries[0];
  assert.ok(entry);
  assert.throws(
    () =>
      mergeRelationCatalogs(
        { entries: [entry] },
        {
          entries: [
            {
              ...entry,
              from: { ...entry.from, columns: ["other_customer_id"] },
            },
          ],
        }
      ),
    AthenaQueryError
  );
});

test("relation resolution accepts exact canonical identity selectors", () => {
  const entry = catalog.entries[0];
  assert.ok(entry);
  const resolved = resolveRelation({
    catalog,
    constraintId: "constraint:v1/model/public/instruments/instruments_section_id_fkey",
    name: "legacy-name",
    relationId: "relation:v1/model/public/instruments/orchestral_sections",
    source: { schema: "public", table: "instruments" },
    targetHint: { schema: "public", table: "orchestral_sections" },
  });
  assert.equal(resolved.id, entry.id);
});

test("resolveQueryPlan fails closed when two FKs target the same table", () => {
  resetQueryPlanAliases();
  const ast = normalizeFindManyInput({
    select: {
      instruments: { select: { name: true } },
      name: true,
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
      error.code === "ATHENA_QUERY_AMBIGUOUS_RELATION"
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
      error.code === "ATHENA_QUERY_INVALID_NESTING"
  );
});
