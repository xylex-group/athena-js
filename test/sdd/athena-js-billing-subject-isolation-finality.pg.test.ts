/**
 * Optional PostgreSQL probes for billing 0003 and subject-scoped invoice SQL.
 * Skips unless DATABASE_URL is set. Rolls back so the target database is not kept.
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { listSelfInvoices } from "../../src/billing/runtime/self/invoices.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";
import type { AthenaPrincipal } from "../../src/runtime/data/principal.ts";

const here = dirname(fileURLToPath(import.meta.url));
const sqlDir = join(
  here,
  "..",
  "..",
  "src",
  "migrations",
  "embedded-billing",
  "sql"
);

function sessionUser(id: string): AthenaPrincipal {
  return {
    authenticated: true,
    grants: [],
    rights: [parseAthenaRightKey("billing.payments.read")],
    userId: id,
  };
}

test("P?: 0003 maps logical connection ids without uuid casts", async (t) => {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    t.skip("DATABASE_URL is not set");
    return;
  }
  if (
    connectionString.includes("neon.tech") &&
    process.env.ATHENA_BILLING_ISOLATION_PG !== "1"
  ) {
    t.skip("refusing Neon DATABASE_URL without ATHENA_BILLING_ISOLATION_PG=1");
    return;
  }
  const pg = await import("pg");
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      readFileSync(join(sqlDir, "0001_billing_canonical.sql"), "utf8")
    );
    await client.query(
      readFileSync(join(sqlDir, "0002_billing_subject_bindings.sql"), "utf8")
    );
    await client.query(
      `INSERT INTO billing.billing_subject_bindings (
				connection_id, subject_kind, subject_id, provider_subject_kind,
				provider_subject_id, status, source, is_primary
			) VALUES ('default', 'user', 'user_a', 'customer', 'cst_a', 'active', 'created', true)`
    );
    await client.query(
      readFileSync(join(sqlDir, "0003_billing_subject_finality.sql"), "utf8")
    );
    const type = await client.query(
      `SELECT data_type
			 FROM information_schema.columns
			 WHERE table_schema = 'billing'
			   AND table_name = 'billing_subject_bindings'
			   AND column_name = 'connection_id'`
    );
    assert.equal(type.rows[0]?.data_type, "uuid");
    const mapped = await client.query(
      `SELECT metadata->>'legacyConnectionId' AS legacy
			 FROM billing.billing_provider_connections
			 WHERE account_reference = 'default'`
    );
    assert.equal(mapped.rows[0]?.legacy, "default");
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
});

test("P?: owned invoice SQL hides other subjects", async () => {
  const captured: unknown[][] = [];
  const sql = {
    async query(_text: string, params?: readonly unknown[]) {
      captured.push([...(params ?? [])]);
      return { rows: [] };
    },
  };
  await listSelfInvoices({
    principal: sessionUser("user_a"),
    sql,
  });
  assert.deepEqual(captured[0], ["user", "user_a", 50]);
});
