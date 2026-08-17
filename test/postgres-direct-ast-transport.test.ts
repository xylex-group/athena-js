import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "../src/index.ts";
import {
  compilePostgresStructuredFetch,
  needsPostgresAstPipeline,
} from "../src/postgres/compile-fetch.ts";

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
      select: { name: true, instruments: { select: { name: true } } },
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
        name: true,
        instruments: { select: { name: true } },
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
