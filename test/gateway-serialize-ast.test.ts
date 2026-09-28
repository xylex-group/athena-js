import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  serializeGatewayAst,
  serializeGatewayPlan,
} from "../src/gateway/serialize-ast.ts";
import {
  AthenaQueryError,
  type AthenaRelationCatalog,
  normalizeFindManyInput,
  parseSelectList,
  resolveQueryPlan,
} from "../src/query/engine/index.ts";

test("serializeGatewayAst projects semantic AST onto the existing fetch wire", () => {
  const ast = normalizeFindManyInput({
    limit: 3,
    select: {
      instruments: { select: { name: true } },
      name: true,
    },
    table: "orchestral_sections",
    where: { name: { eq: "Brass" } },
  });
  const payload = serializeGatewayAst(ast);
  assert.equal(payload.table_name, "orchestral_sections");
  assert.equal(payload.select, "name,instruments(name)");
  assert.equal(payload.limit, 3);
  assert.deepEqual(payload.where, { name: { eq: "Brass" } });
});

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
        table: "user_roles",
        toColumns: ["role_id"],
      },
      name: "roles",
      to: { columns: ["id"], table: "roles" },
    },
  ],
};

test("Gateway fails closed on relational predicates", () => {
  const plan = resolveQueryPlan(
    normalizeFindManyInput({
      select: { id: true },
      table: "users",
      where: { posts: { some: { published: true } } },
    }),
    { catalog }
  );
  assert.throws(
    () => serializeGatewayPlan(plan),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_UNSUPPORTED_CAPABILITY"
  );
});

test("Gateway fails closed on many-to-many selection", () => {
  const plan = resolveQueryPlan(
    normalizeFindManyInput({
      select: { roles: { select: { name: true } } },
      table: "users",
    }),
    { catalog }
  );
  assert.throws(
    () => serializeGatewayPlan(plan),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_UNSUPPORTED_CAPABILITY"
  );
});

test("Gateway merges distinct operators for one predicate key", () => {
  const ast = normalizeFindManyInput({
    select: { id: true },
    table: "users",
    where: {
      age: { gt: 18, lt: 65 },
    },
  });
  assert.deepEqual(serializeGatewayAst(ast).where, {
    age: { gt: 18, lt: 65 },
  });
});

test("Gateway fails closed when one predicate operator would be overwritten", () => {
  const ast = normalizeFindManyInput({
    select: { id: true },
    table: "users",
    where: { id: { eq: "user-1" } },
  });
  ast.filter = {
    kind: "and",
    conditions: [
      {
        kind: "compare",
        field: { field: "id" },
        operator: "eq",
        value: "user-1",
      },
      {
        kind: "compare",
        field: { field: "id" },
        operator: "eq",
        value: "user-2",
      },
    ],
  };
  assert.throws(
    () => serializeGatewayAst(ast),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_UNSUPPORTED_CAPABILITY"
  );
});

test("Gateway preserves a computed __proto__ predicate key", () => {
  const predicateKey = "__proto__";
  const ast = normalizeFindManyInput({
    select: { id: true },
    table: "users",
    where: {
      [predicateKey]: { eq: "preserve-me" },
      name: { eq: "Users" },
    },
  });

  const where = serializeGatewayAst(ast).where as Record<string, unknown>;
  assert.equal(Object.hasOwn(where, predicateKey), true);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(where, predicateKey)?.value,
    { eq: "preserve-me" }
  );
});

test("Gateway preserves semantic relation constraint selectors", () => {
  const ast = {
    cardinality: "many" as const,
    kind: "select" as const,
    selection: {
      fields: parseSelectList("users!posts_author_id_fkey(id)", {
        kind: "table",
        table: "posts",
      }),
    },
    source: { kind: "table" as const, table: "posts" },
  };

  assert.equal(serializeGatewayAst(ast).select, "users!posts_author_id_fkey(id)");
});

test("Gateway preserves the reserved inner relation modifier", () => {
  const ast = {
    cardinality: "many" as const,
    kind: "select" as const,
    selection: {
      fields: parseSelectList("users!inner(id)", {
        kind: "table",
        table: "posts",
      }),
    },
    source: { kind: "table" as const, table: "posts" },
  };

  assert.equal(serializeGatewayAst(ast).select, "users!inner(id)");
});

test("Gateway preserves object-form via selectors and rejects via-inner loss", () => {
  const selectorAst = normalizeFindManyInput({
    select: {
      users: {
        select: { id: true },
        constraint: "posts_author_id_fkey",
      },
    },
    table: "posts",
  });
  assert.equal(
    serializeGatewayAst(selectorAst).select,
    "users!posts_author_id_fkey(id)"
  );

  const innerAst = normalizeFindManyInput({
    select: {
      users: {
        join: "inner",
        select: { id: true },
        constraint: "posts_author_id_fkey",
      },
    },
    table: "posts",
  });
  assert.throws(
    () => serializeGatewayAst(innerAst),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_UNSUPPORTED_CAPABILITY"
  );
});

test("Gateway preserves legacy object-form via embed selectors", () => {
  const ast = normalizeFindManyInput({
    select: {
      sender: {
        as: "from",
        select: { name: true },
        via: "sender_id",
      },
    },
    table: "messages",
  });

  assert.equal(serializeGatewayAst(ast).select, "from:sender_id(name)");
});

test("Gateway preserves legacy via embeds without an explicit alias", () => {
  const ast = normalizeFindManyInput({
    select: {
      sender: {
        select: { id: true },
        via: "sender_id",
      },
    },
    table: "messages",
  });

  assert.equal(serializeGatewayAst(ast).select, "sender:sender_id(id)");
});

test("Gateway renders an explicit relation constraint selector", () => {
  const ast = normalizeFindManyInput({
    select: {
      users: {
        constraint: "posts_author_id_fkey",
        select: { id: true },
      },
    },
    table: "posts",
  });

  assert.equal(
    serializeGatewayAst(ast).select,
    "users!posts_author_id_fkey(id)"
  );
});

test("Gateway rejects duplicate operators with object operands", () => {
  const ast = normalizeFindManyInput({
    select: { id: true },
    table: "users",
    where: { settings: { eq: { a: 1 } } },
  });
  ast.filter = {
    kind: "and",
    conditions: [
      {
        kind: "compare",
        field: { field: "settings" },
        operator: "eq",
        value: { a: 1 },
      },
      {
        kind: "compare",
        field: { field: "settings" },
        operator: "eq",
        value: { b: 2 },
      },
    ],
  };

  assert.throws(
    () => serializeGatewayAst(ast),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_UNSUPPORTED_CAPABILITY"
  );
});
