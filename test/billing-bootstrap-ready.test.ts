import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { BILLING_BOOTSTRAP_EVENT } from "../src/billing/runtime/local/materialize.ts";
import { getAthenaClientInternals } from "../src/runtime/client-internals.ts";
import { createClient } from "../src/v3-client.ts";

function unusedMollieResource(): Record<string, () => Promise<unknown>> {
  return {
    cancel: async () => ({}),
    create: async () => ({}),
    delete: async () => ({}),
    get: async () => ({}),
    list: async () => ({}),
    update: async () => ({}),
  };
}

class FakeMollieClient {
  customers = {
    ...unusedMollieResource(),
    create: async () => ({
      id: "cst_bootstrap",
      resource: "customer",
    }),
  };
  invoices = unusedMollieResource();
  salesInvoices = unusedMollieResource();
  paymentLinks = unusedMollieResource();
  payments = unusedMollieResource();
  refunds = unusedMollieResource();
  subscriptions = unusedMollieResource();
  webhooks = unusedMollieResource();
}

const declaredMollie = {
  accessToken: "access_bootstrap",
  authority: {
    permissions: {
      customers: { read: true, write: true },
      mandates: { read: true, write: true },
      payments: { read: true, write: true },
      subscriptions: { read: true, write: true },
      webhooks: { read: true, write: true },
    },
    source: "declared" as const,
  },
  credentialKind: "advanced_access_token" as const,
  sdk: FakeMollieClient,
};

test("createClient local billing awaits readiness before customers.create", async () => {
  const athena = createClient({
    app: { id: "next-minimal", url: "https://next-minimal.test" },
    billing: {
      mode: "local",
      providers: { mollie: declaredMollie },
      testMode: true,
    },
    key: "ak_test",
    url: "https://athena.example.com",
  });
  const created = await athena.billing.customers.create({
    idempotencyKey: "boot-1",
  });
  assert.equal(created.providerCustomerId, "cst_bootstrap");
  const capabilities = await athena.billing.getCapabilities({
    provider: "mollie",
  });
  assert.equal(capabilities.runtime, "local");
  assert.equal(capabilities.connected, false);
  assert.equal(capabilities.credentials?.configured, true);
  assert.equal(capabilities.initialized, true);
  assert.equal(
    capabilities.credentials?.credentialKind,
    "advanced_access_token"
  );
  assert.equal(capabilities.ports.customers, true);
  assert.equal(capabilities.operations["customers.create"]?.available, true);
});

test("bootstrap events never register schedulers before connection materialize", async () => {
  const athena = createClient({
    app: { id: "next-minimal", url: "https://next-minimal.test" },
    billing: {
      ingestion: { webhooks: false },
      mode: "local",
      providers: { mollie: declaredMollie },
      testMode: true,
    },
    key: "ak_test",
    url: "https://athena.example.com",
  });
  await athena.billing.getCapabilities({ provider: "mollie" });
  const events = getAthenaClientInternals(athena)?.billingBootstrapEvents ?? [];
  const materialized = events.indexOf(
    BILLING_BOOTSTRAP_EVENT.connectionMaterialized
  );
  const runtimeReady = events.indexOf(BILLING_BOOTSTRAP_EVENT.runtimeReady);
  const webhook = events.indexOf(
    BILLING_BOOTSTRAP_EVENT.webhookSchedulerRegistered
  );
  const imported = events.indexOf(
    BILLING_BOOTSTRAP_EVENT.importSchedulerRegistered
  );
  assert.ok(materialized >= 0);
  assert.ok(runtimeReady > materialized);
  if (webhook >= 0) {
    assert.ok(webhook > materialized);
  }
  if (imported >= 0) {
    assert.ok(imported > materialized);
  }
  assert.ok(events.indexOf(BILLING_BOOTSTRAP_EVENT.providerRegistryReady) >= 0);
});

test("next-minimal Athena singleton stays server-only", () => {
  const root = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../athena-auth-ui/examples/next-minimal/src/lib/athena/create-client.ts"
    ),
    "utf8"
  );
  assert.match(root, /import ["']server-only["']/);
  assert.match(root, /credentialKind:\s*"advanced_access_token"/);
});

test("subject-binding provider locator uniqueness remains (connection, kind, provider id)", () => {
  const sql = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../src/migrations/embedded-billing/sql/0003_billing_subject_finality.sql"
    ),
    "utf8"
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_subject_bindings_provider_locator/
  );
  assert.match(
    sql,
    /connection_id,\s*provider_subject_kind,\s*provider_subject_id/
  );
});
