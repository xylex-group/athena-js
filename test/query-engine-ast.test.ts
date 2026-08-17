import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeFindManyInput,
  normalizeTransportPayload,
  parseSourceName,
  selectPayloadHasRelations,
} from "../src/query/engine/index.ts";

test("normalizeFindManyInput builds a semantic select AST", () => {
  const ast = normalizeFindManyInput({
    select: {
      name: true,
      instruments: {
        select: { name: true },
      },
    },
    table: "orchestral_sections",
    where: { name: { eq: "Brass" } },
    limit: 10,
  });

  assert.equal(ast.kind, "select");
  assert.equal(ast.cardinality, "many");
  assert.equal(ast.source.table, "orchestral_sections");
  assert.deepEqual(
    ast.selection.fields.map((field) => field.kind),
    ["column", "relation"]
  );
  const relation = ast.selection.fields[1];
  assert.equal(relation?.kind, "relation");
  if (relation?.kind === "relation") {
    assert.equal(relation.relation, "instruments");
    assert.equal(relation.query.source.table, "instruments");
  }
  assert.equal(ast.filter?.kind, "compare");
  assert.equal(ast.pagination?.limit, 10);
});

test("normalizeFindManyInput lifts nested relation where/order/limit", () => {
  const ast = normalizeFindManyInput({
    select: {
      name: true,
      instruments: {
        limit: 3,
        offset: 1,
        orderBy: { name: "desc" },
        select: { name: true },
        where: { name: { eq: "Tuba" } },
      },
    },
    table: "orchestral_sections",
  });
  const relation = ast.selection.fields[1];
  assert.equal(relation?.kind, "relation");
  if (relation?.kind !== "relation") {
    return;
  }
  assert.equal(relation.query.filter?.kind, "compare");
  assert.equal(relation.query.orderBy?.[0]?.direction, "desc");
  assert.equal(relation.query.pagination?.limit, 3);
  assert.equal(relation.query.pagination?.offset, 1);
});

test("parseSourceName normalizes schema-qualified tables once", () => {
  assert.deepEqual(parseSourceName("public.users"), {
    kind: "table",
    schema: "public",
    table: "users",
  });
  assert.throws(() => parseSourceName("a.b.c"), /too deeply qualified/);
  assert.throws(() => parseSourceName("users;drop"), /Invalid table identifier/);
});

test("normalizeTransportPayload lifts relation select strings", () => {
  const ast = normalizeTransportPayload({
    columns: "name,instruments(name)",
    table_name: "orchestral_sections",
  });
  assert.equal(ast.selection.fields[0]?.kind, "column");
  assert.equal(ast.selection.fields[1]?.kind, "relation");
});

test("selectPayloadHasRelations detects nested findMany trees", () => {
  assert.equal(
    selectPayloadHasRelations({
      select: { name: true, instruments: { select: { name: true } } },
      table_name: "orchestral_sections",
    }),
    true
  );
  assert.equal(
    selectPayloadHasRelations({
      select: { name: true },
      table_name: "orchestral_sections",
    }),
    false
  );
  assert.equal(
    selectPayloadHasRelations({
      select: { name: true },
      table_name: "orchestral_sections",
      where: { instruments: { some: { name: { eq: "Tuba" } } } },
    }),
    true
  );
});
