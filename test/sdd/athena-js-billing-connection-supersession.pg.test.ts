import { strict as assert } from "node:assert";
import { test } from "node:test";

import { inspectBillingWebhookIngressBinding } from "../../src/billing/import/postgres.ts";
import { supersedeOtherEnvironmentBillingConnections } from "../../src/billing/runtime/materialize-configured-connections.ts";
import type { BillingSqlExecutor } from "../../src/billing/subject/repository.ts";
import { createPostgresPool } from "../../src/postgres/driver.ts";

function disposableBillingFinalityUrl(): string | undefined {
  const value = process.env.ATHENA_BILLING_FINALITY_DATABASE_URL?.trim();
  return value && /^postgres(ql)?:\/\//i.test(value) ? value : undefined;
}

function billingSqlFromPool(
  pool: Awaited<ReturnType<typeof createPostgresPool>>,
): BillingSqlExecutor {
  return {
    async query(text, params = []) {
      const result = await pool.query(text, [...params]);
      return { rows: result.rows as Record<string, unknown>[] };
    },
  };
}

const LIVE_ID = "00000000-0000-0000-0000-0000000000aa";
const TEST_ID = "00000000-0000-0000-0000-0000000000bb";
const TEST_TOKEN = "whtok_supersede_other_environment";

test("P?: PostgreSQL environment supersession types jsonb metadata and disables the other connection", async (t) => {
  const connectionString = disposableBillingFinalityUrl();
  if (!connectionString) {
    t.skip(
      "ATHENA_BILLING_FINALITY_DATABASE_URL must point to a disposable PostgreSQL database",
    );
    return;
  }

  const pool = await createPostgresPool(connectionString, { max: 2, min: 0 });
  const sql = billingSqlFromPool(pool);
  try {
    await pool.query("DROP SCHEMA IF EXISTS billing CASCADE");
    await pool.query(`
      CREATE SCHEMA billing;
      CREATE TABLE billing.billing_provider_connections (
        id uuid PRIMARY KEY,
        owner_kind text NOT NULL,
        owner_id text NOT NULL,
        provider text NOT NULL,
        environment text NOT NULL,
        status text NOT NULL,
        credential_reference text NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
    `);
    await pool.query(
      `INSERT INTO billing.billing_provider_connections
        (id, owner_kind, owner_id, provider, environment, status, credential_reference, metadata)
       VALUES
        ($1::uuid, 'tenant', 'next-minimal', 'mollie', 'live', 'active', 'providers.mollie', '{}'::jsonb),
        ($2::uuid, 'tenant', 'next-minimal', 'mollie', 'test', 'active', 'providers.mollie',
          jsonb_build_object('webhookIngressToken', $3::text))`,
      [LIVE_ID, TEST_ID, TEST_TOKEN],
    );

    await supersedeOtherEnvironmentBillingConnections({
      applicationId: "next-minimal",
      credentialReference: "providers.mollie",
      environment: "live",
      id: LIVE_ID,
      provider: "mollie",
      sql,
    });

    const rows = await pool.query(
      `SELECT id::text AS id, status, environment,
              metadata->>'supersededByEnvironment' AS superseded_by_environment,
              metadata->>'supersededByCredentialReference' AS superseded_by_credential_reference,
              jsonb_typeof(metadata->'supersededByEnvironment') AS superseded_env_type,
              jsonb_typeof(metadata->'supersededByCredentialReference') AS superseded_cred_type
       FROM billing.billing_provider_connections
       ORDER BY environment`,
    );
    const live = rows.rows.find((row) => row.id === LIVE_ID);
    const other = rows.rows.find((row) => row.id === TEST_ID);
    assert.ok(live);
    assert.ok(other);
    assert.equal(live.status, "active");
    assert.equal(other.status, "disabled");
    assert.equal(other.superseded_by_environment, "live");
    assert.equal(other.superseded_by_credential_reference, "providers.mollie");
    assert.equal(other.superseded_env_type, "string");
    assert.equal(other.superseded_cred_type, "string");

    const inspected = await inspectBillingWebhookIngressBinding(sql, {
      processEnvironment: "live",
      token: TEST_TOKEN,
    });
    assert.equal(inspected.kind, "environment_superseded");
    if (inspected.kind === "environment_superseded") {
      assert.equal(inspected.connectionId, TEST_ID);
      assert.equal(inspected.connectionEnvironment, "test");
      assert.equal(inspected.processEnvironment, "live");
    }
  } finally {
    await pool.query("DROP SCHEMA IF EXISTS billing CASCADE");
    await pool.end();
  }
});
