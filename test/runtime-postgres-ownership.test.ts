import assert from "node:assert/strict";
import { test } from "node:test";
import type { AthenaPostgresPool } from "../src/postgres/driver.ts";
import {
  type AthenaPostgresRuntime,
  createAthenaPostgresRuntime,
} from "../src/postgres/owned-runtime.ts";
import {
  createPostgresDirectTransport,
  disposePostgresDirectTransport,
} from "../src/postgres/transport.ts";
import { getAthenaClientInternals } from "../src/runtime/client-internals.ts";
import { AthenaConfigurationError, createClient } from "../src/v3-client.ts";

const SAMPLE_PG =
  "postgresql://postgres@127.0.0.1:5432/athena_runtime_finality";

function createFakePool(ended: { n: number }): AthenaPostgresPool {
  return {
    async connect() {
      return {
        async query() {
          return { rowCount: 0, rows: [] } as never;
        },
        release() {},
      };
    },
    async end() {
      ended.n += 1;
    },
    async query() {
      return { rowCount: 0, rows: [] } as never;
    },
  };
}

test("borrowed pool is not closed by AthenaPostgresRuntime", async () => {
  const ended = { n: 0 };
  const runtime = createAthenaPostgresRuntime({
    pool: createFakePool(ended),
  });
  assert.equal(runtime.ownership, "borrowed");
  await runtime.getPool();
  await runtime.close();
  await runtime.close();
  assert.equal(ended.n, 0);
});

test("owned runtime created from a URI does not open a pool until used", async () => {
  const runtime = createAthenaPostgresRuntime({
    connectionString: SAMPLE_PG,
  });
  assert.equal(runtime.ownership, "owned");
  await runtime.close();
});

test("transport using a borrowed pool does not end it on dispose", async () => {
  const ended = { n: 0 };
  const pool = createFakePool(ended);
  const transport = createPostgresDirectTransport({
    ownsPool: false,
    pool,
  });
  await disposePostgresDirectTransport(transport);
  assert.equal(ended.n, 0);
});

test("createClient owns one postgres runtime shared by withContext views", async () => {
  const root = createClient({
    databaseUrl: SAMPLE_PG,
    env: {},
  });
  const orgA = root.withContext({
    organizationId: "org-a",
    userId: "u1",
  });
  const orgB = root.withContext({
    organizationId: "org-b",
    userId: "u1",
  });
  const rootRuntime = getAthenaClientInternals(root)?.postgresRuntime;
  const authRuntime = getAthenaClientInternals(root)?.authRuntime;
  assert.ok(rootRuntime);
  assert.ok(authRuntime);
  assert.equal(getAthenaClientInternals(orgA)?.postgresRuntime, rootRuntime);
  assert.equal(getAthenaClientInternals(orgB)?.postgresRuntime, rootRuntime);
  assert.equal(getAthenaClientInternals(orgA)?.authRuntime, authRuntime);
  assert.equal(getAthenaClientInternals(orgB)?.authRuntime, authRuntime);
  assert.equal((rootRuntime as AthenaPostgresRuntime).ownership, "owned");
  await root.close();
  await (orgA as unknown as typeof root).close();
  await assert.rejects(
    () => rootRuntime.getPool(),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_RUNTIME_DISPOSED"
  );
});
