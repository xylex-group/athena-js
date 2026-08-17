import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { compileD1Ast } from "../../../src/cloudflare/d1/compile-ast.ts";
import { createCloudflareD1GatewayTransport } from "../../../src/cloudflare/index.ts";
import { createClient } from "../../../src/index.ts";
import {
  normalizeFindManyInput,
  resolveQueryPlan,
  type AthenaRelationCatalog,
} from "../../../src/query/engine/index.ts";
import { createMockD1 } from "../../helpers/d1-r2-mocks.ts";
import { runDatabaseConformance } from "./contract.ts";

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

function compileRelationSql() {
  const ast = normalizeFindManyInput({
    select: {
      id: true,
      posts: { select: { id: true } },
      roles: { limit: 5, select: { name: true } },
    },
    table: "users",
    where: { posts: { some: { published: true } } },
  });
  return compileD1Ast(resolveQueryPlan(ast, { catalog }));
}

const inserts: Array<{ params: unknown[]; sql: string }> = [];
const d1 = createMockD1({
  inserts,
  rowsBySql: new Map([["SELECT 1 AS ok", [{ ok: 1 }]]]),
});
const client = createClient({
  db: { d1 },
  env: {},
});

test("d1 advertised layers match proven D1 semantics", () => {
  assert.deepEqual(client.capabilities.db.layers, {
    findManyAst: true,
    flatCrud: true,
    query: true,
    relations: true,
    rpc: false,
  });
  assert.equal(client.capabilities.db.engine, "cloudflare-d1");
  assert.equal(client.capabilities.db.local, true);
});

runDatabaseConformance({
  capabilities: client.capabilities,
  client,
  compileRelation: () => {
    const compiled = compileRelationSql();
    return { text: compiled.sql, values: compiled.params };
  },
  fetchNested: async () => {
    const transport = createCloudflareD1GatewayTransport({
      d1: createMockD1({}),
      relationCatalog: catalog,
    });
    const response = await transport.fetchGateway({
      select: {
        id: true,
        posts: { select: { id: true } },
      },
      table_name: "users",
    });
    return {
      message: response.error?.message ?? "",
      ok: response.ok,
    };
  },
  name: "d1",
});

test("d1 relation compile covers some / nested / m2m", () => {
  const compiled = compileRelationSql();
  assert.match(compiled.sql, /EXISTS \(/);
  assert.match(compiled.sql, /json_group_array/);
  assert.match(compiled.sql, /JOIN "user_roles" AS "/);
  assert.equal(compiled.sql.includes("$1"), false);
});

test("ACT-CAP-02: d1 createClient does not HTTP to Gateway", async () => {
  const original = globalThis.fetch;
  let httpCalls = 0;
  globalThis.fetch = async () => {
    httpCalls += 1;
    return new Response("[]", { status: 200 });
  };
  try {
    const isolated = createClient({
      db: { d1: createMockD1({}) },
      env: {},
    });
    assert.equal(isolated.capabilities.db.layers.rpc, false);
    assert.equal(httpCalls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
