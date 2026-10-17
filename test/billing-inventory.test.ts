import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  BILLING_INVENTORY_PRESETS,
  getBillingInventoryPreset,
  validateBillingInventoryPage,
} from "../src/billing/runtime/admin/inventory-presets.ts";
import { listBillingInventory } from "../src/billing/runtime/admin/inventory-query.ts";
import { executeAdminBillingOperation } from "../src/billing/runtime/admin/execute.ts";
import { createBrowserBillingTransport } from "../src/billing/runtime/browser-transport.ts";
import { billingOperationPolicy } from "../src/billing/runtime/operation-policy.ts";
import { parseAthenaRightKey } from "../src/rights/key.ts";
import { createAthenaBuiltinRoleDefinitions } from "../src/roles/builtin.ts";
import type { BillingSqlExecutor } from "../src/billing/subject/repository.ts";
import { SESSION_BILLING_INVOCATION } from "../src/billing/runtime/invocation-authority.ts";
import {
  AthenaBillingAuthorizationError,
  AthenaBillingCapabilityError,
} from "../src/billing/errors.ts";
import { FetchMollieSdk } from "./helpers/fetch-mollie-sdk.ts";

const runtimeContext = {
  applicationId: "app-a",
  configuredProviders: {
    mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
  },
  testMode: true,
};

const tenantConnection = {
  credential_reference: "providers.mollie",
  environment: "test",
  id: "tenant-connection",
  owner_id: "app-a",
  owner_kind: "tenant",
  provider: "mollie",
  status: "active",
};

function inventorySql(
  dataRows: Record<string, unknown>[] = [{ id: "invoice-1" }],
  total = "1",
) {
  const statements: Array<{ params?: readonly unknown[]; sql: string }> = [];
  const sql: BillingSqlExecutor = {
    async query(statement, params) {
      statements.push({ params, sql: statement });
      if (statement.includes("billing_subject_bindings")) return { rows: [] };
      if (statement.includes("SELECT owner_id, owner_kind")) {
        return { rows: [tenantConnection] };
      }
      if (
        statement.trimStart().startsWith("SELECT DISTINCT id::text") &&
        params?.[2] === "app-a"
      ) {
        return { rows: [tenantConnection] };
      }
      if (statement.trimStart().startsWith("SELECT DISTINCT id::text")) {
        return { rows: [] };
      }
      if (statement.startsWith("SELECT count")) return { rows: [{ total }] };
      return { rows: dataRows };
    },
    async transaction(fn) {
      return fn(sql);
    },
  };
  return { sql, statements };
}

test("billing inventory exposes only the ten fixed operator presets", () => {
  assert.deepEqual(
    BILLING_INVENTORY_PRESETS.map(({ id }) => id),
    [
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
    ],
  );
  assert.throws(() => getBillingInventoryPreset("billing_invoices"));
});

test("inventory read is included in platform and billing admin role templates", () => {
  const roles = createAthenaBuiltinRoleDefinitions();
  for (const roleKey of ["platform_admin", "billing_admin"]) {
    const role = roles.find(({ key }) => key === roleKey);
    assert.ok(role);
    assert.ok(
      role.rights.some(
        (right) => String(right) === "billing.admin.inventory.read",
      ),
    );
  }

  const platformAdmin = roles.find(({ key }) => key === "platform_admin");
  const billingAdmin = roles.find(({ key }) => key === "billing_admin");
  assert.ok(platformAdmin?.rights.some((right) => String(right) === "billing.admin.inventory.shared.read"));
  assert.equal(billingAdmin?.rights.some((right) => String(right) === "billing.admin.inventory.shared.read"), false);
});

test("billing inventory bounds pagination before building SQL", () => {
  assert.deepEqual(validateBillingInventoryPage({ page: 2, pageSize: 50 }), {
    offset: 50,
    page: 2,
    pageSize: 50,
  });
  assert.throws(() => validateBillingInventoryPage({ page: -1, pageSize: 10 }));
  assert.throws(() => validateBillingInventoryPage({ page: 0, pageSize: 101 }));
});

test("inventory reads are scoped, projected, and require the operator Right", async () => {
  const { sql, statements } = inventorySql();
  const page = await listBillingInventory({
    ...runtimeContext,
    principal: {
      authenticated: true,
      grants: [],
      organizationId: "org-1",
      rights: [parseAthenaRightKey("billing.admin.inventory.read")],
    },
    presetId: "invoices",
    page: 1,
    pageSize: 20,
    sql,
  });
  assert.equal(page.totalItems, 1);
  assert.deepEqual(page.rows, [{ id: "invoice-1" }]);
  const count = statements.find(({ sql: statement }) => statement.startsWith("SELECT count"));
  const rows = statements.find(({ sql: statement }) => statement.startsWith("SELECT id, provider, provider_invoice_id"));
  assert.match(count?.sql ?? "", /billing\.billing_invoices/);
  assert.match(count?.sql ?? "", /connection_id::text = ANY/);
  assert.match(count?.sql ?? "", /scoped_connection\.owner_kind = 'organization'/);
  assert.match(rows?.sql ?? "", /provider_invoice_id/);
  assert.doesNotMatch(rows?.sql ?? "", /\b(raw|metadata|payload|secret|token)\b/i);
  const runtimeStatements = statements.map(({ sql: statement }) => statement);
  assert.ok(runtimeStatements.includes("SET TRANSACTION READ ONLY"));
  assert.ok(runtimeStatements.includes("SET LOCAL statement_timeout = '5s'"));
  const beforeInvalidPreset = statements.length;

  await assert.rejects(
    listBillingInventory({
      principal: {
        authenticated: true,
        grants: [],
        organizationId: "org-1",
        rights: [parseAthenaRightKey("billing.admin.inventory.read")],
      },
      presetId: "billing_invoices; DROP TABLE users",
      sql,
    }),
  );
  assert.equal(statements.length, beforeInvalidPreset);

  const webhookSql = inventorySql([
    { url: "https://app.example/api/athena/billing/webhook/mollie/events/secret_ingress_token_123" },
  ]);
  const registrations = await listBillingInventory({
    ...runtimeContext,
    principal: {
      authenticated: true,
      grants: [],
      organizationId: "org-1",
      rights: [parseAthenaRightKey("billing.admin.inventory.read")],
    },
    presetId: "webhookRegistrations",
    sql: webhookSql.sql,
  });
  assert.equal(registrations.rows[0]?.url, "https://app.example/api/athena/billing/webhook/mollie/events/[redacted]");
});

test("inventory rejects missing Rights and organization scope before querying", async () => {
  let queries = 0;
  const sql: BillingSqlExecutor = {
    async query() {
      queries += 1;
      return { rows: [] };
    },
    async transaction(fn) {
      return fn(sql);
    },
  };
  const principal = {
    authenticated: true,
    grants: [],
    organizationId: null,
    rights: [],
  };

  await assert.rejects(
    listBillingInventory({ principal, presetId: "invoices", sql }),
    (error: unknown) => error instanceof AthenaBillingAuthorizationError,
  );
  await assert.rejects(
    listBillingInventory({
      principal: {
        ...principal,
        rights: [parseAthenaRightKey("billing.admin.inventory.read")],
      },
      presetId: "invoices",
      sql,
    }),
    (error: unknown) => error instanceof AthenaBillingAuthorizationError,
  );
  assert.equal(queries, 0);
});

test("session ingestion and webhook status reads require an active organization", async () => {
  let queries = 0;
  const sql: BillingSqlExecutor = {
    async query() {
      queries += 1;
      return { rows: [] };
    },
  };
  const principal = {
    authenticated: true,
    grants: [],
    organizationId: null,
    rights: [
      parseAthenaRightKey("billing.admin.ingestion.read"),
      parseAthenaRightKey("billing.admin.webhooks.read"),
    ],
  };
  for (const operation of [
    "admin.ingestion.health",
    "admin.webhooks.status",
  ] as const) {
    await assert.rejects(
      executeAdminBillingOperation({
        authority: SESSION_BILLING_INVOCATION,
        operation,
        options: { applicationId: "app", registry: {} as never, sql },
        payload: { connectionId: "connection-outside-scope" },
        principal,
      }),
      (error: unknown) => error instanceof AthenaBillingAuthorizationError,
    );
    await assert.rejects(
      executeAdminBillingOperation({
        authority: SESSION_BILLING_INVOCATION,
        operation,
        options: { applicationId: "app", registry: {} as never, sql },
        payload: { connectionId: "connection-1" },
        principal: { ...principal, organizationId: "org-1", rights: [] },
      }),
      (error: unknown) => error instanceof AthenaBillingAuthorizationError,
    );
  }
  assert.equal(queries, 0);

  const scopedStatements: Array<{ parameters: readonly unknown[]; statement: string }> = [];
  const scopedSql: BillingSqlExecutor = {
    async query(statement, parameters = []) {
      scopedStatements.push({ parameters, statement });
      return { rows: [] };
    },
  };
  await assert.rejects(
    executeAdminBillingOperation({
      authority: SESSION_BILLING_INVOCATION,
      operation: "admin.webhooks.status",
      options: { applicationId: "app", registry: {} as never, sql: scopedSql },
      payload: { connectionId: "00000000-0000-0000-0000-000000000011" },
      principal: {
        ...principal,
        organizationId: "org-1",
      },
    }),
    (error: unknown) => error instanceof AthenaBillingCapabilityError,
  );
  assert.match(scopedStatements[0]?.statement ?? "", /SELECT owner_id, owner_kind/);
  assert.match(scopedStatements[0]?.statement ?? "", /id = \$1::uuid/);
  assert.deepEqual(scopedStatements[0]?.parameters, ["00000000-0000-0000-0000-000000000011"]);
});

test("tenant business records stay scoped to organization subjects", async () => {
  const { sql, statements } = inventorySql([], "0");
  await listBillingInventory({
    ...runtimeContext,
    principal: {
      authenticated: true,
      grants: [],
      organizationId: "org-1",
      rights: [parseAthenaRightKey("billing.admin.inventory.read")],
      userId: "user-1",
    },
    presetId: "subscriptions",
    sql,
  });

  const count = statements.find(({ sql: statement }) => statement.startsWith("SELECT count"));
  const rows = statements.find(({ sql: statement }) => statement.startsWith("SELECT id, provider, provider_subscription_id"));
  assert.match(count?.sql ?? "", /connection_id::text = ANY\(\$1::text\[\]\)/);
  assert.match(count?.sql ?? "", /scoped_connection\.owner_kind = 'organization' AND scoped_connection\.owner_id = \$2/);
  assert.match(count?.sql ?? "", /inventory_row\.subject_kind = 'organization' AND inventory_row\.subject_id = \$2/);
  assert.doesNotMatch(count?.sql ?? "", /athena\.member/);
  assert.deepEqual(count?.params, [["tenant-connection"], "org-1", "app-a"]);
  assert.deepEqual(rows?.params, [["tenant-connection"], "org-1", "app-a", 10, 0]);
});

test("tenant operational inventory needs application-wide inventory authority", async () => {
  const ordinary = inventorySql([], "0");
  await listBillingInventory({
    ...runtimeContext,
    principal: {
      authenticated: true,
      grants: [],
      organizationId: "org-1",
      rights: [parseAthenaRightKey("billing.admin.inventory.read")],
    },
    presetId: "webhookEvents",
    sql: ordinary.sql,
  });
  const ordinaryCount = ordinary.statements.find(({ sql }) => sql.startsWith("SELECT count"));
  assert.match(ordinaryCount?.sql ?? "", /scoped_connection\.owner_kind = 'organization'/);
  assert.match(ordinaryCount?.sql ?? "", /scoped_connection\.owner_kind = 'tenant'/);
  assert.match(ordinaryCount?.sql ?? "", /\$4::boolean/);
  assert.deepEqual(ordinaryCount?.params, [["tenant-connection"], "org-1", "app-a", false]);

  const platform = inventorySql([], "0");
  await listBillingInventory({
    ...runtimeContext,
    principal: {
      authenticated: true,
      grants: [],
      organizationId: "org-1",
      rights: [
        parseAthenaRightKey("billing.admin.inventory.read"),
        parseAthenaRightKey("billing.admin.inventory.shared.read"),
      ],
    },
    presetId: "webhookEvents",
    sql: platform.sql,
  });
  const platformCount = platform.statements.find(({ sql }) => sql.startsWith("SELECT count"));
  assert.deepEqual(platformCount?.params, [["tenant-connection"], "org-1", "app-a", true]);
});

test("tenant personal import candidates are hidden and unassigned rows require shared authority", async () => {
  const fixture = inventorySql([], "0");
  await listBillingInventory({
    ...runtimeContext,
    presetId: "importCandidates",
    principal: {
      authenticated: true,
      grants: [],
      organizationId: "org-1",
      rights: [parseAthenaRightKey("billing.admin.inventory.read")],
    },
    sql: fixture.sql,
  });
  const count = fixture.statements.find(({ sql }) => sql.startsWith("SELECT count"));
  assert.doesNotMatch(count?.sql ?? "", /athena\.member/);
  assert.match(count?.sql ?? "", /subject_kind = 'organization' AND inventory_row\.subject_id = \$2/);
  assert.match(count?.sql ?? "", /subject_kind IS NULL OR inventory_row\.subject_id IS NULL/);
  assert.match(count?.sql ?? "", /\$4::boolean/);
  assert.deepEqual(count?.params, [["tenant-connection"], "org-1", "app-a", false]);
});

test("browser inventory uses the dedicated Billing HTTP operation", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const browser = createBrowserBillingTransport({
    endpoints: { billing: "/api/athena/billing" },
    fetch: async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return Response.json({ data: { rows: [], totalItems: 0, page: 1, pageSize: 10 }, ok: true, status: 200 });
    },
  });
  const result = await browser.admin.inventory.list({ presetId: "invoices", page: 1, pageSize: 10 });
  assert.equal(result.totalItems, 0);
  assert.equal(new URL(requests[0]?.url ?? "http://localhost").pathname, "/api/athena/billing");
  assert.deepEqual(requests[0]?.body, {
    operation: "admin.inventory.list",
    payload: { presetId: "invoices", page: 1, pageSize: 10 },
  });
  assert.equal("reconciliation" in browser.admin, false);
  assert.equal("conflicts" in browser.admin, false);
});

test("browser exposes the separately authorized ingestion and webhook status reads", async () => {
  const requests: Array<{ body: Record<string, unknown> }> = [];
  const browser = createBrowserBillingTransport({
    endpoints: { billing: "/api/athena/billing" },
    fetch: async (_input, init) => {
      requests.push({ body: JSON.parse(String(init?.body)) });
      return Response.json({ data: { enabled: true }, ok: true, status: 200 });
    },
  });
  const admin = browser.admin as unknown as {
    ingestion?: { health?: (input: { connectionId: string }) => Promise<unknown> };
    webhooks?: { status?: (input: { connectionId: string }) => Promise<unknown> };
  };

  assert.equal(typeof admin.ingestion?.health, "function");
  assert.equal(typeof admin.webhooks?.status, "function");
  await admin.ingestion?.health?.({ connectionId: "connection-1" });
  await admin.webhooks?.status?.({ connectionId: "connection-1" });

  assert.deepEqual(requests.map(({ body }) => body), [
    {
      operation: "admin.ingestion.health",
      payload: { connectionId: "connection-1" },
    },
    {
      operation: "admin.webhooks.status",
      payload: { connectionId: "connection-1" },
    },
  ]);
});

test("browser billing health reads use session authority and retain dedicated Rights", () => {
  assert.equal(
    billingOperationPolicy("admin.ingestion.health").executionAuthority,
    "session",
  );
  assert.deepEqual(
    billingOperationPolicy("admin.ingestion.health").requiredRights.map(String),
    ["billing.admin.ingestion.read"],
  );
  assert.equal(
    billingOperationPolicy("admin.webhooks.status").executionAuthority,
    "session",
  );
  assert.deepEqual(
    billingOperationPolicy("admin.webhooks.status").requiredRights.map(String),
    ["billing.admin.webhooks.read"],
  );
});

test("all fixed presets execute with the expected organization scope", async () => {
  const fixture = inventorySql([], "0");
  const sql = fixture.sql;
  for (const preset of BILLING_INVENTORY_PRESETS) {
    const page = await listBillingInventory({
      ...runtimeContext,
      principal: {
        authenticated: true,
        grants: [],
        organizationId: "org-1",
        rights: [parseAthenaRightKey("billing.admin.inventory.read")],
      },
      presetId: preset.id,
      sql,
    });
    assert.equal(page.totalItems, 0);
    const count = [...fixture.statements].reverse().find(({ sql: statement }) =>
      statement.startsWith("SELECT count") && statement.includes(`billing.${preset.table}`),
    );
    const rows = [...fixture.statements].reverse().find(({ sql: statement }) =>
      !statement.startsWith("SELECT count") && statement.includes(`billing.${preset.table} AS inventory_row`),
    );
    assert.match(count?.sql ?? "", new RegExp(`billing\\.${preset.table}`));
    if (preset.scope === "owner") {
      assert.match(count?.sql ?? "", /owner_kind = 'organization' AND inventory_row\.owner_id = \$1/);
      assert.match(count?.sql ?? "", /owner_kind = 'tenant' AND inventory_row\.owner_id = \$2/);
    } else if (preset.scope === "subject") {
      assert.match(count?.sql ?? "", /subject_kind = 'organization' AND inventory_row\.subject_id = \$1/);
    } else {
      assert.match(count?.sql ?? "", /inventory_row\.connection_id::text = ANY/);
      if ("subjectScoped" in preset && preset.subjectScoped) {
        assert.match(count?.sql ?? "", /scoped_connection\.owner_kind = 'organization'/);
        assert.match(count?.sql ?? "", /inventory_row\.subject_kind = 'organization' AND inventory_row\.subject_id = \$2/);
      }
    }
    assert.match(rows?.sql ?? "", /ORDER BY inventory_row\./);
    assert.equal(
      count?.sql.split(" WHERE ")[1],
      rows?.sql.split(" WHERE ")[1]?.split(" ORDER BY")[0],
    );
    assert.deepEqual(rows?.params?.slice(0, count?.params?.length), count?.params);
  }
});

test("a missing billing relation remains an unavailable error", async () => {
  const missingRelation = Object.assign(new Error("missing relation"), { code: "42P01" });
  const sql: BillingSqlExecutor = {
    async query() {
      throw missingRelation;
    },
    async transaction(fn) {
      return fn(sql);
    },
  };
  await assert.rejects(
    listBillingInventory({
      principal: {
        authenticated: true,
        grants: [],
        organizationId: "org-1",
        rights: [parseAthenaRightKey("billing.admin.inventory.read")],
      },
      presetId: "invoices",
      sql,
    }),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.code === "ATHENA_BILLING_OPERATION_UNAVAILABLE",
  );
});
