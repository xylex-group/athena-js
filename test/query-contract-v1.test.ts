import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  serializeQueryRequestV1,
} from "../src/query/contract-v1.ts";
import {
  projectSqliteOperationToQueryV1,
} from "../src/sqlite-local/compatibility.ts";
import {
  AthenaQueryError,
  normalizeFindFirstInput,
  normalizeFindManyInput,
  normalizeFindUniqueInput,
  normalizeTransportPayload,
} from "../src/query/engine/index.ts";

const semanticFixtures = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "contracts",
      "query-v1",
      "semantic-fixtures.json"
    ),
    "utf8"
  )
) as Array<{
  name: string;
  request: {
    version: number;
    operation: { kind: string };
  };
  expected_result_shape: string;
  expected_parameter_count: number;
}>;

test("shares the canonical Query V1 oracle fixture with Rust consumers", () => {
  assert.equal(semanticFixtures.length, 4);
  assert.deepEqual(
    semanticFixtures.map((fixture) => fixture.request.operation.kind),
    ["select", "insert", "update", "delete"]
  );
  for (const fixture of semanticFixtures) {
    assert.equal(fixture.request.version, 1, fixture.name);
  }
});

test("keeps shared Query V1 fixtures as intent until a canonical compiler bridge exists", () => {
  for (const fixture of semanticFixtures) {
    assert.equal(fixture.request.version, 1, fixture.name);
    assert.equal(fixture.request.operation.kind.length > 0, true, fixture.name);
  }
});

test("preserves shared Query V1 decimal strings without a JavaScript Number round-trip", () => {
  const fixture = semanticFixtures.find(
    ({ name }) => name === "insert-default-and-decimal",
  );
  assert.ok(fixture);
  assert.deepEqual(
    (fixture.request.operation as unknown as {
      rows: Array<Array<{ value?: { number?: string } }>>;
    }).rows[0][0],
    { value: { number: "12.3400" } },
  );
});

test("projects SQLite CRUD intent through the shared Query V1 contract", () => {
  const request = projectSqliteOperationToQueryV1({
    kind: "delete",
    payload: {
      resource_id: "u-1",
      table_name: "users",
    },
  });

  assert.deepEqual(request.operation, {
    kind: "delete",
    predicate: {
      kind: "comparison",
      column: "id",
      operator: "eq",
      right: { value: { text: "u-1" } },
    },
    returning: "none",
    safety: "require_filter",
    table: { name: "users", schema: null },
  });
});

test("serializes a semantic select AST as intent-only Query V1", () => {
  const ast = normalizeFindManyInput({
    limit: 25,
    offset: 10,
    orderBy: { created_at: "desc" },
    select: { id: true, email: true },
    table: "users",
    where: {
      active: { eq: true },
      age: { gte: 18 },
      id: { in: ["user-1", "user-2"] },
    },
  });

  assert.deepEqual(serializeQueryRequestV1(ast), {
    operation: {
      kind: "select",
      from: { name: "users", schema: null },
      order_by: [
        { column: "created_at", direction: "desc", nulls: null },
      ],
      pagination: { limit: 25, offset: 10 },
      predicate: {
        kind: "and",
        conditions: [
          {
            kind: "comparison",
            column: "active",
            operator: "eq",
            right: { value: { bool: true } },
          },
          {
            kind: "comparison",
            column: "age",
            operator: "gte",
            right: { value: { integer: 18 } },
          },
          {
            kind: "comparison",
            column: "id",
            operator: "in",
            right: {
              values: [
                { text: "user-1" },
                { text: "user-2" },
              ],
            },
          },
        ],
      },
      selection: { columns: ["id", "email"] },
      for_update: false,
    },
    version: 1,
  });
});

test("serializes wildcard transport selections as Query V1 select-all", () => {
  const ast = normalizeTransportPayload({
    table_name: "users",
  });

  assert.equal(serializeQueryRequestV1(ast).operation.selection, "all");
});

test("preserves single-result cardinality with the established limit", () => {
  const first = normalizeFindFirstInput({
    select: { id: true },
    table: "users",
  });
  const unique = normalizeFindUniqueInput({
    select: { id: true },
    table: "users",
  });

  assert.equal(
    serializeQueryRequestV1(first).operation.pagination.limit,
    1
  );
  assert.equal(
    serializeQueryRequestV1(unique).operation.pagination.limit,
    1
  );
});

test("rejects relation selections instead of silently projecting them", () => {
  const ast = normalizeFindManyInput({
    select: { posts: { select: { id: true } } },
    table: "users",
  });

  assert.throws(
    () => serializeQueryRequestV1(ast),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_UNSUPPORTED_CAPABILITY"
  );
});

test("rejects aliased fields instead of changing response keys", () => {
  const ast = normalizeTransportPayload({
    columns: "display:id",
    table_name: "events",
  });

  assert.throws(
    () => serializeQueryRequestV1(ast),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_UNSUPPORTED_CAPABILITY"
  );
});

test("preserves binary and decimal-like values without lossy conversion", () => {
  const ast = normalizeFindManyInput({
    select: { id: true },
    table: "events",
    where: {
      payload: { eq: new Uint8Array([1, 2, 255]) },
      ratio: { eq: "12.3400" },
    },
  });

  const request = serializeQueryRequestV1(ast);
  assert.deepEqual(request.operation.predicate, {
    kind: "and",
    conditions: [
      {
        kind: "comparison",
        column: "payload",
        operator: "eq",
        right: {
          value: { bytes: [1, 2, 255] },
        },
      },
      {
        kind: "comparison",
        column: "ratio",
        operator: "eq",
        right: {
          value: { text: "12.3400" },
        },
      },
    ],
  });
});

test("preserves fractional JavaScript numbers as float intent", () => {
  const ast = normalizeFindManyInput({
    select: { id: true },
    table: "events",
    where: {
      ratio: { eq: 1.5 },
    },
  });

  assert.deepEqual(serializeQueryRequestV1(ast).operation.predicate, {
    kind: "comparison",
    column: "ratio",
    operator: "eq",
    right: { value: { float: "1.5" } },
  });
});

test("preserves null, boolean, logical, containment, JSON, and page intent", () => {
  const ast = normalizeFindManyInput({
    currentPage: 3,
    pageSize: 20,
    select: { id: true },
    table: "documents",
    where: {
      metadata: { contains: { state: "ready" } },
      deletedAt: null,
      or: [{ published: true }, { not: { archived: false } }],
    },
  });

  assert.deepEqual(serializeQueryRequestV1(ast).operation, {
    kind: "select",
    from: { name: "documents", schema: null },
    selection: { columns: ["id"] },
    predicate: {
      kind: "and",
      conditions: [
        {
          kind: "comparison",
          column: "metadata",
          operator: "contains",
          right: { value: { json: { state: "ready" } } },
        },
        {
          kind: "comparison",
          column: "deletedAt",
          operator: "is_null",
          right: { none: null },
        },
        {
          kind: "or",
          conditions: [
            {
              kind: "comparison",
              column: "published",
              operator: "eq",
              right: { value: { bool: true } },
            },
            {
              kind: "not",
              condition: {
                kind: "comparison",
                column: "archived",
                operator: "eq",
                right: { value: { bool: false } },
              },
            },
          ],
        },
      ],
    },
    order_by: [],
    pagination: { limit: 20, offset: 40 },
    for_update: false,
  });
});

test("rejects non-finite values and qualified fields", () => {
  const nonFinite = normalizeFindManyInput({
    select: { id: true },
    table: "events",
    where: { score: { eq: Number.NaN } },
  });
  assert.throws(
    () => serializeQueryRequestV1(nonFinite),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_UNSUPPORTED_CAPABILITY"
  );

  const qualified = normalizeFindManyInput({
    select: { id: true },
    table: "events",
    where: { score: { eq: 1 } },
  });
  qualified.source.alias = "events";
  qualified.filter = {
    field: { field: "score", source: "events" },
    kind: "compare",
    operator: "eq",
    value: 1,
  };
  assert.throws(
    () => serializeQueryRequestV1(qualified),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_UNSUPPORTED_CAPABILITY"
  );
});

test("rejects pagination values that cannot be represented by Query V1", () => {
  const ast = normalizeFindManyInput({
    limit: 1.5,
    select: { id: true },
    table: "events",
  });

  assert.throws(
    () => serializeQueryRequestV1(ast),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_UNSUPPORTED_CAPABILITY"
  );
});
