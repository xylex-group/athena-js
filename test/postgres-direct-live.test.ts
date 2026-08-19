/**
 * Optional live PostgreSQL contract suite.
 * Runs only when ATHENA_PG_DIRECT_URI or DATABASE_URL is set.
 *
 * Creates/uses public.athena_pg_direct_smoke for insert/select/update/delete.
 */
import { strict as assert } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createClient } from "../src/index.ts";

const LIVE_URI = (
  process.env.ATHENA_PG_DIRECT_URI ??
  process.env.DATABASE_URL ??
  ""
).trim();

const live = { skip: !LIVE_URI };

test("live PG: verifyConnection", live, async () => {
  const client = createClient({ db: { pgUri: LIVE_URI }, env: {} });
  const result = await client.verifyConnection();
  assert.equal(result.ok, true, result.error ?? "verify failed");
  assert.equal(result.reachable, true);
});

test("live PG: insert / select / update / delete smoke", live, async () => {
  const client = createClient({ db: { pgUri: LIVE_URI }, env: {} });

  const setup = await client.query(`
    CREATE TABLE IF NOT EXISTS public.athena_pg_direct_smoke (
      id uuid PRIMARY KEY,
      email text NOT NULL UNIQUE,
      name text
    )
  `);
  assert.equal(setup.error, null, String(setup.error ?? ""));

  const id = randomUUID();
  const email = `smoke-${id.slice(0, 8)}@example.com`;

  const inserted = await client
    .from("athena_pg_direct_smoke")
    .insert({ id, email, name: "Ada" })
    .select("id,email,name");
  assert.equal(inserted.error, null, String(inserted.error ?? ""));
  assert.ok(inserted.data);

  const found = await client
    .from("athena_pg_direct_smoke")
    .eq("email", email)
    .select("id,email,name");
  assert.equal(found.error, null, String(found.error ?? ""));
  assert.ok(Array.isArray(found.data));
  assert.equal((found.data as { email: string }[])[0]?.email, email);

  const updated = await client
    .from("athena_pg_direct_smoke")
    .eq("id", id)
    .update({ name: "Grace" })
    .select("name");
  assert.equal(updated.error, null, String(updated.error ?? ""));

  const deleted = await client
    .from("athena_pg_direct_smoke")
    .eq("id", id)
    .delete();
  assert.equal(deleted.error, null, String(deleted.error ?? ""));
});
