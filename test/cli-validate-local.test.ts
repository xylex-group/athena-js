import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import type { AthenaAuthMigrationPlan } from "../src/auth/local/schema.ts";
import {
  collectEmbeddedSchemaDatabaseChecks,
  collectLocalBillingValidationChecks,
} from "../src/cli/commands/validate/validate-billing.ts";
import { parseCommand, runCLI, usage } from "../src/cli/index.ts";
import {
  formatValidationReport,
  validateLocalRuntime,
} from "../src/cli/validate-local.ts";
import type { MigrationPlan } from "../src/migrations/types.ts";

function emptyAuthPlan(
  pendingCount: number,
  appliedCount = 0
): AthenaAuthMigrationPlan {
  return {
    appliedCount,
    conflictCount: 0,
    driftCount: 0,
    entries: [],
    hasBlockingDrift: false,
    health: pendingCount > 0 ? "UNINITIALIZED" : "HEALTHY",
    pendingCount,
  };
}

function emptyAppPlan(pending: number, conflicts = 0): MigrationPlan {
  return {
    applied: [],
    conflicts: Array.from({ length: conflicts }, (_, index) => ({
      kind: "checksum-mismatch" as const,
      version: index + 1,
    })),
    pending: Array.from({ length: pending }, (_, index) => ({
      migration: {
        checksum: "ab",
        filename: `${String(index + 1).padStart(4, "0")}_x.sql`,
        sql: "SELECT 1;",
        version: index + 1,
      },
      status: "pending" as const,
    })),
  };
}

test("parseCommand supports validate", () => {
  assert.deepEqual(parseCommand(["validate"]), {
    command: "validate",
    configPath: undefined,
    json: false,
    plain: false,
    strict: false,
  });
  assert.deepEqual(parseCommand(["validate", "local", "--strict", "--json"]), {
    command: "validate",
    configPath: undefined,
    json: true,
    plain: false,
    strict: true,
  });
  assert.deepEqual(parseCommand(["help", "validate"]), {
    command: "help",
    topic: "validate",
  });
  assert.equal(usage("validate").includes("athena-js validate"), true);
  assert.equal(usage("root").includes("athena-js validate"), true);
});

test("validateLocalRuntime reports pending Auth and passkey gaps as warnings", async () => {
  const report = await validateLocalRuntime({
    inspect: {
      applicationPlan: async () => emptyAppPlan(2),
      authPlan: async () => emptyAuthPlan(13),
      columns: async () => [],
      ping: async () => undefined,
      tables: async () => ["users", "sessions"],
      target: async () => ({
        database: "neondb",
        directory: "athena/migrations",
        provider: "postgres/direct",
      }),
    },
  });
  assert.equal(report.ok, true);
  assert.equal(report.errorCount, 0);
  assert.equal(report.warnCount > 0, true);
  const ids = report.checks.map((check) => check.id);
  assert.equal(ids.includes("data.migrations"), true);
  assert.equal(ids.includes("auth.schema"), true);
  assert.equal(ids.includes("passkey.table"), true);
  assert.equal(ids.includes("passkey.rp"), true);
});

test("validateLocalRuntime fails closed on application checksum conflicts", async () => {
  const report = await validateLocalRuntime({
    inspect: {
      applicationPlan: async () => emptyAppPlan(0, 2),
      authPlan: async () => emptyAuthPlan(0, 13),
      columns: async () => [
        "credential_id",
        "counter",
        "user_id",
        "public_key",
        "updated_at",
      ],
      ping: async () => undefined,
      tables: async () => ["users", "sessions", "passkeys", "verifications"],
      target: async () => ({
        database: "neondb",
        directory: "athena/migrations",
        provider: "postgres/direct",
      }),
    },
  });
  assert.equal(report.ok, false);
  assert.equal(
    report.checks.find((check) => check.id === "data.migrations")?.status,
    "error"
  );
  assert.equal(
    report.checks.find((check) => check.id === "passkey.table")?.status,
    "ok"
  );
});

test("strict treats pending migrations as errors", async () => {
  const report = await validateLocalRuntime({
    inspect: {
      applicationPlan: async () => emptyAppPlan(1),
      ping: async () => undefined,
      tables: async () => [],
      target: async () => ({
        database: "app",
        directory: "athena/migrations",
        provider: "postgres/direct",
      }),
    },
    strict: true,
  });
  assert.equal(report.ok, false);
  assert.equal(
    report.checks.find((check) => check.id === "data.migrations")?.status,
    "error"
  );
});

test("modules.billing without createClient catalog is skip not not-configured", () => {
  const checks = collectLocalBillingValidationChecks({});
  assert.equal(checks.length, 1);
  assert.equal(checks[0]?.id, "billing.runtime.createClient");
  assert.equal(checks[0]?.status, "skip");
  assert.equal(checks[0]?.detail?.includes("createClient({ billing })"), true);
});

test("explicit Mollie + catalog still reports capabilities", () => {
  const checks = collectLocalBillingValidationChecks({
    catalog: {
      prices: [
        {
          amount: { currency: "EUR", value: "9.00" },
          id: "starter-monthly",
          interval: "month",
          productId: "starter",
        },
      ],
      products: [{ id: "starter", name: "Starter" }],
    },
    providers: { mollie: {} },
  });
  assert.equal(
    checks.find((check) => check.id === "billing.provider.mollie")?.status,
    "ok"
  );
  assert.equal(
    checks.find((check) => check.id === "billing.catalog.products")?.status,
    "ok"
  );
  assert.equal(
    checks.find((check) => check.id === "billing.capability.products.list")
      ?.status,
    "ok"
  );
});

test("embedded Billing validation detects missing subscription timestamp columns", () => {
  const checks = collectEmbeddedSchemaDatabaseChecks({
    athenaTables: [],
    billingEnabled: true,
    billingLedgerVersions: [32],
    billingSubscriptionColumns: ["row_version"],
    billingTables: [],
    chatEnabled: false,
    chatLedgerVersions: [],
    eventIngressEnabled: false,
    eventIngressLedgerVersions: [],
    publicTables: ["athena_billing_migrations"],
  });
  assert.deepEqual(
    checks.find((check) => check.id === "billing.schema.columns"),
    {
      detail: "missing updated_at",
      group: "billing",
      id: "billing.schema.columns",
      status: "error",
      title: "Database · billing subscription columns",
    }
  );
});

test("formatValidationReport includes a Billing group", () => {
  const text = formatValidationReport({
    checks: [
      {
        detail: "2 configured",
        group: "billing",
        id: "billing.catalog.prices",
        status: "ok",
        title: "Catalog · Prices",
      },
      {
        detail: "unavailable · billing.catalog.prices is not configured",
        group: "billing",
        id: "billing.capability.prices.list",
        status: "warn",
        title: "Capabilities · prices.list",
      },
    ],
    errorCount: 0,
    ok: true,
    title: "Athena JS · validate local",
    warnCount: 1,
  });
  assert.equal(text.includes("Billing"), true);
  assert.equal(text.includes("Catalog · Prices"), true);
  assert.equal(text.includes("billing.catalog.prices is not configured"), true);
});

test("formatValidationReport includes result line", () => {
  const text = formatValidationReport({
    checks: [
      {
        group: "data",
        id: "data.connect",
        status: "ok",
        title: "Database connection",
      },
    ],
    errorCount: 0,
    ok: true,
    title: "Athena JS · validate local",
    warnCount: 0,
  });
  assert.equal(text.includes("Athena JS · validate local"), true);
  assert.equal(text.includes("result: OK"), true);
  assert.equal(text.includes("Data runtime"), true);
});

test("runCLI validate --json uses injected inspector", async () => {
  const logs: string[] = [];
  await runCLI(["validate", "--json"], {
    log: (message) => {
      logs.push(message);
    },
    validateLocal: async () => ({
      checks: [
        {
          group: "data",
          id: "data.connect",
          status: "ok",
          title: "Database connection",
        },
      ],
      errorCount: 0,
      ok: true,
      target: { database: "neondb", provider: "postgres/direct" },
      title: "Athena JS · validate local",
      warnCount: 0,
    }),
  });
  const parsed = JSON.parse(logs[0] ?? "{}") as { ok?: boolean };
  assert.equal(parsed.ok, true);
});
