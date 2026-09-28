import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { AthenaBillingCapabilityError } from "../src/billing/errors.ts";
import { PROCESS_BILLING_INVOCATION } from "../src/billing/runtime/invocation-authority.ts";
import {
  DECLARED_BILLING_PROVIDER_MATERIALIZES_WITHOUT_CREATE_CONNECTION,
  materializeConfiguredBillingConnections,
} from "../src/billing/runtime/local/connections/materialize.ts";
import { BILLING_BOOTSTRAP_EVENT } from "../src/billing/runtime/local/materialize.ts";
import { createBillingProviderRegistry } from "../src/billing/runtime/local/providers/create-registry.ts";
import { BillingProviderRegistry } from "../src/billing/runtime/local/providers/registry.ts";
import type { BillingProviderRuntime } from "../src/billing/runtime/local/providers/types.ts";
import { createLocalBillingRuntime } from "../src/billing/runtime/local/runtime.ts";
import { PROCESS_OWNED_BILLING_PRINCIPAL } from "../src/billing/runtime/rights.ts";
import { createSelfCheckout } from "../src/billing/runtime/self/checkout.ts";
import {
  billingConfiguredConnectionOwner,
  inspectBillingConnectionAffinity,
  resolveBillingConnectionAffinity,
} from "../src/billing/subject/connection-affinity.ts";
import type { BillingSqlExecutor } from "../src/billing/subject/repository.ts";
import type { AthenaGatewayClient } from "../src/gateway/client.ts";
import type { AthenaPostgresRuntime } from "../src/postgres/owned-runtime.ts";
import { bindPostgresRuntime } from "../src/postgres/owned-runtime.ts";
import { getAthenaClientInternals } from "../src/runtime/client-internals.ts";
import { peekEmbeddedBillingRuntimeSurfaces } from "../src/billing/runtime/local/process-ownership.ts";
import type { AthenaPrincipal } from "../src/runtime/data/principal.ts";
import { createClient } from "../src/v3-client.ts";
import { FetchMollieSdk } from "./helpers/fetch-mollie-sdk.ts";

const WEBHOOK_INGRESS_TOKEN = "whtok_aaaaaaaaaaaaaa";
const CONNECTION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONNECTION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONNECTION_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CONNECTION_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const APP_A = "app-a";
const APP_B = "app-b";

function declaredMollie() {
  return {
    accessToken: "access_test",
    credentialKind: "advanced_access_token" as const,
    sdk: FetchMollieSdk,
  };
}

function principal(): AthenaPrincipal {
  return {
    authenticated: true,
    grants: [],
    rights: [],
    userId: "user_checkout_aff",
  };
}

function sqlFor(rowsByQuery: Record<string, Record<string, unknown>[]>) {
  const sql: BillingSqlExecutor = {
    async query(text) {
      for (const [marker, rows] of Object.entries(rowsByQuery)) {
        if (text.includes(marker)) {
          return { rows };
        }
      }
      return { rows: [] };
    },
    async transaction<T>(fn) {
      return fn(sql);
    },
  };
  return sql;
}

function sqlApplyingCredentialAnyThenLimit(
  rowsByQuery: Record<string, Record<string, unknown>[]>,
) {
  const sql: BillingSqlExecutor = {
    async query(text, params = []) {
      for (const [marker, rows] of Object.entries(rowsByQuery)) {
        if (!text.includes(marker)) {
          continue;
        }
        let selected = [...rows];
        const refs = params.find((value): value is string[] =>
          Array.isArray(value),
        );
        if (text.includes("ANY(") && refs != null) {
          selected = selected.filter((row) =>
            refs.includes(String(row.credential_reference)),
          );
        }
        const limitMatch = /LIMIT\s+(\d+)/i.exec(text);
        if (limitMatch) {
          selected = selected.slice(0, Number(limitMatch[1]));
        }
        return { rows: selected };
      }
      return { rows: [] };
    },
    async transaction<T>(fn) {
      return fn(sql);
    },
  };
  return sql;
}

function eligibleRow(id: string, extra: Record<string, unknown> = {}) {
  return {
    credential_reference: "providers.mollie",
    environment: "test",
    id,
    owner_id: APP_A,
    owner_kind: "tenant",
    provider: "mollie",
    status: "active",
    ...extra,
  };
}

function connectionLedger() {
  const rows: {
    account_reference: string;
    credential_reference: string;
    environment: string;
    id: string;
    owner_id: string;
    provider: string;
    provider_account_id: string | null;
    status: string;
  }[] = [];
  const sql: BillingSqlExecutor = {
    async query(text, params = []) {
      if (text.includes("HAVING COUNT(*) > 1")) {
        return { rows: [] };
      }
      if (text.includes("CREATE UNIQUE INDEX")) {
        return { rows: [] };
      }
      if (text.includes("ON CONFLICT") && text.includes("RETURNING")) {
        const owner = typeof params[0] === "string" ? params[0] : undefined;
        const provider =
          typeof params[1] === "string" ? params[1] : undefined;
        const environment =
          typeof params[3] === "string" ? params[3] : undefined;
        const credential_reference =
          typeof params[5] === "string" ? params[5] : undefined;
        const providerAccountRaw =
          typeof params[6] === "string" ? params[6] : null;
        const account_reference =
          typeof params[7] === "string" ? params[7] : undefined;
        if (
          owner == null ||
          provider == null ||
          environment == null ||
          credential_reference == null ||
          account_reference == null
        ) {
          throw new Error("upsert SQL missing identity parameters");
        }
        const incomingAccount = providerAccountRaw;
        const existing = rows.find(
          (row) =>
            row.owner_id === owner &&
            row.provider === provider &&
            row.environment === environment &&
            row.credential_reference === credential_reference,
        );
        if (existing) {
          existing.provider_account_id =
            incomingAccount ?? existing.provider_account_id;
          existing.status = "active";
          return {
            rows: [
              {
                id: existing.id,
                webhook_ingress_token: WEBHOOK_INGRESS_TOKEN,
              },
            ],
          };
        }
        const id = randomUUID();
        rows.push({
          account_reference,
          credential_reference,
          environment,
          id,
          owner_id: owner,
          provider,
          provider_account_id: incomingAccount,
          status: "active",
        });
        return {
          rows: [{ id, webhook_ingress_token: WEBHOOK_INGRESS_TOKEN }],
        };
      }
      if (
        text.includes("status = 'disabled'") &&
        text.includes("supersededByEnvironment")
      ) {
        const environment =
          typeof params[0] === "string" ? params[0] : undefined;
        const owner = typeof params[2] === "string" ? params[2] : undefined;
        const keepId = typeof params[4] === "string" ? params[4] : undefined;
        for (const row of rows) {
          if (
            row.owner_id === owner &&
            row.id !== keepId &&
            row.status === "active" &&
            !row.credential_reference.includes(":") &&
            row.environment !== environment
          ) {
            row.status = "disabled";
          }
        }
        return { rows: [] };
      }
      if (text.includes("FROM billing.billing_provider_connections")) {
        if (text.includes("WHERE id = $1::uuid")) {
          const id = params[0];
          return {
            rows: rows
              .filter((row) => row.id === id)
              .map((row) => ({
                credential_reference: row.credential_reference,
                environment: row.environment,
                id: row.id,
                owner_id: row.owner_id,
                owner_kind: "tenant",
                provider: row.provider,
                status: row.status,
              })),
          };
        }
        const provider = params[0];
        const environment = params[1];
        const ownerId = params[2];
        return {
          rows: rows
            .filter(
              (row) =>
                row.status === "active" &&
                row.provider === provider &&
                row.environment === environment &&
                (ownerId == null || row.owner_id === ownerId),
            )
            .slice(0, 32)
            .map((row) => ({
              credential_reference: row.credential_reference,
              environment: row.environment,
              id: row.id,
              owner_id: row.owner_id,
              owner_kind: "tenant",
              provider: row.provider,
              status: row.status,
            })),
        };
      }
      return { rows: [] };
    },
  };
  return { rows, sql };
}

function checkoutRuntime() {
  const payments: unknown[] = [];
  const runtime: BillingProviderRuntime = {
    customers: {
      create: async () => ({
        metadata: {},
        provider: "mollie",
        providerCustomerId: "cst_aff",
        raw: {},
      }),
      delete: async () => undefined,
      get: async () => ({
        metadata: {},
        provider: "mollie",
        providerCustomerId: "cst_aff",
        raw: {},
      }),
      kind: "customers",
      list: async () => ({ items: [], nextCursor: null }),
      update: async () => ({
        metadata: {},
        provider: "mollie",
        providerCustomerId: "cst_aff",
        raw: {},
      }),
    },
    async getCapabilities() {
      return {
        operations: {
          "customers.create": true,
          "payments.create": true,
          "prices.list": true,
          "products.list": true,
        },
        ports: {
          checkout: false,
          customers: true,
          invoices: false,
          paymentLinks: false,
          payments: true,
          prices: true,
          products: true,
          relations: false,
          refunds: false,
          self: true,
          subscriptions: false,
          webhooks: false,
        },
      };
    },
    payments: {
      cancel: async () => {
        throw new Error("unused");
      },
      create: async (_context, payload) => {
        payments.push(payload);
        return {
          amount: payload.amount,
          metadata: payload.metadata ?? {},
          provider: "mollie",
          providerCustomerId: payload.customerId,
          providerPaymentId: `tr_${payments.length}`,
          raw: {
            _links: {
              checkout: {
                href: "https://www.mollie.com/checkout/select-method/aff",
              },
            },
          },
          status: "pending",
        };
      },
      get: async () => {
        throw new Error("unused");
      },
      list: async () => ({ items: [], nextCursor: null }),
    },
    prices: {
      kind: "prices",
      list: async () => ({
        items: [
          {
            amount: { currency: "EUR", value: "99.00" },
            id: "starter-once",
            metadata: {},
            productId: "starter",
            raw: {},
          },
        ],
        nextCursor: null,
      }),
    },
    products: {
      kind: "products",
      list: async () => ({
        items: [{ id: "starter", metadata: {}, name: "Starter", raw: {} }],
        nextCursor: null,
      }),
    },
    provider: "mollie",
  };
  return { payments, registry: new BillingProviderRegistry([runtime]) };
}

test("declared providers materialize without createConnection()", () => {
  assert.equal(
    DECLARED_BILLING_PROVIDER_MATERIALIZES_WITHOUT_CREATE_CONNECTION,
    true,
  );
});

test("AUTO-CONN-001: declared Mollie plus empty connections creates an active row", async () => {
  const ledger = connectionLedger();
  assert.equal(ledger.rows.length, 0);
  const result = await materializeConfiguredBillingConnections({
    applicationId: "next-minimal",
    configuredProviders: { mollie: declaredMollie() },
    sql: ledger.sql,
    testMode: true,
  });
  assert.equal(result.connections.length, 1);
  assert.equal(ledger.rows.length, 1);
  assert.equal(ledger.rows[0]?.status, "active");
  assert.equal(ledger.rows[0]?.provider, "mollie");
  assert.equal(ledger.rows[0]?.environment, "test");
  assert.equal(ledger.rows[0]?.credential_reference, "providers.mollie");
  const inspection = await inspectBillingConnectionAffinity({
    configuredProviders: { mollie: declaredMollie() },
    environment: "test",
    provider: "mollie",
    sql: ledger.sql,
    ...(billingConfiguredConnectionOwner("next-minimal") ?? {}),
  });
  assert.equal(inspection.state, "resolved");
  if (inspection.state === "resolved") {
    assert.equal(inspection.connection.source, "eligible_connection");
    assert.equal(inspection.connection.connectionId, ledger.rows[0]?.id);
  }
});

test("AUTO-CONN-002: rematerialize upserts the same logical connection", async () => {
  const ledger = connectionLedger();
  const input = {
    applicationId: "next-minimal",
    configuredProviders: { mollie: declaredMollie() },
    sql: ledger.sql,
    testMode: true as const,
  };
  const first = await materializeConfiguredBillingConnections(input);
  const second = await materializeConfiguredBillingConnections(input);
  assert.equal(first.connections[0]?.id, second.connections[0]?.id);
  assert.equal(ledger.rows.length, 1);
});

test("AUTO-CONN-003: switching test to live keeps the previous environment routable until webhook finality", async () => {
  const ledger = connectionLedger();
  await materializeConfiguredBillingConnections({
    applicationId: "app",
    configuredProviders: { mollie: declaredMollie() },
    sql: ledger.sql,
    testMode: true,
  });
  await assert.rejects(
    () =>
      materializeConfiguredBillingConnections({
        applicationId: "app",
        configuredProviders: { mollie: declaredMollie() },
        sql: ledger.sql,
        testMode: false,
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("live billing credential is unavailable")
  );
  assert.equal(ledger.rows.length, 1);
  assert.equal(ledger.rows[0]?.environment, "test");
  assert.equal(ledger.rows[0]?.status, "active");
  await materializeConfiguredBillingConnections({
    applicationId: "app",
    configuredProviders: {
      mollie: { ...declaredMollie(), apiMode: "live" },
    },
    sql: ledger.sql,
    testMode: false,
  });
  const testRow = ledger.rows.find((row) => row.environment === "test");
  const liveRow = ledger.rows.find((row) => row.environment === "live");
  assert.equal(testRow?.status, "active");
  assert.equal(liveRow?.status, "active");
  assert.equal(liveRow?.credential_reference, "providers.mollie-live");
  const live = await inspectBillingConnectionAffinity({
    configuredProviders: {
      mollie: { ...declaredMollie(), apiMode: "live" },
    },
    environment: "live",
    provider: "mollie",
    sql: ledger.sql,
    ...(billingConfiguredConnectionOwner("app") ?? {}),
  });
  assert.equal(live.state, "resolved");
  const test = await inspectBillingConnectionAffinity({
    configuredProviders: { mollie: declaredMollie() },
    environment: "test",
    provider: "mollie",
    sql: ledger.sql,
    ...(billingConfiguredConnectionOwner("app") ?? {}),
  });
  assert.equal(test.state, "resolved");
  const liveWithoutLiveCredential = await inspectBillingConnectionAffinity({
    configuredProviders: { mollie: declaredMollie() },
    environment: "live",
    provider: "mollie",
    sql: ledger.sql,
    ...(billingConfiguredConnectionOwner("app") ?? {}),
  });
  assert.equal(liveWithoutLiveCredential.state, "missing");
});

test("AUTO-CONN-004: provider_account_id stays null until provider-confirmed", async () => {
  const ledger = connectionLedger();
  await materializeConfiguredBillingConnections({
    applicationId: "app",
    configuredProviders: { mollie: declaredMollie() },
    sql: ledger.sql,
    testMode: true,
  });
  assert.equal(ledger.rows[0]?.provider_account_id, null);
});

test("CHECKOUT-AFF-005: null historical connection_id uses eligible_connection", async () => {
  const checkoutSrc = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "src",
      "billing",
      "runtime",
      "self",
      "checkout.ts",
    ),
    "utf8",
  );
  assert.doesNotMatch(checkoutSrc, /owned\.found && !owned\.connectionId/);
  const inspection = await inspectBillingConnectionAffinity({
    configuredProviders: {
      mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
    },
    environment: "test",
    ownedConnectionId: undefined,
    provider: "mollie",
    sql: sqlFor({
      "FROM billing.billing_subject_bindings": [],
      "WHERE deleted_at IS NULL": [eligibleRow(CONNECTION_A)],
    }),
    subjectId: "user_checkout_aff",
    subjectKind: "user",
    ...(billingConfiguredConnectionOwner(APP_A) ?? {}),
  });
  assert.equal(inspection.state, "resolved");
  if (inspection.state === "resolved") {
    assert.equal(inspection.connection.source, "eligible_connection");
  }
  const sessions: Record<string, unknown>[] = [];
  const lines: Record<string, unknown>[] = [];
  const sql: BillingSqlExecutor = {
    async query(text, params = []) {
      const compact = text.replace(/\s+/g, " ");
      if (compact.includes("FROM billing.billing_subscriptions")) {
        return { rows: [] };
      }
      if (compact.includes("FROM billing.billing_payments")) {
        return {
          rows: [
            {
              connection_id: null,
              provider_customer_id: "cst_hist",
            },
          ],
        };
      }
      if (compact.includes("FROM billing.billing_subject_bindings")) {
        return { rows: [] };
      }
      if (compact.includes("FROM billing.billing_provider_connections")) {
        return { rows: [eligibleRow(CONNECTION_A)] };
      }
      if (compact.includes("INSERT INTO billing.billing_checkout_sessions")) {
        const metadata = JSON.parse(String(params[11] ?? "{}"));
        const row = {
          checkout_url: params[10],
          connection_id: params[13],
          created_at: new Date().toISOString(),
          id: params[0],
          idempotency_key: params[1],
          kind: params[12],
          metadata,
          price_id: params[4],
          provider: params[5],
          provider_customer_id: params[6],
          provider_payment_id: params[7],
          status: params[9],
          subject_id: params[3],
          subject_kind: params[2],
        };
        sessions.push(row);
        return { rows: [row] };
      }
      if (
        compact.includes("INSERT INTO billing.billing_checkout_session_lines")
      ) {
        lines.push({
          amount_currency: params[4],
          amount_value: params[5],
          checkout_session_id: params[0],
          price_id: params[3],
          product_id: params[2],
          quantity: params[7],
        });
        return { rows: [] };
      }
      if (compact.includes("FROM billing.billing_checkout_session_lines")) {
        return { rows: lines };
      }
      if (compact.includes("UPDATE billing.billing_checkout_sessions")) {
        const row = sessions[0];
        if (row) {
          row.status = params[1] ?? row.status;
          row.checkout_url = params[2] ?? row.checkout_url;
          row.provider_payment_id = params[4] ?? row.provider_payment_id;
        }
        return { rows: row ? [row] : [] };
      }
      return { rows: [] };
    },
    async transaction<T>(fn) {
      return fn(sql);
    },
  };
  const { payments, registry } = checkoutRuntime();
  const checkout = await createSelfCheckout({
    allowedRedirectOrigins: ["https://app.example"],
    applicationId: APP_A,
    configuredProviders: {
      mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
    },
    idempotencyKey: "chk-aff-005",
    priceId: "starter-once",
    principal: principal(),
    registry,
    sql,
    successUrl: "https://app.example/settings/billing",
  });
  assert.equal(payments.length, 1);
  assert.equal(checkout.provider, "mollie");
  assert.equal(sessions[0]?.connection_id, CONNECTION_A);
  assert.notEqual(sessions[0]?.provider_customer_id, "cst_hist");
  assert.notEqual(
    (payments[0] as { customerId?: string }).customerId,
    "cst_hist",
  );
});

test("CHECKOUT-AFF-006: subject binding wins over eligible when history has no connection_id", async () => {
  const inspection = await inspectBillingConnectionAffinity({
    configuredProviders: {
      mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
    },
    environment: "test",
    ownedConnectionId: undefined,
    provider: "mollie",
    sql: sqlFor({
      "FROM billing.billing_subject_bindings": [eligibleRow(CONNECTION_B)],
      "WHERE deleted_at IS NULL": [eligibleRow(CONNECTION_A)],
    }),
    subjectId: "user_checkout_aff",
    subjectKind: "user",
    ...(billingConfiguredConnectionOwner(APP_A) ?? {}),
  });
  assert.equal(inspection.state, "resolved");
  if (inspection.state === "resolved") {
    assert.equal(inspection.connection.source, "subject_binding");
    assert.equal(inspection.connection.connectionId, CONNECTION_B);
  }
});

test("CHECKOUT-AFF-007: null history plus zero eligible is provider_connection_missing", async () => {
  const inspection = await inspectBillingConnectionAffinity({
    configuredProviders: {
      mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
    },
    environment: "test",
    provider: "mollie",
    sql: sqlFor({
      "FROM billing.billing_subject_bindings": [],
    }),
    subjectId: "user_checkout_aff",
    subjectKind: "user",
  });
  assert.equal(inspection.state, "missing");
  await assert.rejects(
    () =>
      resolveBillingConnectionAffinity({
        environment: "test",
        operation: "self.checkout.create",
        provider: "mollie",
        sql: sqlFor({
          "FROM billing.billing_subject_bindings": [],
        }),
        subjectId: "user_checkout_aff",
        subjectKind: "user",
      }),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.reason === "provider_connection_missing" &&
      error.operation === "self.checkout.create",
  );
});

test("CHECKOUT-AFF-009: unique non-null owned connection among null history is not discarded", async () => {
  const sessions: Record<string, unknown>[] = [];
  const lines: Record<string, unknown>[] = [];
  const sql: BillingSqlExecutor = {
    async query(text, params = []) {
      const compact = text.replace(/\s+/g, " ");
      if (compact.includes("FROM billing.billing_subscriptions")) {
        return { rows: [] };
      }
      if (compact.includes("FROM billing.billing_payments")) {
        return {
          rows: [
            {
              connection_id: null,
              provider_customer_id: "cst_hist",
            },
            {
              connection_id: CONNECTION_A,
              provider_customer_id: "cst_owned",
            },
          ],
        };
      }
      if (compact.includes("FROM billing.billing_subject_bindings")) {
        return { rows: [] };
      }
      if (compact.includes("WHERE id = $1::uuid")) {
        return { rows: [eligibleRow(CONNECTION_A)] };
      }
      if (compact.includes("FROM billing.billing_provider_connections")) {
        return { rows: [eligibleRow(CONNECTION_B)] };
      }
      if (compact.includes("INSERT INTO billing.billing_checkout_sessions")) {
        const metadata = JSON.parse(String(params[11] ?? "{}"));
        const row = {
          checkout_url: params[10],
          connection_id: params[13],
          created_at: new Date().toISOString(),
          id: params[0],
          idempotency_key: params[1],
          kind: params[12],
          metadata,
          price_id: params[4],
          provider: params[5],
          provider_customer_id: params[6],
          provider_payment_id: params[7],
          status: params[9],
          subject_id: params[3],
          subject_kind: params[2],
        };
        sessions.push(row);
        return { rows: [row] };
      }
      if (
        compact.includes("INSERT INTO billing.billing_checkout_session_lines")
      ) {
        lines.push({
          amount_currency: params[4],
          amount_value: params[5],
          checkout_session_id: params[0],
          price_id: params[3],
          product_id: params[2],
          quantity: params[7],
        });
        return { rows: [] };
      }
      if (compact.includes("FROM billing.billing_checkout_session_lines")) {
        return { rows: lines };
      }
      if (compact.includes("UPDATE billing.billing_checkout_sessions")) {
        const row = sessions[0];
        if (row) {
          row.status = params[1] ?? row.status;
          row.checkout_url = params[2] ?? row.checkout_url;
          row.provider_payment_id = params[4] ?? row.provider_payment_id;
        }
        return { rows: row ? [row] : [] };
      }
      return { rows: [] };
    },
    async transaction<T>(fn) {
      return fn(sql);
    },
  };
  const { payments, registry } = checkoutRuntime();
  const checkout = await createSelfCheckout({
    allowedRedirectOrigins: ["https://app.example"],
    applicationId: APP_A,
    configuredProviders: {
      mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
    },
    idempotencyKey: "chk-aff-009",
    priceId: "starter-once",
    principal: principal(),
    registry,
    sql,
    successUrl: "https://app.example/settings/billing",
  });
  assert.equal(payments.length, 1);
  assert.equal(checkout.provider, "mollie");
  assert.equal(sessions[0]?.connection_id, CONNECTION_A);
  assert.equal(sessions[0]?.provider_customer_id, "cst_owned");
  assert.equal(
    (payments[0] as { customerId?: string }).customerId,
    "cst_owned",
  );
});

test("CHECKOUT-AFF-008: multiple owned connection ids are ambiguous", async () => {
  const sql = sqlFor({
    "FROM billing.billing_subscriptions": [
      { connection_id: CONNECTION_A, provider_customer_id: "cst_a" },
      { connection_id: CONNECTION_B, provider_customer_id: "cst_b" },
    ],
  });
  const { registry } = checkoutRuntime();
  await assert.rejects(
    () =>
      createSelfCheckout({
        allowedRedirectOrigins: ["https://app.example"],
        applicationId: APP_A,
        configuredProviders: {
          mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
        },
        idempotencyKey: "chk-aff-008",
        priceId: "starter-once",
        principal: principal(),
        registry,
        sql,
        successUrl: "https://app.example/settings/billing",
      }),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.reason === "provider_connection_ambiguous" &&
      error.operation === "self.checkout.create",
  );
});

const catalog = {
  prices: [
    {
      amount: { currency: "EUR", value: "9.00" },
      id: "price_once",
      productId: "starter",
    },
  ],
  products: [{ id: "starter", name: "Starter" }],
};

test("CAPS-CONN-009: credentials without eligible rows are disconnected", async () => {
  const configured = { mollie: { sdk: FetchMollieSdk, testKey: "test_caps" } };
  const sql: BillingSqlExecutor = {
    async query() {
      return { rows: [] };
    },
    async transaction<T>(fn) {
      return fn(sql);
    },
  };
  const runtime = createLocalBillingRuntime({
    applicationId: APP_A,
    configuredProviders: configured,
    invocation: PROCESS_BILLING_INVOCATION,
    registry: createBillingProviderRegistry(configured, catalog),
    selfEnrollmentEnabled: true,
    sql,
    testMode: true,
  });
  const capabilities = await runtime.getCapabilities({ provider: "mollie" });
  assert.equal(capabilities.credentials?.configured, true);
  assert.equal(capabilities.connected, false);
  assert.equal(capabilities.connectionId, undefined);
  assert.equal(
    capabilities.operations["self.checkout.create"]?.available,
    false,
  );
  assert.equal(
    capabilities.operations["self.checkout.create"]?.reason,
    "provider_connection_missing",
  );
  assert.equal(
    capabilities.operations["self.subscription.enroll"]?.available,
    false,
  );
});

test("CAPS-CONN-010: one eligible auto-materialized row advertises checkout", async () => {
  const configured = { mollie: { sdk: FetchMollieSdk, testKey: "test_caps" } };
  const sql: BillingSqlExecutor = {
    async query(text) {
      if (text.includes("FROM billing.billing_provider_connections")) {
        return { rows: [eligibleRow(CONNECTION_A)] };
      }
      return { rows: [] };
    },
    async transaction<T>(fn) {
      return fn(sql);
    },
  };
  const runtime = createLocalBillingRuntime({
    applicationId: APP_A,
    configuredProviders: configured,
    invocation: PROCESS_BILLING_INVOCATION,
    registry: createBillingProviderRegistry(configured, catalog),
    selfEnrollmentEnabled: true,
    sql,
    testMode: true,
  });
  const capabilities = await runtime.getCapabilities({ provider: "mollie" });
  assert.equal(capabilities.connected, true);
  assert.equal(capabilities.connectionId, CONNECTION_A);
  assert.equal(
    capabilities.operations["self.checkout.create"]?.available,
    true,
  );
});

test("AFF-OWNER-011: eligible lookup does not use another application's connection", async () => {
  const inspection = await inspectBillingConnectionAffinity({
    configuredProviders: {
      mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
    },
    environment: "test",
    provider: "mollie",
    sql: sqlFor({
      "FROM billing.billing_subject_bindings": [],
      "WHERE deleted_at IS NULL": [
        eligibleRow(CONNECTION_B, { owner_id: APP_B }),
      ],
    }),
    ...(billingConfiguredConnectionOwner(APP_A) ?? {}),
  });
  assert.equal(inspection.state, "missing");
});

test("AFF-OWNER-012: missing application ownership never uses global fallback", async () => {
  const inspection = await inspectBillingConnectionAffinity({
    configuredProviders: {
      mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
    },
    environment: "test",
    provider: "mollie",
    sql: sqlFor({
      "FROM billing.billing_subject_bindings": [],
      "WHERE deleted_at IS NULL": [eligibleRow(CONNECTION_A)],
    }),
  });
  assert.equal(inspection.state, "missing");
});

test("AFF-USABLE-012: stale credential slots are dropped before uniqueness", async () => {
  const inspection = await inspectBillingConnectionAffinity({
    configuredProviders: {
      mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
    },
    environment: "test",
    provider: "mollie",
    sql: sqlFor({
      "FROM billing.billing_subject_bindings": [],
      "WHERE deleted_at IS NULL": [
        eligibleRow(CONNECTION_A),
        eligibleRow(CONNECTION_B, {
          credential_reference: "providers.mollie:old",
        }),
      ],
    }),
    ...(billingConfiguredConnectionOwner(APP_A) ?? {}),
  });
  assert.equal(inspection.state, "resolved");
  if (inspection.state === "resolved") {
    assert.equal(inspection.connection.connectionId, CONNECTION_A);
  }
});

test("AFF-USABLE-018: two usable eligible connections remain ambiguous behind stale slots", async () => {
  const configured = {
    mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
    mollieAccounts: {
      eu: { sdk: FetchMollieSdk, testKey: "test_eu" },
    },
  };
  const inspection = await inspectBillingConnectionAffinity({
    configuredProviders: configured,
    environment: "test",
    provider: "mollie",
    sql: sqlApplyingCredentialAnyThenLimit({
      "FROM billing.billing_subject_bindings": [],
      "WHERE deleted_at IS NULL": [
        eligibleRow(CONNECTION_A),
        eligibleRow(CONNECTION_B, {
          credential_reference: "providers.mollie:old",
        }),
        eligibleRow(CONNECTION_C, {
          credential_reference: "providers.mollie:gone",
        }),
        eligibleRow(CONNECTION_D, {
          credential_reference: "providers.mollie:eu",
        }),
      ],
    }),
    ...(billingConfiguredConnectionOwner(APP_A) ?? {}),
  });
  assert.equal(inspection.state, "ambiguous");
});

test("AFF-SUBJECT-018: two usable bound connections remain ambiguous behind stale slots", async () => {
  const configured = {
    mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
    mollieAccounts: {
      eu: { sdk: FetchMollieSdk, testKey: "test_eu" },
    },
  };
  const bound = [
    eligibleRow(CONNECTION_A),
    eligibleRow(CONNECTION_B, {
      credential_reference: "providers.mollie:old",
    }),
    eligibleRow(CONNECTION_C, {
      credential_reference: "providers.mollie:gone",
    }),
    eligibleRow(CONNECTION_D, {
      credential_reference: "providers.mollie:eu",
    }),
  ];
  const inspection = await inspectBillingConnectionAffinity({
    configuredProviders: configured,
    environment: "test",
    provider: "mollie",
    sql: sqlApplyingCredentialAnyThenLimit({
      "SELECT 1": [{}],
      "INNER JOIN billing.billing_provider_connections": bound,
      "WHERE deleted_at IS NULL": [eligibleRow(CONNECTION_A)],
    }),
    subjectId: "user_checkout_aff",
    subjectKind: "user",
    ...(billingConfiguredConnectionOwner(APP_A) ?? {}),
  });
  assert.equal(inspection.state, "ambiguous");
});

test("AFF-OWNED-014: unusable ownedConnectionId is missing, not eligible fallback", async () => {
  const inspection = await inspectBillingConnectionAffinity({
    configuredProviders: {
      mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
    },
    environment: "test",
    ownedConnectionId: CONNECTION_B,
    provider: "mollie",
    sql: sqlFor({
      "WHERE id = $1::uuid": [
        eligibleRow(CONNECTION_B, {
          credential_reference: "providers.mollie:removed",
        }),
      ],
      "FROM billing.billing_subject_bindings": [],
      "WHERE deleted_at IS NULL": [eligibleRow(CONNECTION_A)],
    }),
    subjectId: "user_checkout_aff",
    subjectKind: "user",
    ...(billingConfiguredConnectionOwner(APP_A) ?? {}),
  });
  assert.equal(inspection.state, "missing");
});

test("AFF-SUBJECT-015: subject binding may target an organization-owned connection", async () => {
  const inspection = await inspectBillingConnectionAffinity({
    configuredProviders: {
      mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
    },
    environment: "test",
    provider: "mollie",
    sql: sqlFor({
      "FROM billing.billing_subject_bindings": [
        eligibleRow(CONNECTION_B, {
          owner_id: "org_bound",
          owner_kind: "organization",
        }),
      ],
      "WHERE deleted_at IS NULL": [eligibleRow(CONNECTION_A)],
    }),
    subjectId: "user_checkout_aff",
    subjectKind: "user",
    ...(billingConfiguredConnectionOwner(APP_A) ?? {}),
  });
  assert.equal(inspection.state, "resolved");
  if (inspection.state === "resolved") {
    assert.equal(inspection.connection.source, "subject_binding");
    assert.equal(inspection.connection.connectionId, CONNECTION_B);
  }
});

test("AFF-SUBJECT-016: unusable active subject binding does not use tenant fallback", async () => {
  const inspection = await inspectBillingConnectionAffinity({
    configuredProviders: {
      mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
    },
    environment: "test",
    provider: "mollie",
    sql: sqlFor({
      "FROM billing.billing_subject_bindings": [
        eligibleRow(CONNECTION_B, {
          credential_reference: "providers.mollie:old",
        }),
      ],
      "WHERE deleted_at IS NULL": [eligibleRow(CONNECTION_A)],
    }),
    subjectId: "user_checkout_aff",
    subjectKind: "user",
    ...(billingConfiguredConnectionOwner(APP_A) ?? {}),
  });
  assert.equal(inspection.state, "missing");
});

test("AFF-SUBJECT-017: customer and recipient bindings to one connection are resolved", async () => {
  const inspection = await inspectBillingConnectionAffinity({
    configuredProviders: {
      mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
    },
    environment: "test",
    provider: "mollie",
    sql: sqlFor({
      "FROM billing.billing_subject_bindings": [
        eligibleRow(CONNECTION_A),
        eligibleRow(CONNECTION_A),
      ],
      "WHERE deleted_at IS NULL": [eligibleRow(CONNECTION_B)],
    }),
    subjectId: "user_checkout_aff",
    subjectKind: "user",
    ...(billingConfiguredConnectionOwner(APP_A) ?? {}),
  });
  assert.equal(inspection.state, "resolved");
  if (inspection.state === "resolved") {
    assert.equal(inspection.connection.source, "subject_binding");
    assert.equal(inspection.connection.connectionId, CONNECTION_A);
  }
});

test("CAPS-CONN-013: session subject binding wins over two configured connections", async () => {
  const configured = {
    mollie: {
      credentialKind: "api_key" as const,
      sdk: FetchMollieSdk,
      testKey: "test_default",
    },
    mollieAccounts: {
      eu: {
        accessToken: "access_eu",
        credentialKind: "advanced_access_token" as const,
        sdk: FetchMollieSdk,
        testKey: "test_eu",
      },
    },
  };
  const sql: BillingSqlExecutor = {
    async query(text) {
      if (text.includes("FROM billing.billing_subject_bindings")) {
        return {
          rows: [
            eligibleRow(CONNECTION_B, {
              credential_reference: "providers.mollie:eu",
            }),
          ],
        };
      }
      if (text.includes("FROM billing.billing_provider_connections")) {
        return {
          rows: [
            eligibleRow(CONNECTION_A),
            eligibleRow(CONNECTION_B, {
              credential_reference: "providers.mollie:eu",
            }),
          ],
        };
      }
      return { rows: [] };
    },
    async transaction<T>(fn) {
      return fn(sql);
    },
  };
  const runtime = createLocalBillingRuntime({
    applicationId: APP_A,
    configuredProviders: configured,
    invocation: PROCESS_BILLING_INVOCATION,
    registry: createBillingProviderRegistry(configured, catalog),
    selfEnrollmentEnabled: true,
    sql,
    testMode: true,
  });
  const processCaps = await runtime.getCapabilities({ provider: "mollie" });
  assert.equal(processCaps.connected, false);
  assert.equal(processCaps.connectionId, undefined);
  assert.equal(processCaps.credentials?.credentialKind, "api_key");
  assert.equal(
    processCaps.operations["self.checkout.create"]?.reason,
    "provider_connection_ambiguous",
  );
  const sessionCaps = (await runtime.execute(
    "getCapabilities",
    { provider: "mollie" },
    {
      authenticated: true,
      grants: [],
      rights: [...PROCESS_OWNED_BILLING_PRINCIPAL.rights],
      userId: "user_eu",
    },
  )) as Awaited<ReturnType<typeof runtime.getCapabilities>>;
  assert.equal(sessionCaps.connected, true);
  assert.equal(sessionCaps.connectionId, CONNECTION_B);
  assert.equal(
    sessionCaps.credentials?.credentialKind,
    "advanced_access_token",
  );
  assert.equal(sessionCaps.operations["self.checkout.create"]?.available, true);
});

function mockGatewayTransport(): AthenaGatewayClient {
  const ok = async () =>
    ({
      count: null,
      data: [],
      error: null,
      ok: true,
      raw: { data: [] },
      status: 200,
      statusText: "OK",
    }) as never;
  return {
    baseUrl: "https://athena.local/postgres-direct",
    buildHeaders() {
      return {};
    },
    deleteGateway: ok,
    fetchGateway: ok,
    insertGateway: ok,
    queryGateway: ok,
    async resolveCallOptions(options) {
      return options;
    },
    rpcGateway: ok,
    updateGateway: ok,
    async verifyConnection() {
      return { ok: true } as never;
    },
  };
}

function postgresRuntimeForSql(sql: BillingSqlExecutor): AthenaPostgresRuntime {
  const runtime: AthenaPostgresRuntime = {
    ownership: "owned",
    close: async () => undefined,
    getPool: async () => {
      throw new Error("unused pool");
    },
    getPoolManager: async () => {
      throw new Error("unused pool manager");
    },
    inspectPool: async () => ({
      idleCount: 0,
      totalCount: 0,
      waitingCount: 0,
    }),
    query: async (text, values) => {
      const result = await sql.query(text, values ?? []);
      return {
        command: "SELECT",
        fields: [],
        oid: 0,
        rowCount: result.rows.length,
        rows: result.rows as never,
      };
    },
    transaction: async (fn) => fn(runtime),
  };
  return runtime;
}

test("AUTO-CONN-011: createClient bootstrap materializes owner connection then checkout", async () => {
  const ledger = connectionLedger();
  const sessions: Record<string, unknown>[] = [];
  const lines: Record<string, unknown>[] = [];
  const sql: BillingSqlExecutor = {
    async query(text, params = []) {
      const compact = text.replace(/\s+/g, " ");
      if (compact.includes("FROM billing.billing_subscriptions")) {
        return { rows: [] };
      }
      if (compact.includes("FROM billing.billing_payments")) {
        return {
          rows: [
            {
              connection_id: null,
              provider_customer_id: "cst_hist",
            },
          ],
        };
      }
      if (compact.includes("FROM billing.billing_subject_bindings")) {
        return { rows: [] };
      }
      if (compact.includes("INSERT INTO billing.billing_checkout_sessions")) {
        const metadata = JSON.parse(String(params[11] ?? "{}"));
        const row = {
          checkout_url: params[10],
          connection_id: params[13],
          created_at: new Date().toISOString(),
          id: params[0],
          idempotency_key: params[1],
          kind: params[12],
          metadata,
          price_id: params[4],
          provider: params[5],
          provider_customer_id: params[6],
          provider_payment_id: params[7],
          status: params[9],
          subject_id: params[3],
          subject_kind: params[2],
        };
        sessions.push(row);
        return { rows: [row] };
      }
      if (
        compact.includes("INSERT INTO billing.billing_checkout_session_lines")
      ) {
        lines.push({
          amount_currency: params[4],
          amount_value: params[5],
          checkout_session_id: params[0],
          price_id: params[3],
          product_id: params[2],
          quantity: params[7],
        });
        return { rows: [] };
      }
      if (compact.includes("FROM billing.billing_checkout_session_lines")) {
        return { rows: lines };
      }
      if (compact.includes("UPDATE billing.billing_checkout_sessions")) {
        const row = sessions[0];
        if (row) {
          row.status = params[1] ?? row.status;
          row.checkout_url = params[2] ?? row.checkout_url;
          row.provider_payment_id = params[4] ?? row.provider_payment_id;
        }
        return { rows: row ? [row] : [] };
      }
      return ledger.sql.query(text, params);
    },
    async transaction<T>(fn) {
      return fn(sql);
    },
  };
  const transport = mockGatewayTransport();
  bindPostgresRuntime(transport, postgresRuntimeForSql(sql));
  const athena = createClient({
    app: { id: APP_A, url: "https://app.example" },
    billing: {
      catalog,
      ingestion: { webhooks: false },
      mode: "local",
      providers: { mollie: { sdk: FetchMollieSdk, testKey: "test_boot" } },
      selfEnrollment: true,
      testMode: true,
    },
    gatewayTransport: transport,
    key: "ak_test",
    url: "https://athena.example.com",
  });
  assert.equal(ledger.rows.length, 0);
  const capabilities = await athena.billing.getCapabilities({
    provider: "mollie",
  });
  assert.equal(ledger.rows.length, 1);
  assert.equal(ledger.rows[0]?.owner_id, APP_A);
  assert.equal(ledger.rows[0]?.status, "active");
  assert.equal(capabilities.connected, true);
  assert.equal(capabilities.connectionId, ledger.rows[0]?.id);
  assert.equal(
    capabilities.operations["self.checkout.create"]?.available,
    true,
  );
  const events = getAthenaClientInternals(athena)?.billingBootstrapEvents ?? [];
  assert.ok(
    events.indexOf(BILLING_BOOTSTRAP_EVENT.connectionMaterialized) >= 0,
  );
  const { payments, registry } = checkoutRuntime();
  const checkout = await createSelfCheckout({
    allowedRedirectOrigins: ["https://app.example"],
    applicationId: APP_A,
    configuredProviders: {
      mollie: { sdk: FetchMollieSdk, testKey: "test_boot" },
    },
    idempotencyKey: "chk-boot-011",
    priceId: "starter-once",
    principal: principal(),
    registry,
    sql,
    successUrl: "https://app.example/settings/billing",
  });
  assert.equal(payments.length, 1);
  assert.equal(checkout.provider, "mollie");
  assert.equal(sessions[0]?.connection_id, ledger.rows[0]?.id);
});

test("AUTO-CONN-RECOVERY-E2E: failed bootstrap retry restores the full runtime", async () => {
  const ledger = connectionLedger();
  let failInitialMaterialization = true;
  const sql: BillingSqlExecutor = {
    async query(text, params = []) {
      if (
        failInitialMaterialization &&
        text.includes("ON CONFLICT") &&
        text.includes("RETURNING")
      ) {
        failInitialMaterialization = false;
        throw new Error("initial materialization failed");
      }
      return ledger.sql.query(text, params);
    },
    async transaction<T>(fn) {
      return fn(sql);
    },
  };
  const transport = mockGatewayTransport();
  bindPostgresRuntime(transport, postgresRuntimeForSql(sql));
  const applicationId = `retry-${randomUUID()}`;
  const athena = createClient({
    app: { id: applicationId, url: "https://app.example" },
    billing: {
      catalog,
      ingestion: { webhooks: false },
      mode: "local",
      providers: { mollie: { sdk: FetchMollieSdk, testKey: "test_retry" } },
      selfEnrollment: { enabled: true, planChange: true },
      testMode: true,
    },
    gatewayTransport: transport,
    key: "ak_test",
    url: "https://athena.example.com",
  });

  const failed = await athena.billing.getCapabilities({
    provider: "mollie",
  });
  assert.equal(failed.initialized, false);
  assert.equal(failed.diagnostics?.initializationFailed, true);
  assert.equal(ledger.rows.length, 0);

  const recovered = await athena.billing.admin.bootstrap.retry();
  assert.equal(recovered.phase, "ready");
  assert.equal(ledger.rows.length, 1);
  assert.equal(ledger.rows[0]?.owner_id, applicationId);
  assert.equal(
    getAthenaClientInternals(athena)?.billingSchedulerHandles?.length,
    1,
  );
  await getAthenaClientInternals(athena)?.runtimeReadiness?.waitFor("billing");

  const capabilities = await athena.billing.getCapabilities({
    provider: "mollie",
  });
  assert.equal(capabilities.initialized, true);
  assert.equal(capabilities.connected, true);

  await athena.billing.admin.bootstrap.retry();
  assert.equal(
    getAthenaClientInternals(athena)?.billingSchedulerHandles?.length,
    1,
  );
});

test("AUTO-CONN-RECOVERY-HMR: joined bindings project shared recovery locally", async () => {
  const ledger = connectionLedger();
  let failInitialMaterialization = true;
  const sql: BillingSqlExecutor = {
    async query(text, params = []) {
      if (
        failInitialMaterialization &&
        text.includes("ON CONFLICT") &&
        text.includes("RETURNING")
      ) {
        failInitialMaterialization = false;
        throw new Error("initial materialization failed");
      }
      return ledger.sql.query(text, params);
    },
    async transaction<T>(fn) {
      return fn(sql);
    },
  };
  const transport = mockGatewayTransport();
  bindPostgresRuntime(transport, postgresRuntimeForSql(sql));
  const applicationId = `retry-hmr-${randomUUID()}`;
  const config = {
    app: { id: applicationId, url: "https://app.example" },
    billing: {
      catalog,
      ingestion: { webhooks: false },
      mode: "local" as const,
      providers: { mollie: { sdk: FetchMollieSdk, testKey: "test_retry" } },
      selfEnrollment: { enabled: true, planChange: true },
      testMode: true,
    },
    gatewayTransport: transport,
    key: "ak_test",
    url: "https://athena.example.com",
  };
  const first = createClient(config);
  const firstFailed = await first.billing.getCapabilities({
    provider: "mollie",
  });
  assert.equal(firstFailed.initialized, false);
  const second = createClient(config);
  const secondFailed = await second.billing.getCapabilities({
    provider: "mollie",
  });
  assert.equal(secondFailed.initialized, false);

  await Promise.all([
    first.billing.admin.bootstrap.retry(),
    second.billing.admin.bootstrap.retry(),
  ]);

  const [firstCapabilities, secondCapabilities] = await Promise.all([
    first.billing.getCapabilities({ provider: "mollie" }),
    second.billing.getCapabilities({ provider: "mollie" }),
  ]);
  assert.equal(firstCapabilities.initialized, true);
  assert.equal(secondCapabilities.initialized, true, JSON.stringify(secondCapabilities));
  assert.equal(firstCapabilities.connected, true);
  assert.equal(secondCapabilities.connected, true);
  assert.equal(
    (getAthenaClientInternals(first)?.billingSchedulerHandles?.length ?? 0) +
      (getAthenaClientInternals(second)?.billingSchedulerHandles?.length ?? 0),
    1,
  );
  const secondInternals = getAthenaClientInternals(second);
  const surfaces = peekEmbeddedBillingRuntimeSurfaces(
    secondInternals?.billingRuntimeOwnerKey,
  );
  assert.ok(
    surfaces?.dispatch === getAthenaClientInternals(first)?.billingRuntime ||
      surfaces?.dispatch === secondInternals?.billingRuntime,
  );
});
