import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  serializeGatewayAst,
  serializeGatewayPlan,
} from "../src/gateway/serialize-ast.ts";
import {
  AthenaQueryError,
  normalizeFindManyInput,
  resolveQueryPlan,
  type AthenaRelationCatalog,
} from "../src/query/engine/index.ts";

test("serializeGatewayAst projects semantic AST onto the existing fetch wire", () => {
  const ast = normalizeFindManyInput({
    select: {
      name: true,
      instruments: { select: { name: true } },
    },
    table: "orchestral_sections",
    where: { name: { eq: "Brass" } },
    limit: 3,
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
