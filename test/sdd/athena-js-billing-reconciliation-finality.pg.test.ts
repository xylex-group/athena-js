/**
 * Optional PostgreSQL probes for billing 0005 reconciliation observability.
 * Skips unless DATABASE_URL is set.
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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

test("P?: 0005 creates traces, audit, and leases", async (t) => {
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
      readFileSync(join(sqlDir, "0003_billing_subject_finality.sql"), "utf8")
    );
    await client.query(
      readFileSync(join(sqlDir, "0004_billing_customer_import.sql"), "utf8")
    );
    await client.query(
      readFileSync(
        join(sqlDir, "0005_billing_reconciliation_observability.sql"),
        "utf8"
      )
    );
    const traces = await client.query(
      `SELECT to_regclass('athena.traces_billing') AS rel`
    );
    assert.ok(traces.rows[0]?.rel);
    const leases = await client.query(
      `SELECT to_regclass('billing.billing_reconciliation_leases') AS rel`
    );
    assert.ok(leases.rows[0]?.rel);
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
});
