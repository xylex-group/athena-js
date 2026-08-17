import assert from "node:assert/strict";
import { test } from "node:test";

import type { AthenaAuthDatabase } from "../src/auth/local/database.ts";
import { assertQueryResult } from "../src/auth/local/database.ts";
import { AthenaAuthRuntimeError } from "../src/auth/local/errors.ts";
import {
  getAthenaAuthExpectedLedger,
  planAthenaAuthSchema,
} from "../src/auth/local/schema.ts";
import { redactSecrets } from "../src/cli/logging/redact.ts";
import { resolveCliOutputMode } from "../src/cli/ui/capabilities.ts";
import { buildMigrationReportView } from "../src/migrations/report.ts";
import { parseCommand } from "../src/cli/index.ts";

test("P1: Auth expected ledger is sorted by numeric version", () => {
  const ledger = getAthenaAuthExpectedLedger();
  const versions = ledger.map((entry) => entry.version);
  const sorted = [...versions].sort((a, b) => a - b);
  assert.deepEqual(versions, sorted);
  // Declaration order historically put 009/021 before 006/007.
  assert.ok(versions.includes(6));
  assert.ok(versions.includes(21));
  const index6 = versions.indexOf(6);
  const index9 = versions.indexOf(9);
  const index21 = versions.indexOf(21);
  assert.ok(index6 < index9);
  assert.ok(index9 < index21);
});

test("P1: assertQueryResult rejects malformed adapter results", () => {
  assert.throws(
    () => assertQueryResult(undefined, "reading migration ledger"),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      error.code === "ATHENA_AUTH_DATABASE_RESULT_INVALID" &&
      !/Cannot read properties of undefined/i.test(error.publicMessage)
  );
  assert.throws(
    () => assertQueryResult({ rowCount: 1 }, "reading migration ledger"),
    (error: unknown) =>
      error instanceof AthenaAuthRuntimeError &&
      error.code === "ATHENA_AUTH_DATABASE_RESULT_INVALID"
  );
  const ok = assertQueryResult(
    { rows: [{ version: 1 }], rowCount: 1 },
    "reading migration ledger"
  );
  assert.equal(ok.rows.length, 1);
});

test("P1: planAthenaAuthSchema reports drift when table missing but ledger applied", async () => {
  const expected = getAthenaAuthExpectedLedger();
  const applied = expected.map((entry) => ({
    checksum: entry.checksum,
    name: entry.name,
    version: entry.version,
  }));

  const database: AthenaAuthDatabase = {
    async close() {},
    async query(text) {
      if (/auth_schema_migrations/i.test(text)) {
        return { rowCount: applied.length, rows: applied };
      }
      // Catalog empty => all structural expectations are missing.
      return { rowCount: 0, rows: [] };
    },
    async transaction(fn) {
      return fn(this);
    },
  };

  const plan = await planAthenaAuthSchema(database, { inspectSchema: true });
  const core = plan.entries.find((entry) => entry.version === 1);
  assert.ok(core);
  assert.equal(core?.ledgerState, "applied");
  assert.equal(core?.schemaState, "drift");
  assert.equal(core?.action, "repair");
  assert.ok(plan.hasBlockingDrift);
  assert.ok(
    (core?.drift ?? []).some(
      (item) => item.object === "athena.users" && item.kind === "missing-table"
    )
  );
});

test("P1: migrate repair CLI parsing requires explicit subcommand", () => {
  assert.deepEqual(parseCommand(["migrate", "repair", "--yes"]), {
    command: "migrate",
    configPath: undefined,
    dryRun: false,
    json: false,
    mode: "repair",
    plain: false,
    yes: true,
  });
  assert.deepEqual(parseCommand(["migrate", "status", "--json"]), {
    command: "migrate",
    configPath: undefined,
    dryRun: false,
    json: true,
    mode: "status",
    plain: false,
    yes: false,
  });
});

test("P1: CLI secrets are redacted from log payloads", () => {
  const raw = [
    "postgresql://admin:hunter2@example.com/neondb",
    "Authorization: Bearer secret-token",
    "ATHENA_API_KEY=ath_secret",
    "Cookie=session=secret",
  ].join("\n");
  const redacted = redactSecrets(raw);
  assert.equal(redacted.includes("hunter2"), false);
  assert.equal(redacted.includes("secret-token"), false);
  assert.equal(redacted.includes("ath_secret"), false);
  assert.equal(redacted.includes("session=secret"), false);
  assert.match(redacted, /postgres(?:ql)?:\/\/admin:\*\*\*@example\.com/i);
});

test("P1: output mode resolution prefers json then plain then TTY", () => {
  assert.equal(resolveCliOutputMode({ json: true }), "json");
  assert.equal(resolveCliOutputMode({ plain: true, isTty: true }), "plain");
  assert.equal(
    resolveCliOutputMode({ isTty: false, env: {} }),
    "plain"
  );
  assert.equal(
    resolveCliOutputMode({ isTty: true, env: { NO_COLOR: "1" } }),
    "plain"
  );
  assert.equal(
    resolveCliOutputMode({ isTty: true, env: {} }),
    "interactive"
  );
});

test("P1: migration report view maps Auth drift without ANSI status strings", () => {
  const report = buildMigrationReportView({
    summary: {
      databaseLabel: "neondb",
      directory: "athena/migrations",
      mode: "status",
      plan: { applied: [], conflicts: [], pending: [] },
      providerLabel: "postgres/direct",
    },
    authPlan: {
      appliedCount: 0,
      conflictCount: 0,
      driftCount: 1,
      entries: [
        {
          action: "repair",
          checksum: "abc",
          drift: [
            {
              kind: "missing-table",
              object: "athena.users",
            },
          ],
          ledgerState: "applied",
          name: "001_create_core_tables",
          repairability: "idempotent",
          schemaState: "drift",
          version: 1,
        },
      ],
      hasBlockingDrift: true,
      pendingCount: 0,
    },
    outcome: "Embedded Auth schema drift detected.",
  });
  assert.equal(report.auth.rows[0]?.status, "drift");
  assert.equal(report.auth.rows[0]?.name, "001_create_core_tables");
  assert.match(report.auth.rows[0]?.detail ?? "", /athena\.users/);
});
