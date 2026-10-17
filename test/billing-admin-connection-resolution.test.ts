import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AthenaBillingAuthorizationError,
} from "../src/billing/errors.ts";
import { inspectBillingAdminConnectionAffinity } from "../src/billing/runtime/admin/connection-affinity.ts";
import { executeAdminBillingOperation } from "../src/billing/runtime/admin/execute.ts";
import { BillingProviderRegistry } from "../src/billing/runtime/local/providers/registry.ts";
import { PROCESS_BILLING_INVOCATION } from "../src/billing/runtime/invocation-authority.ts";
import {
  denyBillingInvocation,
  PROCESS_OWNED_BILLING_PRINCIPAL,
} from "../src/billing/runtime/rights.ts";
import { parseAthenaRightKey } from "../src/rights/key.ts";
import type { BillingSqlExecutor } from "../src/billing/subject/repository.ts";
import { FetchMollieSdk } from "./helpers/fetch-mollie-sdk.ts";

test("session Billing admins can verify webhooks with the dedicated write right", () => {
  const denied = denyBillingInvocation(
    {
      authenticated: true,
      grants: [],
      organizationId: "org-1",
      rights: [parseAthenaRightKey("billing.admin.webhooks.write")],
      userId: "operator-1",
    },
    "admin.webhooks.verify",
  );

  assert.equal(denied, undefined);
  const missingRight = denyBillingInvocation(
    {
      authenticated: true,
      grants: [],
      organizationId: "org-1",
      rights: [],
      userId: "operator-1",
    },
    "admin.webhooks.verify",
  );
  assert.ok(missingRight instanceof AthenaBillingAuthorizationError);
  assert.deepEqual(missingRight.missing.map(String), ["billing.admin.webhooks.write"]);
});

test("webhook verification rejects an explicit connection owned by another app", async () => {
  const statements: string[] = [];
  const sql: BillingSqlExecutor = {
    async query(statement) {
      statements.push(statement);
      return {
        rows: statement.includes("billing_provider_connections")
          ? [{ owner_id: "other-app", owner_kind: "tenant" }]
          : [],
      };
    },
  };

  await assert.rejects(
    executeAdminBillingOperation({
      authority: PROCESS_BILLING_INVOCATION,
      operation: "admin.webhooks.verify",
      options: {
        applicationId: "app-a",
        ingestion: { webhooks: false },
        registry: new BillingProviderRegistry(),
        sql,
        testMode: true,
      },
      payload: { connectionId: "00000000-0000-0000-0000-000000000002" },
      principal: {
        authenticated: true,
        grants: [],
        organizationId: "org-1",
        rights: [parseAthenaRightKey("billing.admin.webhooks.write")],
        userId: "operator-1",
      },
    }),
    (error: unknown) => error instanceof AthenaBillingAuthorizationError,
  );

  assert.equal(
    statements.some((statement) => /billing_webhook_registrations/i.test(statement)),
    false,
  );
});

test("process-authorized admin operations can address an explicit organization connection", async () => {
  const sql: BillingSqlExecutor = {
    async query(statement) {
      if (statement.includes("SELECT owner_id, owner_kind")) {
        return { rows: [{ owner_id: "org-other", owner_kind: "organization" }] };
      }
      if (statement.includes("WHERE id = $1::uuid")) {
        return {
          rows: [
            {
              credential_reference: "providers.mollie",
              environment: "test",
              id: "00000000-0000-0000-0000-000000000003",
              owner_id: "org-other",
              owner_kind: "organization",
              provider: "mollie",
              status: "active",
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  const inspection = await inspectBillingAdminConnectionAffinity({
    applicationId: "app-a",
    configuredProviders: {
      mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
    },
    explicitConnectionId: "00000000-0000-0000-0000-000000000003",
    operation: "admin.webhooks.verify",
    principal: PROCESS_OWNED_BILLING_PRINCIPAL,
    provider: "mollie",
    sql,
    testMode: true,
  });

  assert.equal(inspection.state, "resolved");
  if (inspection.state === "resolved") {
    assert.equal(inspection.connection.connectionId, "00000000-0000-0000-0000-000000000003");
  }
});

test("session affinity accepts canonical organization ownership and does not alias org", async () => {
  for (const ownerKind of ["organization", "org"] as const) {
    const sql: BillingSqlExecutor = {
      async query(statement, params) {
        if (statement.startsWith("SELECT 1")) return { rows: [] };
        if (statement.includes("SELECT owner_id, owner_kind")) {
          return {
            rows: [{ owner_id: "org-1", owner_kind: "organization" }],
          };
        }
        if (
          statement.includes("FROM billing.billing_provider_connections") &&
          params?.[2] === "org-1"
        ) {
          return {
            rows: [
              {
                credential_reference: "providers.mollie",
                environment: "test",
                id: "00000000-0000-0000-0000-000000000009",
                owner_id: "org-1",
                owner_kind: ownerKind,
                provider: "mollie",
                status: "active",
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const inspection = await inspectBillingAdminConnectionAffinity({
      applicationId: "app-a",
      configuredProviders: {
        mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
      },
      operation: "admin.webhooks.status",
      principal: {
        authenticated: true,
        grants: [],
        organizationId: "org-1",
        rights: [parseAthenaRightKey("billing.admin.webhooks.read")],
        userId: "operator-1",
      },
      provider: "mollie",
      sql,
      testMode: true,
    });

    assert.equal(inspection.state, ownerKind === "organization" ? "resolved" : "missing");
  }
});

test("session subject bindings cannot escape the active organization and app scopes", async () => {
  const sql: BillingSqlExecutor = {
    async query(statement) {
      if (statement.startsWith("SELECT 1")) return { rows: [{ exists: 1 }] };
      if (statement.includes("FROM billing.billing_subject_bindings b")) {
        return {
          rows: [
            {
              credential_reference: "providers.mollie",
              environment: "test",
              id: "00000000-0000-0000-0000-000000000004",
              owner_id: "other-app",
              owner_kind: "tenant",
              provider: "mollie",
              status: "active",
            },
          ],
        };
      }
      if (statement.includes("SELECT owner_id, owner_kind")) {
        return { rows: [{ owner_id: "other-app", owner_kind: "tenant" }] };
      }
      return { rows: [] };
    },
  };

  await assert.rejects(
    inspectBillingAdminConnectionAffinity({
      applicationId: "app-a",
      configuredProviders: {
        mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
      },
      operation: "admin.webhooks.status",
      principal: {
        authenticated: true,
        grants: [],
        organizationId: "org-1",
        rights: [parseAthenaRightKey("billing.admin.webhooks.read")],
        userId: "operator-1",
      },
      provider: "mollie",
      sql,
      testMode: true,
    }),
    (error: unknown) => error instanceof AthenaBillingAuthorizationError,
  );
});

test("explicit provider and environment mismatches cannot fall back to a subject binding", async () => {
  for (const mismatch of [
    {
      environment: "live",
      provider: "mollie",
      credentialReference: "providers.mollie",
    },
    {
      environment: "test",
      provider: "stripe",
      credentialReference: "providers.stripe",
    },
  ] as const) {
    const statements: string[] = [];
    const sql: BillingSqlExecutor = {
      async query(statement) {
        statements.push(statement);
        if (statement.includes("SELECT owner_id, owner_kind")) {
          return { rows: [{ owner_id: "app-a", owner_kind: "tenant" }] };
        }
        if (statement.includes("WHERE id = $1::uuid")) {
          return {
            rows: [
              {
                credential_reference: mismatch.credentialReference,
                environment: mismatch.environment,
                id: "00000000-0000-0000-0000-000000000007",
                owner_id: "app-a",
                owner_kind: "tenant",
                provider: mismatch.provider,
                status: "active",
              },
            ],
          };
        }
        if (statement.startsWith("SELECT 1")) return { rows: [{ exists: 1 }] };
        if (statement.includes("FROM billing.billing_subject_bindings b")) {
          return {
            rows: [
              {
                credential_reference: "providers.mollie",
                environment: "test",
                id: "00000000-0000-0000-0000-000000000008",
                owner_id: "app-a",
                owner_kind: "tenant",
                provider: "mollie",
                status: "active",
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const inspection = await inspectBillingAdminConnectionAffinity({
      applicationId: "app-a",
      configuredProviders: {
        mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
        stripe: { testKey: "test_stripe" },
      },
      explicitConnectionId: "00000000-0000-0000-0000-000000000007",
      operation: "admin.webhooks.status",
      principal: {
        authenticated: true,
        grants: [],
        organizationId: "org-1",
        rights: [parseAthenaRightKey("billing.admin.webhooks.read")],
        userId: "operator-1",
      },
      provider: "mollie",
      sql,
      testMode: true,
    });

    assert.deepEqual(inspection, { state: "missing" });
    assert.equal(
      statements.some((statement) =>
        statement.includes("FROM billing.billing_subject_bindings b"),
      ),
      false,
    );
  }
});

test("webhook status fails closed when two configured connections match", async () => {
  const sql: BillingSqlExecutor = {
    async query(statement, params) {
      if (statement.includes("SELECT 1")) return { rows: [] };
      if (
        statement.includes("FROM billing.billing_provider_connections") &&
        params?.[2] === "app-a"
      ) {
        return {
          rows: [
            {
              credential_reference: "providers.mollie",
              environment: "test",
              id: "00000000-0000-0000-0000-000000000005",
              owner_id: "app-a",
              owner_kind: "tenant",
              provider: "mollie",
              status: "active",
            },
            {
              credential_reference: "providers.mollie",
              environment: "test",
              id: "00000000-0000-0000-0000-000000000006",
              owner_id: "app-a",
              owner_kind: "tenant",
              provider: "mollie",
              status: "active",
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  await assert.rejects(
    executeAdminBillingOperation({
      authority: PROCESS_BILLING_INVOCATION,
      operation: "admin.webhooks.status",
      options: {
        applicationId: "app-a",
        configuredProviders: {
          mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
        },
        ingestion: { webhooks: false },
        registry: new BillingProviderRegistry(),
        sql,
        testMode: true,
      },
      payload: {},
      principal: {
        authenticated: true,
        grants: [],
        organizationId: "org-1",
        rights: [parseAthenaRightKey("billing.admin.webhooks.read")],
        userId: "operator-1",
      },
    }),
    (error: unknown) =>
      error instanceof Error &&
      "reason" in error &&
      error.reason === "provider_connection_ambiguous",
  );
  await assert.rejects(
    executeAdminBillingOperation({
      authority: PROCESS_BILLING_INVOCATION,
      operation: "admin.ingestion.health",
      options: {
        applicationId: "app-a",
        configuredProviders: {
          mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
        },
        ingestion: { webhooks: false },
        registry: new BillingProviderRegistry(),
        sql,
        testMode: true,
      },
      payload: {},
      principal: {
        authenticated: true,
        grants: [],
        organizationId: "org-1",
        rights: [parseAthenaRightKey("billing.admin.ingestion.read")],
        userId: "operator-1",
      },
    }),
    (error: unknown) =>
      error instanceof Error &&
      "reason" in error &&
      error.reason === "provider_connection_ambiguous",
  );
});

test("an explicit admin connection remains selected when the user has another active binding", async () => {
  const explicitConnectionId = "00000000-0000-0000-0000-000000000021";
  const boundConnectionId = "00000000-0000-0000-0000-000000000022";
  const sql: BillingSqlExecutor = {
    async query(statement, params) {
      if (statement.startsWith("SELECT owner_id, owner_kind")) {
        return { rows: [{ owner_id: "app-a", owner_kind: "tenant" }] };
      }
      if (statement.includes("SELECT id::text AS id, owner_id, owner_kind")) {
        const id = params?.[0] === explicitConnectionId ? explicitConnectionId : boundConnectionId;
        return {
          rows: [{
            credential_reference: "providers.mollie",
            environment: "test",
            id,
            owner_id: "app-a",
            owner_kind: "tenant",
            provider: "mollie",
            status: "active",
          }],
        };
      }
      if (statement.startsWith("SELECT 1")) return { rows: [{ exists: 1 }] };
      if (statement.includes("FROM billing.billing_subject_bindings b")) {
        return {
          rows: [{
            credential_reference: "providers.mollie",
            environment: "test",
            id: boundConnectionId,
            owner_id: "app-a",
            owner_kind: "tenant",
            provider: "mollie",
            status: "active",
          }],
        };
      }
      return { rows: [] };
    },
  };

  const inspection = await inspectBillingAdminConnectionAffinity({
    applicationId: "app-a",
    configuredProviders: { mollie: { sdk: FetchMollieSdk, testKey: "test_aff" } },
    explicitConnectionId,
    operation: "admin.webhooks.verify",
    principal: {
      authenticated: true,
      grants: [],
      organizationId: "org-1",
      rights: [parseAthenaRightKey("billing.admin.webhooks.write")],
      userId: "operator-1",
    },
    provider: "mollie",
    sql,
    testMode: true,
  });

  assert.equal(inspection.state, "resolved");
  if (inspection.state === "resolved") {
    assert.equal(inspection.connection.connectionId, explicitConnectionId);
  }
});

test("a binding for another provider does not suppress configured admin fallback", async () => {
  const statements: string[] = [];
  const sql: BillingSqlExecutor = {
    async query(statement, params) {
      statements.push(statement);
      if (statement.startsWith("SELECT owner_id, owner_kind")) {
        return { rows: [{ owner_id: "app-a", owner_kind: "tenant" }] };
      }
      if (statement.startsWith("SELECT 1")) return { rows: [] };
      if (statement.includes("FROM billing.billing_provider_connections")) {
        return params?.[2] === "app-a"
          ? {
              rows: [{
                credential_reference: "providers.mollie",
                environment: "test",
                id: "00000000-0000-0000-0000-000000000023",
                owner_id: "app-a",
                owner_kind: "tenant",
                provider: "mollie",
                status: "active",
              }],
            }
          : { rows: [] };
      }
      return { rows: [] };
    },
  };

  const inspection = await inspectBillingAdminConnectionAffinity({
    applicationId: "app-a",
    configuredProviders: {
      mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
      stripe: { testKey: "test_stripe" },
    },
    operation: "admin.webhooks.status",
    principal: {
      authenticated: true,
      grants: [],
      organizationId: "org-1",
      rights: [parseAthenaRightKey("billing.admin.webhooks.read")],
      userId: "operator-1",
    },
    provider: "mollie",
    sql,
    testMode: true,
  });

  assert.equal(inspection.state, "resolved");
  if (inspection.state === "resolved") {
    assert.equal(inspection.connection.connectionId, "00000000-0000-0000-0000-000000000023");
  }
  assert.ok(statements.some((statement) => statement.includes("c.provider = $3")));
});
