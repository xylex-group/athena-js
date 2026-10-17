import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../../src/auth/contract/index.ts";
import { createPostgresAuthDatabase } from "../../src/auth/local/database.ts";
import { migrateAthenaAuthSchema } from "../../src/auth/local/schema.ts";

import {
  AthenaBillingAuthorizationError,
  AthenaBillingCapabilityError,
} from "../../src/billing/errors.ts";
import { executeAdminBillingOperation } from "../../src/billing/runtime/admin/execute.ts";
import { listBillingInventory } from "../../src/billing/runtime/admin/inventory-query.ts";
import { BillingProviderRegistry } from "../../src/billing/runtime/local/providers/registry.ts";
import { materializeConfiguredBillingConnections } from "../../src/billing/runtime/local/connections/materialize.ts";
import {
  PROCESS_BILLING_INVOCATION,
  SESSION_BILLING_INVOCATION,
} from "../../src/billing/runtime/invocation-authority.ts";
import { createAthenaNextHandlers } from "../../src/next/data-handlers.ts";
import { createClient } from "../../src/v3-client.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";
import type { AthenaPrincipal } from "../../src/runtime/data/principal.ts";
import type { BillingSqlExecutor } from "../../src/billing/subject/repository.ts";
import {
  EMBEDDED_BILLING_LEDGER,
  EMBEDDED_BILLING_MIGRATIONS,
} from "../../src/migrations/embedded-billing/catalog.ts";
import { applyEmbeddedSqlMigrations } from "../../src/migrations/embedded-sql-apply.ts";
import { createPostgresPool } from "../../src/postgres/driver.ts";
import { createPostgresPoolManager } from "../../src/postgres/pool/manager.ts";
import { FetchMollieSdk } from "../helpers/fetch-mollie-sdk.ts";

const silentUi = { info() {} } as never;

function sessionPrincipal(
  organizationId: string,
  rights: string[],
  userId = `operator-${organizationId}`,
): AthenaPrincipal {
  return {
    authenticated: true,
    grants: [],
    organizationId,
    rights: rights.map(parseAthenaRightKey),
    userId,
  };
}

function billingSql(pool: Awaited<ReturnType<typeof createPostgresPool>>): BillingSqlExecutor {
  return {
    async query(statement, params = []) {
      const result = await pool.query(statement, [...params]);
      return { rows: result.rows as Record<string, unknown>[] };
    },
    async transaction(fn) {
      const client = await pool.connect();
      await client.query("BEGIN");
      const transactionSql: BillingSqlExecutor = {
        async query(statement, params = []) {
          const result = await client.query(statement, [...params]);
          return { rows: result.rows as Record<string, unknown>[] };
        },
      };
      try {
        const result = await fn(transactionSql);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

test("P?: embedded Billing admin affinity resolves tenant connections without crossing organization rows", async (t) => {
  const connectionString = process.env.ATHENA_BILLING_FINALITY_DATABASE_URL?.trim();
  if (!connectionString) {
    t.skip("ATHENA_BILLING_FINALITY_DATABASE_URL must point to a disposable PostgreSQL database");
    return;
  }
  if (
    connectionString.includes("neon.tech") &&
    process.env.ATHENA_BILLING_ISOLATION_PG !== "1"
  ) {
    t.skip("refusing Neon DATABASE_URL without ATHENA_BILLING_ISOLATION_PG=1");
    return;
  }

  const pool = await createPostgresPool(connectionString, { max: 2, min: 0 });
  const manager = createPostgresPoolManager({ ownership: "borrowed", pool });
  const sql = billingSql(pool);
  const applicationId = `billing-admin-${randomUUID()}`;
  const ambiguousApplicationId = `billing-admin-ambiguous-${randomUUID()}`;
  const foreignApplicationId = `billing-admin-foreign-${randomUUID()}`;
  const organizationId = `billing-admin-org-${randomUUID()}`;
  const otherOrganizationId = `${organizationId}-other`;
  const operatorUserId = `billing-admin-operator-${randomUUID()}`;
  const memberUserId = `billing-admin-member-${randomUUID()}`;
  const otherMemberUserId = `billing-admin-other-member-${randomUUID()}`;
  const outsiderUserId = `billing-admin-outsider-${randomUUID()}`;
  const configuredProviders = {
    mollie: { sdk: FetchMollieSdk, testKey: "test_affinity" },
  };
  let closeClient: (() => Promise<void>) | undefined;

  try {
    await applyEmbeddedSqlMigrations({
      ledgerTable: EMBEDDED_BILLING_LEDGER,
      manager,
      migrations: EMBEDDED_BILLING_MIGRATIONS,
      ui: silentUi,
    });

    const authDatabase = await createPostgresAuthDatabase(connectionString);
    try {
      await migrateAthenaAuthSchema(authDatabase);
    } finally {
      await authDatabase.close?.();
    }
    await pool.query(
      `INSERT INTO athena.organization (id, name, slug) VALUES
         ($1, 'Billing fixture A', $2),
         ($3, 'Billing fixture B', $4)
       ON CONFLICT (id) DO NOTHING`,
      [organizationId, `${applicationId}-org-a`, otherOrganizationId, `${applicationId}-org-b`],
    );
    await pool.query(
      `INSERT INTO athena.users (id, name, email) VALUES
         ($1, 'Billing operator', $2),
         ($3, 'Organization A member', $4),
         ($5, 'Organization B member', $6),
         ($7, 'Unrelated user', $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        operatorUserId,
        `${operatorUserId}@example.invalid`,
        memberUserId,
        `${memberUserId}@example.invalid`,
        otherMemberUserId,
        `${otherMemberUserId}@example.invalid`,
        outsiderUserId,
        `${outsiderUserId}@example.invalid`,
      ],
    );
    await pool.query(
      `INSERT INTO athena.member (id, organization_id, user_id) VALUES
         ($1, $2, $3),
         ($4, $2, $5),
         ($6, $7, $8),
         ($9, $7, $5),
         ($10, $7, $3)
       ON CONFLICT (organization_id, user_id) DO NOTHING`,
      [
        `member-operator-${applicationId}`,
        organizationId,
        operatorUserId,
        `member-a-${applicationId}`,
        memberUserId,
        `member-b-${applicationId}`,
        otherOrganizationId,
        otherMemberUserId,
        `member-a-in-b-${applicationId}`,
        `member-operator-b-${applicationId}`,
      ],
    );

    const materialized = await materializeConfiguredBillingConnections({
      applicationId,
      configuredProviders,
      sql,
      testMode: true,
    });
    assert.equal(materialized.connections.length, 1);
    const connectionId = materialized.connections[0]?.id;
    assert.ok(connectionId);
    const owner = await pool.query(
      `SELECT owner_kind, owner_id
       FROM billing.billing_provider_connections WHERE id = $1::uuid`,
      [connectionId],
    );
    assert.deepEqual(owner.rows[0], {
      owner_id: applicationId,
      owner_kind: "tenant",
    });

    await sql.query(
      `INSERT INTO billing.billing_subscriptions (
         provider, provider_subscription_id, provider_customer_id, status,
         connection_id, subject_kind, subject_id, ownership_status
       ) VALUES
         ('mollie', $1, 'customer-a', 'active', $3::uuid, 'organization', $4, 'resolved'),
         ('mollie', $2, 'customer-b', 'active', $3::uuid, 'organization', $5, 'resolved'),
         ('mollie', $6, 'customer-member-a', 'active', $3::uuid, 'user', $7, 'resolved'),
         ('mollie', $8, 'customer-member-b', 'active', $3::uuid, 'user', $9, 'resolved'),
         ('mollie', $10, 'customer-outsider', 'active', $3::uuid, 'user', $11, 'resolved')`,
      [
        `subscription-a-${applicationId}`,
        `subscription-b-${applicationId}`,
        connectionId,
        organizationId,
        otherOrganizationId,
        `subscription-member-a-${applicationId}`,
        memberUserId,
        `subscription-member-b-${applicationId}`,
        otherMemberUserId,
        `subscription-outsider-${applicationId}`,
        outsiderUserId,
      ],
    );

    const operator = sessionPrincipal(
      organizationId,
      ["billing.admin.inventory.read"],
      operatorUserId,
    );
    const organizationStripe = await pool.query<{ id: string }>(
      `INSERT INTO billing.billing_provider_connections (
         owner_kind, owner_id, provider, mode, environment, status,
         credential_kind, provider_account_id, account_reference,
         credential_reference
       ) VALUES (
         'organization', $1, 'stripe', 'test', 'test', 'active',
         'secret_key', $2, $3, 'providers.stripe'
       ) RETURNING id::text AS id`,
      [organizationId, `acct-${applicationId}`, `org-account-${applicationId}`],
    );
    const organizationConnectionId = organizationStripe.rows[0]?.id;
    assert.ok(organizationConnectionId);
    await sql.query(
      `INSERT INTO billing.billing_subscriptions (
         provider, provider_subscription_id, provider_customer_id, status,
         connection_id, subject_kind, subject_id, ownership_status
       ) VALUES ('stripe', $1, 'stripe-customer-a', 'active', $2::uuid,
                 'user', 'user-a', 'resolved')`,
      [`org-owned-user-subscription-${applicationId}`, organizationConnectionId],
    );
    const inventory = await listBillingInventory({
      applicationId,
      configuredProviders: {
        ...configuredProviders,
        stripe: { testKey: "sk_test_affinity" },
      },
      principal: operator,
      presetId: "subscriptions",
      sql,
      testMode: true,
    });
    assert.equal(inventory.totalItems, 2);
    assert.deepEqual(
      inventory.rows
        .map((row) => row.provider_subscription_id)
        .sort(),
      [
        `org-owned-user-subscription-${applicationId}`,
        `subscription-a-${applicationId}`,
      ].sort(),
    );

    await pool.query(
      `INSERT INTO billing.billing_invoices (
         provider, provider_invoice_id, status, connection_id,
         subject_kind, subject_id, ownership_status
       ) VALUES
         ('mollie', $1, 'paid', $6::uuid, 'organization', $2, 'resolved'),
         ('mollie', $3, 'paid', $6::uuid, 'organization', $4, 'resolved'),
         ('mollie', $5, 'paid', $6::uuid, 'user', $7, 'resolved'),
         ('mollie', $8, 'paid', $6::uuid, 'user', $9, 'resolved'),
         ('mollie', $10, 'paid', $6::uuid, 'user', $11, 'resolved')`,
      [
        `invoice-org-a-${applicationId}`,
        organizationId,
        `invoice-org-b-${applicationId}`,
        otherOrganizationId,
        `invoice-member-a-${applicationId}`,
        connectionId,
        memberUserId,
        `invoice-member-b-${applicationId}`,
        otherMemberUserId,
        `invoice-outsider-${applicationId}`,
        outsiderUserId,
      ],
    );
    await pool.query(
      `INSERT INTO billing.billing_payments (
         provider, provider_payment_id, status, amount_currency, amount_value,
         connection_id, subject_kind, subject_id, ownership_status
       ) VALUES
         ('mollie', $1, 'paid', 'EUR', 1, $6::uuid, 'organization', $2, 'resolved'),
         ('mollie', $3, 'paid', 'EUR', 1, $6::uuid, 'organization', $4, 'resolved'),
         ('mollie', $5, 'paid', 'EUR', 1, $6::uuid, 'user', $7, 'resolved'),
         ('mollie', $8, 'paid', 'EUR', 1, $6::uuid, 'user', $9, 'resolved'),
         ('mollie', $10, 'paid', 'EUR', 1, $6::uuid, 'user', $11, 'resolved')`,
      [
        `payment-org-a-${applicationId}`,
        organizationId,
        `payment-org-b-${applicationId}`,
        otherOrganizationId,
        `payment-member-a-${applicationId}`,
        connectionId,
        memberUserId,
        `payment-member-b-${applicationId}`,
        otherMemberUserId,
        `payment-outsider-${applicationId}`,
        outsiderUserId,
      ],
    );
    await pool.query(
      `INSERT INTO billing.billing_checkout_sessions (
         idempotency_key, subject_kind, subject_id, price_id, provider, status, connection_id
       ) VALUES
         ($1, 'organization', $2, 'price-a', 'mollie', 'enrolled', $3),
         ($4, 'organization', $5, 'price-b', 'mollie', 'enrolled', $3)`,
      [`checkout-a-${applicationId}`, organizationId, connectionId, `checkout-b-${applicationId}`, otherOrganizationId],
    );
    await pool.query(
      `INSERT INTO billing.billing_webhook_events (
         connection_id, provider, event_type, document_kind, provider_ref
       ) VALUES ($1::uuid, 'mollie', 'payment.paid', 'payment', $2)`,
      [connectionId, `event-${applicationId}`],
    );
    await pool.query(
      `INSERT INTO billing.billing_projection_events (
         connection_id, provider, event_type, verification_status, projection_status
       ) VALUES ($1::uuid, 'mollie', 'payment.paid', 'verified', 'projected')`,
      [connectionId],
    );
    const importRun = await pool.query<{ id: string }>(
      `INSERT INTO billing.billing_import_runs (
         connection_id, provider, status, trigger
       ) VALUES ($1::uuid, 'mollie', 'completed', 'manual')
       RETURNING id::text AS id`,
      [connectionId],
    );
    const importRunId = importRun.rows[0]?.id;
    assert.ok(importRunId);
    await pool.query(
      `INSERT INTO billing.billing_import_candidates (
         import_run_id, connection_id, provider_customer_id, subject_kind,
         subject_id, confidence, decision, reason
       ) VALUES
         ($1::uuid, $2::uuid, 'candidate-org-a', 'organization', $3, 'strong', 'manual_review', 'fixture'),
         ($1::uuid, $2::uuid, 'candidate-org-b', 'organization', $4, 'strong', 'manual_review', 'fixture'),
         ($1::uuid, $2::uuid, 'candidate-member-a', 'user', $5, 'strong', 'manual_review', 'fixture'),
         ($1::uuid, $2::uuid, 'candidate-member-b', 'user', $6, 'strong', 'manual_review', 'fixture'),
         ($1::uuid, $2::uuid, 'candidate-unassigned', NULL, NULL, 'none', 'manual_review', 'unmatched')`,
      [importRunId, connectionId, organizationId, otherOrganizationId, memberUserId, otherMemberUserId],
    );

    let deniedInventoryQueries = 0;
    await assert.rejects(
      listBillingInventory({
        applicationId,
        configuredProviders,
        principal: sessionPrincipal(organizationId, []),
        presetId: "subscriptions",
        sql: {
          ...sql,
          async query() {
            deniedInventoryQueries += 1;
            throw new Error("inventory SQL ran before the rights check");
          },
        },
        testMode: true,
      }),
      (error: unknown) => error instanceof AthenaBillingAuthorizationError,
    );
    assert.equal(deniedInventoryQueries, 0);

    const registry = new BillingProviderRegistry();
    const adminOptions = {
      applicationId,
      configuredProviders,
      ingestion: { webhooks: false },
      registry,
      sql,
      testMode: true,
    };
    await pool.query(
      `INSERT INTO billing.billing_webhook_registrations (
         connection_id, provider, kind, environment, name, url, status, config_hash
       ) VALUES ($1::uuid, 'mollie', 'classic', 'test', 'classic',
                 'https://hooks.example/api/athena/billing/webhook/mollie/events/secret_ingress_token_123',
                 'active', 'config-hash')`,
      [connectionId],
    );
    const client = createClient({
      app: { id: applicationId, url: "http://localhost" },
      auth: false,
      billing: {
        ingestion: { webhooks: false },
        mode: "local",
        providers: configuredProviders,
        testMode: true,
      },
      databaseUrl: connectionString,
    });
    closeClient = client.close;
    const handlers = createAthenaNextHandlers({
      auth: {
        lookupSession: async (token) => {
          if (
            token !== "operator-session" &&
            token !== "operator-session-b" &&
            token !== "platform-session"
          ) {
            return null;
          }
          const rights = [
            "billing.admin.inventory.read",
            "billing.admin.webhooks.read",
            "billing.admin.webhooks.write",
            "billing.admin.ingestion.read",
            ...(token === "platform-session"
              ? ["billing.admin.inventory.shared.read"]
              : []),
          ];
          return {
            session: {
              activeOrganizationId: token === "operator-session-b" ? otherOrganizationId : organizationId,
              expiresAt: new Date("2099-01-01T00:00:00.000Z"),
              id: `session-${token}`,
              revoked: false,
              userId: operatorUserId,
            },
            user: { id: operatorUserId, rights },
          };
        },
        mode: "athena-session",
      },
      client,
      security: { mode: "trusted" },
      unsafeAllowUnauthenticated: true,
    });
    const invoke = async (
      token: "operator-session" | "operator-session-b" | "platform-session",
      operation: string,
      payload: Record<string, unknown> = {},
    ) => {
      const response = await handlers.billing.POST(
        new Request("http://localhost/api/athena/billing", {
          body: JSON.stringify({ operation, payload }),
          headers: {
            "content-type": "application/json",
            cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=${token}`,
            origin: "http://localhost",
          },
          method: "POST",
        }),
      );
      const body = (await response.json()) as { data?: unknown; error?: unknown };
      assert.equal(response.status, 200, JSON.stringify(body));
      return body.data as Record<string, unknown>;
    };

    const expectedInventoryItems: Record<string, number> = {
      invoices: 1,
      payments: 1,
      subscriptions: 1,
      checkouts: 1,
      connections: 2,
      webhookEvents: 0,
      projectionEvents: 0,
      importRuns: 0,
      importCandidates: 1,
      webhookRegistrations: 0,
    };
    for (const presetId of [
      "invoices",
      "payments",
      "subscriptions",
      "checkouts",
      "connections",
      "webhookEvents",
      "projectionEvents",
      "importRuns",
      "importCandidates",
      "webhookRegistrations",
    ]) {
      const inventory = await invoke("operator-session", "admin.inventory.list", {
        page: 1,
        pageSize: 100,
        presetId,
      });
      assert.equal(
        inventory.totalItems,
        expectedInventoryItems[presetId],
        `${presetId} inventory scope`,
      );
    }
    const expectedOrganizationRows = {
      invoices: [
        [`invoice-org-a-${applicationId}`, `invoice-org-b-${applicationId}`],
        "provider_invoice_id",
      ],
      payments: [
        [`payment-org-a-${applicationId}`, `payment-org-b-${applicationId}`],
        "provider_payment_id",
      ],
      subscriptions: [
        [`subscription-a-${applicationId}`, `subscription-b-${applicationId}`],
        "provider_subscription_id",
      ],
    } as const;
    for (const presetId of ["invoices", "payments", "subscriptions"] as const) {
      const [, rowKey] = expectedOrganizationRows[presetId];
      for (const [token, organizationIndex] of [
        ["operator-session", 0],
        ["operator-session-b", 1],
      ] as const) {
        const inventory = await invoke(token, "admin.inventory.list", {
          page: 1,
          pageSize: 100,
          presetId,
        });
        assert.deepEqual(
          (inventory.rows as Record<string, string>[]).map((row) => row[rowKey]),
          [expectedOrganizationRows[presetId][0][organizationIndex]],
          `${presetId} keeps user-owned rows hidden for ${token}`,
        );
      }
    }
    const organizationBInventoryItems: Record<string, number> = {
      checkouts: 1,
      connections: 1,
      importCandidates: 1,
      importRuns: 0,
      invoices: 1,
      payments: 1,
      projectionEvents: 0,
      subscriptions: 1,
      webhookEvents: 0,
      webhookRegistrations: 0,
    };
    for (const [presetId, expectedItems] of Object.entries(organizationBInventoryItems)) {
      const inventory = await invoke("operator-session-b", "admin.inventory.list", {
        page: 1,
        pageSize: 100,
        presetId,
      });
      assert.equal(inventory.totalItems, expectedItems, `${presetId} Organization B scope`);
    }
    const sharedEvents = await invoke("platform-session", "admin.inventory.list", {
      page: 1,
      pageSize: 100,
      presetId: "webhookEvents",
    });
    assert.equal(sharedEvents.totalItems, 1);
    for (const presetId of ["projectionEvents", "importRuns", "webhookRegistrations"]) {
      const sharedInventory = await invoke("platform-session", "admin.inventory.list", {
        page: 1,
        pageSize: 100,
        presetId,
      });
      assert.equal(sharedInventory.totalItems, 1, `${presetId} shared access`);
    }
    const stillScopedSubscriptions = await invoke(
      "platform-session",
      "admin.inventory.list",
      { page: 1, pageSize: 100, presetId: "subscriptions" },
    );
    assert.equal(stillScopedSubscriptions.totalItems, 1);
    const sharedCandidates = await invoke("platform-session", "admin.inventory.list", {
      page: 1,
      pageSize: 100,
      presetId: "importCandidates",
    });
    assert.equal(sharedCandidates.totalItems, 2);
    assert.deepEqual(
      (sharedCandidates.rows as { provider_customer_id: string }[])
        .map((row) => row.provider_customer_id)
        .sort(),
      ["candidate-org-a", "candidate-unassigned"].sort(),
    );

    const webhookStatus = await invoke(
      "operator-session",
      "admin.webhooks.status",
    );
    assert.equal(webhookStatus.connectionId, connectionId);

    const organizationMollie = await pool.query<{ id: string }>(
      `INSERT INTO billing.billing_provider_connections (
         owner_kind, owner_id, provider, mode, environment, status,
         credential_kind, provider_account_id, account_reference,
         credential_reference
       ) VALUES (
         'organization', $1, 'mollie', 'test', 'test', 'active',
         'api_key', $2, $3, 'providers.mollie'
       ) RETURNING id::text AS id`,
      [organizationId, `mollie-account-${applicationId}`, `mollie-org-${applicationId}`],
    );
    const organizationMollieConnectionId = organizationMollie.rows[0]?.id;
    assert.ok(organizationMollieConnectionId);
    await pool.query(
      `INSERT INTO billing.billing_subject_bindings (
         connection_id, subject_kind, subject_id, provider_subject_kind,
         provider_subject_id, status, source
       ) VALUES ($1, 'user', $2, 'customer', $3, 'active', 'created')`,
      [organizationConnectionId, operatorUserId, `stripe-customer-${applicationId}`],
    );
    await pool.query(
      `INSERT INTO billing.billing_subject_bindings (
         connection_id, subject_kind, subject_id, provider_subject_kind,
         provider_subject_id, status, source
       ) VALUES ($1, 'user', $2, 'customer', $3, 'active', 'created')`,
      [organizationMollieConnectionId, operatorUserId, `mollie-customer-${applicationId}`],
    );
    const boundStatus = await invoke(
      "operator-session",
      "admin.webhooks.status",
    );
    assert.equal(boundStatus.connectionId, organizationMollieConnectionId);
    const health = await invoke(
      "operator-session",
      "admin.ingestion.health",
    );
    assert.equal(health.connectionId, organizationMollieConnectionId);
    const verified = await invoke(
      "operator-session",
      "admin.webhooks.verify",
      { connectionId },
    );
    assert.equal(verified.connectionId, connectionId);
    const registration = await pool.query(
      `SELECT last_verified_at
       FROM billing.billing_webhook_registrations WHERE connection_id = $1::uuid`,
      [connectionId],
    );
    assert.ok(registration.rows[0]?.last_verified_at);
    const unrelatedRegistration = await pool.query(
      `SELECT count(*)::int AS total
       FROM billing.billing_webhook_registrations WHERE connection_id = $1::uuid`,
      [organizationMollieConnectionId],
    );
    assert.equal(unrelatedRegistration.rows[0]?.total, 0);

    const ambiguousConfig = {
      mollie: configuredProviders.mollie,
      mollieAccounts: {
        second: { sdk: FetchMollieSdk, testKey: "test_affinity" },
      },
    };
    const ambiguous = await materializeConfiguredBillingConnections({
      applicationId: ambiguousApplicationId,
      configuredProviders: ambiguousConfig,
      sql,
      testMode: true,
    });
    assert.equal(ambiguous.connections.length, 2);
    await assert.rejects(
      executeAdminBillingOperation({
        authority: SESSION_BILLING_INVOCATION,
        operation: "admin.webhooks.status",
        options: { ...adminOptions, applicationId: ambiguousApplicationId, configuredProviders: ambiguousConfig },
        payload: {},
        principal: sessionPrincipal(`${organizationId}-ambiguous`, ["billing.admin.webhooks.read"]),
      }),
      (error: unknown) =>
        error instanceof AthenaBillingCapabilityError &&
        error.reason === "provider_connection_ambiguous",
    );

    const foreign = await materializeConfiguredBillingConnections({
      applicationId: foreignApplicationId,
      configuredProviders,
      sql,
      testMode: true,
    });
    const foreignConnectionId = foreign.connections[0]?.id;
    assert.ok(foreignConnectionId);
    await assert.rejects(
      executeAdminBillingOperation({
        authority: PROCESS_BILLING_INVOCATION,
        operation: "admin.webhooks.verify",
        options: adminOptions,
        payload: { connectionId: foreignConnectionId },
        principal: sessionPrincipal(organizationId, ["billing.admin.webhooks.write"]),
      }),
      (error: unknown) => error instanceof AthenaBillingAuthorizationError,
    );
  } finally {
    await closeClient?.().catch(() => undefined);
    const connectionRows = await pool.query<{ id: string }>(
      `SELECT id::text AS id
       FROM billing.billing_provider_connections
       WHERE owner_id = ANY($1::text[])`,
      [[applicationId, ambiguousApplicationId, foreignApplicationId, organizationId]],
    ).catch(() => ({ rows: [] } as { rows: { id: string }[] }));
    const connectionIds = connectionRows.rows.map((row) => row.id);
    if (connectionIds.length > 0) {
      await pool.query(
        "DELETE FROM billing.billing_import_candidates WHERE connection_id = ANY($1::uuid[])",
        [connectionIds],
      ).catch(() => undefined);
      await pool.query(
        "DELETE FROM billing.billing_import_runs WHERE connection_id = ANY($1::uuid[])",
        [connectionIds],
      ).catch(() => undefined);
      await pool.query(
        "DELETE FROM billing.billing_projection_events WHERE connection_id = ANY($1::uuid[])",
        [connectionIds],
      ).catch(() => undefined);
      await pool.query(
        "DELETE FROM billing.billing_webhook_events WHERE connection_id = ANY($1::uuid[])",
        [connectionIds],
      ).catch(() => undefined);
      await pool.query(
        "DELETE FROM billing.billing_webhook_registrations WHERE connection_id = ANY($1::uuid[])",
        [connectionIds],
      ).catch(() => undefined);
      await pool.query(
        "DELETE FROM billing.billing_checkout_sessions WHERE connection_id = ANY($1::text[])",
        [connectionIds],
      ).catch(() => undefined);
      await pool.query(
        "DELETE FROM billing.billing_invoices WHERE connection_id = ANY($1::uuid[])",
        [connectionIds],
      ).catch(() => undefined);
      await pool.query(
        "DELETE FROM billing.billing_payments WHERE connection_id = ANY($1::uuid[])",
        [connectionIds],
      ).catch(() => undefined);
      await pool.query(
        "DELETE FROM billing.billing_subscriptions WHERE connection_id = ANY($1::uuid[])",
        [connectionIds],
      ).catch(() => undefined);
      await pool.query(
        "DELETE FROM billing.billing_subject_bindings WHERE connection_id = ANY($1::text[])",
        [connectionIds],
      ).catch(() => undefined);
      await pool.query(
        "DELETE FROM billing.billing_provider_connections WHERE id = ANY($1::uuid[])",
        [connectionIds],
      ).catch(() => undefined);
    }
    await pool.query(
      "DELETE FROM athena.member WHERE organization_id = ANY($1::text[])",
      [[organizationId, otherOrganizationId]],
    ).catch(() => undefined);
    await pool.query(
      "DELETE FROM athena.organization WHERE id = ANY($1::text[])",
      [[organizationId, otherOrganizationId]],
    ).catch(() => undefined);
    await pool.query(
      "DELETE FROM athena.users WHERE id = ANY($1::text[])",
      [[operatorUserId, memberUserId, otherMemberUserId, outsiderUserId]],
    ).catch(() => undefined);
    await pool.end();
  }
});
