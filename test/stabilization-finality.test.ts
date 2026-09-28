import { strict as assert } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "pg";

import {
  createMollieProviderRequestError,
} from "../src/billing/runtime/local/providers/mollie/errors.ts";
import {
  createBillingRejectedIngressEvidence,
} from "../src/billing/ingestion/observability/rejection-evidence.ts";
import {
  isBillingSelfEnrollmentEnabled,
  isBillingSelfPlanChangeEnabled,
} from "../src/billing/self-enrollment.ts";
import { resolveAuthorizationCommandScope } from "../src/auth/local/authorization-guard.ts";
import { EMBEDDED_BILLING_MIGRATIONS } from "../src/migrations/embedded-billing/catalog.ts";

const packageRoot = join(import.meta.dirname, "..");

test("financial self-service defaults stay disabled in every runtime environment", () => {
  const previous = process.env.NODE_ENV;
  try {
    for (const environment of ["development", "test", "preview", "production"]) {
      process.env.NODE_ENV = environment;
      assert.equal(isBillingSelfEnrollmentEnabled(), false, environment);
      assert.equal(isBillingSelfPlanChangeEnabled(), false, environment);
    }
  } finally {
    if (previous === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previous;
    }
  }
});

test("provider diagnostics are bounded and total for cyclic hostile errors", () => {
  const body: Record<string, unknown> = {
    access_token: "secret-token",
    nested: {
      value: "x".repeat(10_000),
    },
  };
  body.self = body;
  Object.defineProperty(body, "throws", {
    enumerable: true,
    get() {
      throw new Error("getter must not escape");
    },
  });

  const error = createMollieProviderRequestError({
    body,
    fallbackMessage: "provider rejected the request",
    operation: "payments.get",
    status: 400,
  });

  assert.doesNotThrow(() => JSON.stringify(error.toJSON()));
  const serialized = JSON.stringify(error.details);
  assert.ok(serialized.length <= 16_384);
  assert.equal(serialized.includes("secret-token"), false);
  assert.match(serialized, /Circular|Truncated|REDACTED/);
});

test("rejected ingress evidence fingerprints bytes without retaining the body", () => {
  const body = new TextEncoder().encode(
    '{"access_token":"secret","email":"person@example.com"}'
  );
  const evidence = createBillingRejectedIngressEvidence({
    body,
    contentType: "application/json",
    key: "diagnostics-secret",
    bodyKind: "json",
  });

  assert.equal(evidence.bytes, body.byteLength);
  assert.equal(evidence.classification, "json");
  assert.equal("attemptedBody" in evidence, false);
  assert.equal(
    createBillingRejectedIngressEvidence({
      body,
      contentType: "application/json",
      key: "diagnostics-secret",
      bodyKind: "json",
    }).digest,
    evidence.digest
  );
  assert.notEqual(
    createBillingRejectedIngressEvidence({
      body: new TextEncoder().encode("different"),
      contentType: "application/json",
      key: "diagnostics-secret",
      bodyKind: "json",
    }).digest,
    evidence.digest
  );
});

test("rejected ingress evidence omits fingerprints when no secret is available", () => {
  const evidence = createBillingRejectedIngressEvidence({
    body: new TextEncoder().encode('{"email":"person@example.com"}'),
    bodyKind: "json",
  });

  assert.equal(evidence.digest, undefined);
  assert.equal(evidence.bytes > 0, true);
  assert.equal(evidence.classification, "json");
});

test("billing ingress does not fall back to public connection identifiers for evidence keys", () => {
  const source = readFileSync(
    join(packageRoot, "src", "next", "billing-ingress-handlers.ts"),
    "utf8"
  );

  assert.doesNotMatch(
    source,
    /options\.diagnosticsKey\s*\?\?\s*compiledConnectionId/
  );
  assert.doesNotMatch(
    source,
    /options\.connectionId\s*\?\?\s*"athena-billing-ingress-diagnostics"/
  );
});

test(
  "live PG: populated pre-0037 rejection rows migrate without body retention",
  { skip: !process.env.ATHENA_BILLING_MIGRATION_DATABASE_URL },
  async () => {
    const sourceUrl = process.env.ATHENA_BILLING_MIGRATION_DATABASE_URL;
    assert.ok(sourceUrl);
    const databaseName = `athena_billing_0037_${process.pid}_${randomUUID()
      .replaceAll("-", "")
      .slice(0, 12)}`;
    const adminUrl = new URL(sourceUrl);
    adminUrl.pathname = "/postgres";
    const targetUrl = new URL(sourceUrl);
    targetUrl.pathname = `/${databaseName}`;
    const admin = new Client({ connectionString: adminUrl.toString() });
    let databaseCreated = false;
    let client: Client | undefined;
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      databaseCreated = true;
      client = new Client({ connectionString: targetUrl.toString() });
      await client.connect();
      await client.query(`
        CREATE EXTENSION IF NOT EXISTS pgcrypto;
        CREATE SCHEMA billing;
        CREATE TABLE athena_billing_migrations (
          version integer PRIMARY KEY,
          name text NOT NULL,
          checksum text NOT NULL
        );
        CREATE TABLE billing.billing_webhook_ingress_rejections (
          id uuid PRIMARY KEY,
          connection_id uuid,
          ingress_id uuid,
          kind text NOT NULL,
          code text NOT NULL,
          content_type text,
          body_kind text,
          body_bytes integer,
          attempted_body text NOT NULL,
          expected_envelope jsonb NOT NULL,
          occurred_at timestamptz NOT NULL DEFAULT now()
        );
        INSERT INTO billing.billing_webhook_ingress_rejections (
          id, kind, code, body_kind, body_bytes, attempted_body, expected_envelope
        ) VALUES (
          '${randomUUID()}',
          'next_gen',
          'ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID',
          'json',
          19,
          '{"email":"legacy"}',
          '{}'::jsonb
        );
      `);

      const migration37 = EMBEDDED_BILLING_MIGRATIONS.find(
        (migration) => migration.version === 37
      );
      const migration38 = EMBEDDED_BILLING_MIGRATIONS.find(
        (migration) => migration.version === 38
      );
      assert.ok(migration37?.sql);
      assert.ok(migration38?.sql);
      await client.query(migration37.sql);
      await client.query(migration38.sql);

      const columns = await client.query<{
        column_name: string;
        is_nullable: string;
      }>(`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'billing'
          AND table_name = 'billing_webhook_ingress_rejections'
      `);
      const names = new Set(columns.rows.map((row) => row.column_name));
      assert.equal(names.has("attempted_body"), false);
      assert.equal(names.has("classification"), true);
      assert.equal(names.has("digest"), true);
      assert.equal(names.has("truncated"), true);
      assert.equal(
        columns.rows.find((row) => row.column_name === "digest")?.is_nullable,
        "YES"
      );

      const migrated = await client.query<{
        classification: string;
        digest: string;
      }>(`
        SELECT classification, digest
        FROM billing.billing_webhook_ingress_rejections
      `);
      assert.equal(migrated.rows[0]?.classification, "json");
      assert.match(migrated.rows[0]?.digest ?? "", /^[0-9a-f]{64}$/);

      await client.query(`
        INSERT INTO billing.billing_webhook_ingress_rejections (
          id, kind, code, body_kind, body_bytes, classification, digest,
          truncated, expected_envelope
        ) VALUES (
          '${randomUUID()}',
          'next_gen',
          'ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID',
          'json',
          12,
          'json',
          NULL,
          false,
          '{}'::jsonb
        )
      `);
      const secretless = await client.query(
        `SELECT digest FROM billing.billing_webhook_ingress_rejections WHERE digest IS NULL`
      );
      assert.equal(secretless.rowCount, 1);
    } finally {
      await client?.end();
      await admin.end();
      if (databaseCreated) {
        const cleanup = new Client({ connectionString: adminUrl.toString() });
        await cleanup.connect();
        await cleanup.query(`DROP DATABASE "${databaseName}"`);
        await cleanup.end();
      }
    }
  }
);

test("authorization scope preserves platform authority when an organization is active", () => {
  assert.deepEqual(
    resolveAuthorizationCommandScope({
      activeOrganizationId: "org-1",
      canManageOrganizationRoles: false,
      canManagePlatformRoles: true,
    }),
    { kind: "platform", organizationId: null }
  );
});

test("authorization scope rejects a foreign explicit organization", () => {
  assert.throws(() =>
    resolveAuthorizationCommandScope({
      activeOrganizationId: "org-1",
      canManageOrganizationRoles: true,
      canManagePlatformRoles: true,
      requestedOrganizationId: "org-2",
      requestedScope: "organization",
    })
  );
});
