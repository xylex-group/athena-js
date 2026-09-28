/**
 * Optional PostgreSQL probes for billing 0004 importer tables.
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

test("P?: 0004 importer tables enforce provider locator uniqueness", async (t) => {
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
    const connection = await client.query(
      `INSERT INTO billing.billing_provider_connections (
				owner_kind, owner_id, provider, mode, environment, status,
				credential_kind, provider_account_id, account_reference
			) VALUES ('user', 'ops', 'mollie', 'test', 'test', 'active', 'api_key', 'org_1', 'org_1')
			RETURNING id`
    );
    const connectionId = connection.rows[0]?.id;
    await client.query(
      `INSERT INTO billing.billing_subject_bindings (
				connection_id, subject_kind, subject_id, provider_subject_kind,
				provider_subject_id, status, source, is_primary
			) VALUES ($1, 'user', 'user_a', 'customer', 'cst_a', 'active', 'imported', true)`,
      [connectionId]
    );
    await assert.rejects(() =>
      client.query(
        `INSERT INTO billing.billing_subject_bindings (
						connection_id, subject_kind, subject_id, provider_subject_kind,
						provider_subject_id, status, source, is_primary
					) VALUES ($1, 'user', 'user_b', 'customer', 'cst_a', 'active', 'imported', true)`,
        [connectionId]
      )
    );
    await client.query(
      readFileSync(
        join(sqlDir, "0011_billing_subject_binding_uniqueness.sql"),
        "utf8"
      )
    );
    await assert.rejects(() =>
      client.query(
        `INSERT INTO billing.billing_subject_bindings (
						connection_id, subject_kind, subject_id, provider_subject_kind,
						provider_subject_id, status, source, is_primary
					) VALUES ($1, 'user', 'user_a', 'customer', 'cst_second', 'pending', 'created', false)`,
        [connectionId]
      )
    );
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
});
