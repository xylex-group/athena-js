import assert from "node:assert/strict";
import { test } from "node:test";

import { createAthenaServerClient } from "../src/next/server.ts";
import type { AthenaPostgresPool } from "../src/postgres/driver.ts";
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

test("T-runtime-scope: view.close() does not dispose the root PG runtime", async () => {
  const root = createClient({
    databaseUrl: SAMPLE_PG,
    env: {},
  });
  const view = root.withContext({ userId: "u1", organizationId: "org-a" });
  const runtime = getAthenaClientInternals(root)?.postgresRuntime;
  assert.ok(runtime);
  const closeView = view as unknown as typeof root;
  await closeView.close();
  await closeView.close();
  const pool = await runtime.getPool();
  assert.ok(pool);
  await root.close();
  await assert.rejects(
    () => runtime.getPool(),
    (error: unknown) =>
      error instanceof AthenaConfigurationError &&
      error.code === "ATHENA_RUNTIME_DISPOSED"
  );
});

test("T-runtime-scope: 1000 request views share one postgres runtime", async () => {
  const root = createClient({
    databaseUrl: SAMPLE_PG,
    env: {},
  });
  const rootRuntime = getAthenaClientInternals(root)?.postgresRuntime;
  assert.ok(rootRuntime);
  const views = await Promise.all(
    Array.from({ length: 1000 }, (_, index) =>
      createAthenaServerClient({
        client: root,
        requestCookies: `session=${index}`,
        requestHeaders: { "x-request-id": String(index) },
        scope: { organizationId: `org-${index % 7}`, userId: `u-${index}` },
      })
    )
  );
  assert.equal(views.length, 1000);
  for (const view of views) {
    assert.equal(getAthenaClientInternals(view)?.postgresRuntime, rootRuntime);
    assert.equal(getAthenaClientInternals(view)?.source, "view");
  }
  await (views[0] as unknown as typeof root | undefined)?.close();
  assert.equal(getAthenaClientInternals(root)?.postgresRuntime, rootRuntime);
  await rootRuntime.getPool();
  await root.close();
});

test("T-runtime-scope: borrowed db.pool survives client close", async () => {
  const ended = { n: 0 };
  const pool = createFakePool(ended);
  const client = createClient({
    db: { pool },
    env: {},
  });
  const runtime = getAthenaClientInternals(client)?.postgresRuntime;
  assert.ok(runtime);
  assert.equal(runtime.ownership, "borrowed");
  await client.close();
  await client.close();
  assert.equal(ended.n, 0);
});
