import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  ATHENA_FILTER_OPERATORS,
  compileSelectShape,
  selectShapeUsesRelationSchema,
} from "../src/query-ast.ts";

test("compileSelectShape supports explicit schema targeting on relation nodes", () => {
  assert.equal(
    compileSelectShape({
      user: {
        schema: "athena",
        select: {
          id: true,
        },
      },
      user_id: true,
    }),
    "user_id,user:athena.user(id)"
  );
});

test("compileSelectShape rejects relation nodes that combine schema and via", () => {
  assert.throws(
    () =>
      compileSelectShape({
        user: {
          schema: "athena",
          select: {
            id: true,
          },
          via: "user_id",
        },
      }),
    /cannot combine schema and via yet/
  );
});

test("compileSelectShape rejects schema targeting when the relation key is already qualified", () => {
  assert.throws(
    () =>
      compileSelectShape({
        "athena.user": {
          schema: "athena",
          select: {
            id: true,
          },
        },
      }),
    /already resolves to a qualified relation token/
  );
});

test("ATHENA_FILTER_OPERATORS is the findMany AST allowlist without fluent extras", () => {
  assert.deepEqual(
    [...ATHENA_FILTER_OPERATORS],
    [
      "eq",
      "neq",
      "gt",
      "gte",
      "lt",
      "lte",
      "like",
      "ilike",
      "is",
      "in",
      "contains",
      "containedBy",
    ]
  );
  assert.equal(
    ATHENA_FILTER_OPERATORS.includes("match" as never),
    false,
    "original found case: .match is fluent-only, not an AST operator"
  );
});

test("selectShapeUsesRelationSchema detects nested schema-targeted relations", () => {
  assert.equal(
    selectShapeUsesRelationSchema({
      case: {
        select: {
          user: {
            schema: "athena",
            select: {
              id: true,
            },
          },
        },
      },
    }),
    true
  );
  assert.equal(
    selectShapeUsesRelationSchema({
      case: {
        select: {
          id: true,
        },
      },
    }),
    false
  );
});
