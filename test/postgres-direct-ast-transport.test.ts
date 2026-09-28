import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "../src/index.ts";
import {
  compilePostgresStructuredFetch,
  needsPostgresAstPipeline,
} from "../src/postgres/compile-fetch.ts";
import type {
  AthenaPostgresClient,
  AthenaPostgresPool,
} from "../src/postgres/driver.ts";
import { createPostgresDirectTransport } from "../src/postgres/transport.ts";

const SAMPLE_PG = "postgresql://postgres@127.0.0.1:5432/athena_direct_test";

test("pgUri client advertises findMany AST and relations", () => {
  const client = createClient({
    db: { pgUri: SAMPLE_PG },
    env: {},
  });
  assert.equal(client.capabilities?.db.layers.findManyAst, true);
  assert.equal(client.capabilities?.db.layers.relations, true);
  assert.equal(client.capabilities?.db.layers.rpc, true);
});

test("needsPostgresAstPipeline accepts operation envelopes and nested select", () => {
  assert.equal(
    needsPostgresAstPipeline({
      operation: "select",
      select: { instruments: { select: { name: true } }, name: true },
      table_name: "orchestral_sections",
    }),
    true
  );
  assert.equal(
    needsPostgresAstPipeline({
      columns: ["name"],
      table_name: "orchestral_sections",
    }),
    false
  );
});

test("P0: relation some() filters parents without Gateway", () => {
  assert.equal(
    needsPostgresAstPipeline({
      select: { name: true },
      table_name: "orchestral_sections",
      where: { instruments: { some: { name: { eq: "Tuba" } } } },
    }),
    true
  );
});

test("structured compile does not emit the legacy unsupported-AST message", async () => {
  const queryable = {
    async query() {
      return {
        rows: [
          {
            constraint_name: "instruments_section_id_fkey",
            from_column: "section_id",
            from_schema: "public",
            from_table: "instruments",
            position: 1,
            to_column: "id",
            to_schema: "public",
            to_table: "orchestral_sections",
          },
        ],
      };
    },
  };
  const compiled = await compilePostgresStructuredFetch(
    {
      operation: "select",
      select: {
        instruments: { select: { name: true } },
        name: true,
      },
      table_name: "orchestral_sections",
    },
    queryable as never
  );
  assert.match(compiled.text, /json_agg/);
  assert.doesNotMatch(
    compiled.text,
    /Direct AST operation payloads are unsupported/
  );
});

test("bare table names resolve relations on the search_path schema", async () => {
  const queryable = {
    async query(text: string) {
      if (text.includes("to_regclass")) {
        return { rows: [{ schema_name: "public" }] };
      }
      if (text.includes("contype = 'f'")) {
        return {
          rows: [
            {
              constraint_name: "instruments_section_id_fkey",
              from_column: "section_id",
              from_schema: "public",
              from_table: "instruments",
              position: 1,
              to_column: "id",
              to_schema: "public",
              to_table: "orchestral_sections",
            },
            {
              constraint_name: "instruments_section_id_fkey",
              from_column: "section_id",
              from_schema: "postgres",
              from_table: "instruments",
              position: 1,
              to_column: "id",
              to_schema: "postgres",
              to_table: "orchestral_sections",
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const compiled = await compilePostgresStructuredFetch(
    {
      operation: "select",
      select: { name: true },
      table_name: "orchestral_sections",
      where: { instruments: { some: { name: { eq: "Tuba" } } } },
    },
    queryable as never
  );
  assert.match(compiled.text, /"public"\."orchestral_sections"/);
  assert.match(compiled.text, /"public"\."instruments"/);
  assert.doesNotMatch(compiled.text, /"postgres"\."instruments"/);
});

test("ACT-QRY-10: databaseUrl path does not HTTP to Gateway", async () => {
  const original = globalThis.fetch;
  let httpCalls = 0;
  globalThis.fetch = async () => {
    httpCalls += 1;
    throw new Error("unexpected Gateway HTTP");
  };
  try {
    const client = createClient({
      db: { pgUri: SAMPLE_PG },
      env: {},
    });
    assert.equal(client.capabilities?.db.layers.findManyAst, true);
    assert.equal(httpCalls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("ACT-PG-POOL-01: direct transport executes CRUD through pool leases", async () => {
  let poolQueryCalls = 0;
  let clientQueryCalls = 0;
  let releases = 0;
  const client: AthenaPostgresClient = {
    async query(text) {
      clientQueryCalls += 1;
      assert.equal(text, "SELECT 1");
      return { rowCount: 1, rows: [{ ok: 1 }] } as never;
    },
    release() {
      releases += 1;
    },
  };
  const pool: AthenaPostgresPool = {
    async connect() {
      return client;
    },
    async end() {},
    async query() {
      poolQueryCalls += 1;
      return { rowCount: 1, rows: [{ ok: 0 }] } as never;
    },
  };
  const transport = createPostgresDirectTransport({ pool });

  const result = await transport.queryGateway({
    params: [],
    query: "SELECT 1",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, [{ ok: 1 }]);
  assert.equal(clientQueryCalls, 1);
  assert.equal(poolQueryCalls, 0);
  assert.equal(releases, 1);
});
