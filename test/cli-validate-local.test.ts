import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { parseCommand, runCLI, usage } from "../src/cli/index.ts";
import {
  formatValidationReport,
  validateLocalRuntime,
} from "../src/cli/validate-local.ts";
import type { AthenaAuthMigrationPlan } from "../src/auth/local/schema.ts";
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
      ping: async () => undefined,
      tables: async () => [
        "users",
        "sessions",
        "passkeys",
        "verifications",
      ],
      columns: async () => [
        "credential_id",
        "counter",
        "user_id",
        "public_key",
        "updated_at",
      ],
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
    strict: true,
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
  });
  assert.equal(report.ok, false);
  assert.equal(
    report.checks.find((check) => check.id === "data.migrations")?.status,
    "error"
  );
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
  assert.match(text, /Athena JS · validate local/);
  assert.match(text, /result: OK/);
  assert.match(text, /Data runtime/);
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
