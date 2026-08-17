import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "../../../src/index.ts";
import {
  compilePostgresFetch,
  compilePostgresRpc,
} from "../../../src/postgres/sql.ts";
import {
  compilePostgresStructuredFetch,
  needsPostgresAstPipeline,
} from "../../../src/postgres/compile-fetch.ts";
import { runDatabaseConformance } from "./contract.ts";

const SAMPLE_PG = "postgresql://postgres@127.0.0.1:5432/athena_direct_test";

const client = createClient({
  db: { pgUri: SAMPLE_PG },
  env: {},
});

test("postgres-direct advertised layers match the runtime contract", () => {
  assert.deepEqual(client.capabilities.db.layers, {
    findManyAst: true,
    flatCrud: true,
    query: true,
    relations: true,
    rpc: true,
  });
  assert.equal(client.capabilities.db.engine, "postgresql");
  assert.equal(client.capabilities.db.local, true);
});

test("postgres-direct nested select requires the AST pipeline", () => {
  assert.equal(
    needsPostgresAstPipeline({
      operation: "select",
      select: { id: true, posts: { select: { id: true } } },
      table_name: "users",
    }),
    true
  );
});

runDatabaseConformance({
  capabilities: client.capabilities,
  compileFetch: compilePostgresFetch,
  compileRpc: compilePostgresRpc,
  fetchNested: async () => {
    const queryable = {
      async query() {
        return {
          rows: [
            {
              constraint_name: "posts_user_id_fkey",
              from_column: "user_id",
              from_schema: "public",
              from_table: "posts",
              position: 1,
              to_column: "id",
              to_schema: "public",
              to_table: "users",
            },
          ],
        };
      },
    };
    const compiled = await compilePostgresStructuredFetch(
      {
        operation: "select",
        select: { id: true, posts: { select: { id: true } } },
        table_name: "users",
      },
      queryable as never
    );
    return {
      message: compiled.text,
      ok: /json_agg/i.test(compiled.text),
    };
  },
  name: "postgres-direct",
});

test("ACT-CAP-01: postgres-direct createClient does not HTTP to Gateway", async () => {
  const original = globalThis.fetch;
  let httpCalls = 0;
  globalThis.fetch = async () => {
    httpCalls += 1;
    return new Response("[]", { status: 200 });
  };
  try {
    const isolated = createClient({
      db: { pgUri: SAMPLE_PG },
      env: {},
    });
    assert.equal(isolated.capabilities.db.layers.rpc, true);
    assert.equal(httpCalls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
