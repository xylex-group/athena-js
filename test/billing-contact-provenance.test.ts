import { strict as assert } from "node:assert";
import { test } from "node:test";

import { ensureActiveProviderCustomer } from "../src/billing/subject/ensure-provider-customer.ts";
import { BillingProviderRegistry } from "../src/billing/runtime/local/providers/registry.ts";
import { EMBEDDED_BILLING_MIGRATIONS } from "../src/migrations/embedded-billing/catalog.ts";
import type { BillingProviderRuntime } from "../src/billing/runtime/local/providers/types.ts";
import type { AthenaPrincipal } from "../src/runtime/data/principal.ts";
import { FetchMollieSdk } from "./helpers/fetch-mollie-sdk.ts";

const CONNECTION_ID = "11111111-1111-4111-8111-111111111111";

function principal(): AthenaPrincipal {
  return {
    authenticated: true,
    grants: [],
    rights: [],
    userId: "user-contact",
  };
}

function customerRuntime(calls: Record<string, unknown>[]): BillingProviderRuntime {
  const customer = () => ({
    metadata: {},
    provider: "mollie" as const,
    providerCustomerId: "customer-1",
    raw: {},
  });
  return {
    customers: {
      create: async (_context, input) => {
        calls.push({ ...input });
        return customer();
      },
      delete: async () => {},
      get: async () => customer(),
      kind: "customers",
      list: async () => ({ items: [], nextCursor: null }),
      update: async () => customer(),
    },
    async getCapabilities() {
      return {
        operations: { "customers.create": true },
        ports: {
          checkout: false,
          customers: true,
          invoices: false,
          paymentLinks: false,
          payments: false,
          prices: false,
          products: false,
          relations: false,
          refunds: false,
          subscriptions: false,
          webhooks: false,
        },
      };
    },
    provider: "mollie",
  };
}

function createSql(input: {
  email: string;
  emailVerified: boolean;
  queries?: string[];
  rows: Record<string, unknown>[];
}) {
  return {
    async query(text: string, params: readonly unknown[] = []) {
      input.queries?.push(text);
      if (text.includes("FROM billing.billing_provider_connections")) {
        return {
          rows: [
            {
              credential_reference: "providers.mollie",
              environment: "test",
              id: CONNECTION_ID,
              provider: "mollie",
              status: "active",
            },
          ],
        };
      }
      if (text.includes("FROM athena.users")) {
        return {
          rows: [
            {
              email: input.email,
              email_verified: input.emailVerified,
              id: "user-contact",
              updated_at: "2026-09-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (text.includes("SET email_snapshot")) {
        const row = input.rows[0];
        if (!row) {
          return { rows: [] };
        }
        row.email_snapshot = params[1];
        row.email_verification_source = params[2];
        row.email_observed_at = params[3];
        return { rows: [row] };
      }
      if (text.includes("FROM billing.billing_subject_bindings")) {
        return { rows: input.rows };
      }
      if (text.includes("INSERT INTO billing.billing_subject_bindings")) {
        const row = {
          connection_id: params[0],
          email_snapshot: params[7] ?? null,
          email_verification_source: params[8] ?? null,
          email_observed_at: params[9] ?? null,
          id: "binding-contact",
          is_primary: false,
          provider_subject_id: params[4],
          provider_subject_kind: params[3],
          reservation_token: params[6],
          source: params[5],
          status: "pending",
          subject_id: params[2],
          subject_kind: params[1],
        };
        input.rows.push(row);
        return { rows: [row] };
      }
      if (
        text.includes("UPDATE billing.billing_subject_bindings") &&
        text.includes("SET provider_subject_id")
      ) {
        const row = input.rows[0];
        if (!row) {
          return { rows: [] };
        }
        row.provider_subject_id = params[0];
        row.status = "active";
        row.is_primary = true;
        return { rows: [row] };
      }
      return { rows: [] };
    },
  };
}

test("verified Auth email is provider contact evidence, never identity", async () => {
  const calls: Record<string, unknown>[] = [];
  const rows: Record<string, unknown>[] = [];
  const runtime = customerRuntime(calls);
  const sql = createSql({
    email: "verified@example.test",
    emailVerified: true,
    rows,
  });

  const result = await ensureActiveProviderCustomer({
    configuredProviders: { mollie: { sdk: FetchMollieSdk, testKey: "test-key" } },
    connectionId: CONNECTION_ID,
    idempotencyKey: "contact-verified",
    principal: principal(),
    registry: new BillingProviderRegistry([runtime]),
    sql,
    testMode: true,
  });

  assert.equal(result.customerId, "customer-1");
  assert.equal(calls[0]?.email, "verified@example.test");
  assert.equal(rows[0]?.email_snapshot, "verified@example.test");
  assert.equal(rows[0]?.email_verification_source, "athena-auth");
  assert.ok(rows[0]?.email_observed_at);
});

test("verified contact records observation time without reading Auth modification time", async () => {
  const calls: Record<string, unknown>[] = [];
  const rows: Record<string, unknown>[] = [];
  const queries: string[] = [];
  await ensureActiveProviderCustomer({
    configuredProviders: {
      mollie: { sdk: FetchMollieSdk, testKey: "test-key" },
    },
    connectionId: CONNECTION_ID,
    idempotencyKey: "contact-observed",
    now: () => new Date("2026-09-01T01:02:03.000Z"),
    principal: principal(),
    registry: new BillingProviderRegistry([customerRuntime(calls)]),
    sql: createSql({
      email: "observed@example.test",
      emailVerified: true,
      queries,
      rows,
    }),
    testMode: true,
  });

  assert.equal(rows[0]?.email_observed_at, "2026-09-01T01:02:03.000Z");
  assert.equal(
    queries.some(
      (query) =>
        query.includes("FROM athena.users") && query.includes("updated_at")
    ),
    false
  );
  assert.equal(
    queries.some(
      (query) =>
        query.includes("FROM athena.users") &&
        query.includes("email_verified_at")
    ),
    false
  );
});

test("unverified Auth email is not sent as trusted provider contact data", async () => {
  const calls: Record<string, unknown>[] = [];
  const rows: Record<string, unknown>[] = [];
  await ensureActiveProviderCustomer({
    configuredProviders: { mollie: { sdk: FetchMollieSdk, testKey: "test-key" } },
    connectionId: CONNECTION_ID,
    idempotencyKey: "contact-unverified",
    principal: principal(),
    registry: new BillingProviderRegistry([customerRuntime(calls)]),
    sql: createSql({
      email: "unverified@example.test",
      emailVerified: false,
      rows,
    }),
    testMode: true,
  });

  assert.equal("email" in (calls[0] ?? {}), false);
  assert.equal(rows[0]?.email_snapshot, null);
  assert.equal(rows[0]?.email_verification_source, null);
});

test("changing verified email updates evidence without creating another provider customer", async () => {
  const calls: Record<string, unknown>[] = [];
  const rows: Record<string, unknown>[] = [];
  const configuredProviders = {
    mollie: { sdk: FetchMollieSdk, testKey: "test-key" },
  };
  const registry = new BillingProviderRegistry([customerRuntime(calls)]);
  const input = {
    configuredProviders,
    connectionId: CONNECTION_ID,
    idempotencyKey: "contact-changed",
    principal: principal(),
    registry,
    sql: createSql({
      email: "first@example.test",
      emailVerified: true,
      rows,
    }),
    testMode: true,
  };

  const first = await ensureActiveProviderCustomer(input);
  input.sql = createSql({
    email: "changed@example.test",
    emailVerified: true,
    rows,
  });
  const second = await ensureActiveProviderCustomer(input);

  assert.equal(first.customerId, second.customerId);
  assert.equal(calls.length, 1);
  assert.equal(rows[0]?.email_snapshot, "changed@example.test");
  assert.equal(rows[0]?.email_verification_source, "athena-auth");
});

test("contact provenance migration covers snapshot source and observation time", () => {
  const migration = EMBEDDED_BILLING_MIGRATIONS.find(
    (entry) => entry.version === 30,
  );
  assert.ok(migration);
  assert.match(migration.sql, /email_verification_source/);
  assert.match(migration.sql, /email_verified_at/);
  assert.match(migration.sql, /billing_contact_provenance/);
  const observationMigration = EMBEDDED_BILLING_MIGRATIONS.find(
    (entry) => entry.version === 34
  );
  assert.ok(observationMigration);
  assert.match(observationMigration.sql, /email_observed_at/);
  assert.match(observationMigration.sql, /RENAME COLUMN email_verified_at/);
});
