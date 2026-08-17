/**
 * Athena 5 Finality — T-AUTH-01 / T-SESS-01.
 * Public seam: `createClient().auth` composition root.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { createClient } from "../src/v3-client.ts";

const SAMPLE_PG = "postgresql://postgres@127.0.0.1:5432/athena_finality_test";

test("T-AUTH-01: createClient exposes auth.handlers on the root Auth namespace", () => {
  const client = createClient({
    databaseUrl: SAMPLE_PG,
    env: {},
  });
  assert.equal(Object.hasOwn(client.auth, "handlers"), true);
  assert.equal(typeof client.auth.handlers?.GET, "function");
  assert.equal(typeof client.auth.handlers?.POST, "function");
  assert.equal(typeof client.auth.server?.handle, "function");
});

test("T-SESS-01: auth.session.get is the canonical identity read", async () => {
  const client = createClient({
    databaseUrl: SAMPLE_PG,
    env: {},
  });
  assert.equal(typeof client.auth.session.get, "function");
  const session = await client.auth.session.get();
  assert.equal(session, null);
  assert.equal(typeof client.auth.getSession, "function");
});
