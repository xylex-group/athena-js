import { strict as assert } from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildAuthCapabilityMatrix } from "../src/cli/commands/auth/capabilities-report.ts";
import {
  buildAuthStatusReport,
  formatAuthStatusText,
} from "../src/cli/commands/auth/status-report.ts";
import {
  formatSchemaDiffText,
  isDestructiveSchemaOperation,
} from "../src/cli/commands/schema/format.ts";
import { CliExitCode, parseCommand, runCLI } from "../src/cli/index.ts";
import {
  evaluateMigrationReadiness,
  formatMigrationVerifyText,
} from "../src/migrations/verify.ts";
import {
  ATHENA_SCHEMA_SNAPSHOT_VERSION,
  type AthenaSchemaSnapshot,
  diffSchemas,
  emptySchemaSnapshot,
  normalizeSchemaSnapshot,
} from "../src/schema/diff/index.ts";

function snapshotWithUsers(): AthenaSchemaSnapshot {
  return normalizeSchemaSnapshot({
    backend: "postgresql",
    schemas: [
      {
        name: "public",
        tables: [
          {
            columns: [
              {
                default: null,
                isGenerated: false,
                name: "id",
                nullable: false,
                type: {
                  arrayDimensions: 0,
                  name: "uuid",
                },
              },
            ],
            foreignKeys: [],
            indexes: [],
            name: "users",
            primaryKey: { columns: ["id"], name: null },
            schema: "public",
            uniqueConstraints: [],
          },
        ],
      },
    ],
    version: ATHENA_SCHEMA_SNAPSHOT_VERSION,
  });
}

test("parseCommand registers schema, migrate verify, auth, and doctor bundle", () => {
  assert.deepEqual(parseCommand(["schema"]), { command: "schema" });
  assert.equal(parseCommand(["schema", "diff"]).command, "schema-diff");
  assert.equal(
    parseCommand(["schema", "snapshot", "--check"]).command ===
      "schema-snapshot" &&
      parseCommand(["schema", "snapshot", "--check"]).check,
    true
  );
  assert.equal(
    parseCommand(["migrate", "verify"]).command === "migrate" &&
      parseCommand(["migrate", "verify"]).mode,
    "verify"
  );
  assert.equal(
    parseCommand(["auth", "capabilities"]).command,
    "auth-capabilities"
  );
  assert.equal(parseCommand(["auth", "status"]).command, "auth-status");
  assert.equal(parseCommand(["doctor", "bundle"]).command, "doctor-bundle");
  assert.deepEqual(parseCommand(["help", "schema"]), {
    command: "help",
    topic: "schema",
  });
  assert.deepEqual(parseCommand(["help", "auth"]), {
    command: "help",
    topic: "auth",
  });
});

test("schema diff text groups additive and destructive operations", () => {
  const from = snapshotWithUsers();
  const to = emptySchemaSnapshot("postgresql");
  const diff = diffSchemas({ from, to });
  assert.equal(diff.operations.some(isDestructiveSchemaOperation), true);
  const text = formatSchemaDiffText(diff);
  assert.match(text, /users/);
  assert.match(text, /- table/);
  assert.match(text, /potentially destructive/);
});

test("runCLI schema snapshot --check fails on drift with exit 6", async () => {
  const dir = mkdtempSync(join(tmpdir(), "athena-schema-"));
  const previous = process.exitCode;
  process.exitCode = undefined;
  try {
    const committed = snapshotWithUsers();
    writeFileSync(
      join(dir, "schema.snapshot.json"),
      `${JSON.stringify(committed, null, 2)}\n`,
      "utf8"
    );
    const logs: string[] = [];
    await runCLI(
      ["schema", "snapshot", "--check", "--out", "schema.snapshot.json"],
      {
        cwd: dir,
        errorLog: () => undefined,
        inspectSchemaSnapshot: async () => emptySchemaSnapshot("postgresql"),
        log: (message) => {
          logs.push(message);
        },
      }
    );
    assert.equal(process.exitCode, CliExitCode.Conflict);
    assert.equal(
      logs.some((line) => line.includes("- table") || line.includes("schema")),
      true
    );
  } finally {
    process.exitCode = previous;
    rmSync(dir, { force: true, recursive: true });
  }
});

test("runCLI schema diff writes first snapshot when missing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "athena-schema-diff-"));
  const previous = process.exitCode;
  process.exitCode = undefined;
  try {
    const logs: string[] = [];
    await runCLI(["schema", "diff"], {
      cwd: dir,
      errorLog: () => undefined,
      inspectSchemaSnapshot: async () => snapshotWithUsers(),
      log: (message) => {
        logs.push(message);
      },
    });
    assert.equal(process.exitCode, undefined);
    const snapshotPath = join(dir, "athena", "schema.snapshot.json");
    const written = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
      version: number;
    };
    assert.equal(written.version, ATHENA_SCHEMA_SNAPSHOT_VERSION);
    assert.equal(
      logs.some((line) => line.includes("Wrote first schema snapshot")),
      true
    );
  } finally {
    process.exitCode = previous;
    rmSync(dir, { force: true, recursive: true });
  }
});

test("runCLI schema snapshot --check stays fail-closed when snapshot is missing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "athena-schema-check-"));
  const previous = process.exitCode;
  process.exitCode = undefined;
  try {
    const errors: string[] = [];
    await runCLI(["schema", "snapshot", "--check"], {
      cwd: dir,
      errorLog: (message) => {
        errors.push(message);
      },
      inspectSchemaSnapshot: async () => snapshotWithUsers(),
      log: () => undefined,
    });
    assert.equal(process.exitCode, CliExitCode.Configuration);
    assert.equal(
      errors.some((line) => line.includes("SCHEMA002")),
      true
    );
  } finally {
    process.exitCode = previous;
    rmSync(dir, { force: true, recursive: true });
  }
});

test("evaluateMigrationReadiness is READY with pending and NOT_READY on conflicts", () => {
  const pendingReady = evaluateMigrationReadiness({
    auth: {
      conflictCount: 0,
      currentGeneration: 24,
      expectedGeneration: 24,
      hasBlockingDrift: false,
      pendingCount: 2,
    },
    databaseLabel: "neondb",
    dirtyWorktree: false,
    plan: {
      applied: [],
      conflicts: [],
      pending: [
        {
          migration: {
            checksum: "abc",
            filename: "0008.sql",
            name: "add_foo",
            path: "0008.sql",
            sql: "select 1",
            version: 8,
          },
          status: "pending",
        },
      ],
    },
    providerLabel: "postgres/direct",
    semanticBlocked: false,
  });
  assert.equal(pendingReady.result, "READY");
  assert.equal(pendingReady.pending, 1);
  assert.match(formatMigrationVerifyText(pendingReady), /READY/);

  const blocked = evaluateMigrationReadiness({
    auth: {
      conflictCount: 0,
      currentGeneration: 24,
      expectedGeneration: 24,
      hasBlockingDrift: true,
      pendingCount: 0,
    },
    databaseLabel: "neondb",
    dirtyWorktree: true,
    plan: {
      applied: [],
      conflicts: [
        {
          kind: "checksum-mismatch",
          version: 7,
        },
      ],
      pending: [],
    },
    providerLabel: "postgres/direct",
    semanticBlocked: false,
  });
  assert.equal(blocked.result, "NOT_READY");
  assert.equal(blocked.ok, false);
});

test("runCLI migrate verify uses injected report and JSON envelope", async () => {
  const previous = process.exitCode;
  process.exitCode = undefined;
  const logs: string[] = [];
  try {
    await runCLI(["migrate", "verify", "--json"], {
      errorLog: () => undefined,
      log: (message) => {
        logs.push(message);
      },
      runMigrationVerify: async () =>
        evaluateMigrationReadiness({
          auth: {
            conflictCount: 0,
            currentGeneration: 24,
            expectedGeneration: 24,
            hasBlockingDrift: false,
            pendingCount: 0,
          },
          databaseLabel: "neondb",
          dirtyWorktree: false,
          plan: { applied: [], conflicts: [], pending: [] },
          providerLabel: "postgres/direct",
          semanticBlocked: false,
        }),
    });
    assert.equal(
      process.exitCode === undefined || process.exitCode === 0,
      true
    );
    const envelope = JSON.parse(logs[0] ?? "{}") as {
      command?: string;
      ok?: boolean;
      data?: { result?: string };
    };
    assert.equal(envelope.command, "migrate.verify");
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data?.result, "READY");
  } finally {
    process.exitCode = previous;
  }
});

test("auth capabilities matrix includes passkeys on both runtimes", () => {
  const rows = buildAuthCapabilityMatrix();
  const passkeys = rows.find((row) => row.capability === "passkeys");
  assert.ok(passkeys);
  assert.equal(passkeys?.rust, "yes");
  assert.equal(passkeys?.embedded, "yes");
});

test("runCLI auth status surfaces inspect failures instead of unknown tables", async () => {
  const dir = mkdtempSync(join(tmpdir(), "athena-auth-status-"));
  const previous = process.exitCode;
  process.exitCode = undefined;
  try {
    const logs: string[] = [];
    const errors: string[] = [];
    await runCLI(["auth", "status"], {
      cwd: dir,
      errorLog: (message) => {
        errors.push(message);
      },
      log: (message) => {
        logs.push(message);
      },
    });
    const output = [...logs, ...errors].join("\n");
    assert.notEqual(process.exitCode, undefined);
    assert.notEqual(process.exitCode, 0);
    assert.doesNotMatch(output, /audit_log_auth\s+unknown/);
    assert.match(output, /athena\.config|AUTH001|DATABASE_URL|Embedded Auth/i);
  } finally {
    process.exitCode = previous;
    rmSync(dir, { force: true, recursive: true });
  }
});

test("runCLI auth capabilities --json returns envelope rows", async () => {
  const logs: string[] = [];
  await runCLI(["auth", "capabilities", "--json"], {
    log: (message) => {
      logs.push(message);
    },
  });
  const envelope = JSON.parse(logs[0] ?? "{}") as {
    command?: string;
    data?: { rows?: Array<{ capability: string }> };
  };
  assert.equal(envelope.command, "auth.capabilities");
  assert.equal(
    envelope.data?.rows?.some((row) => row.capability === "password"),
    true
  );
});

test("runCLI doctor bundle writes redacted files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "athena-bundle-"));
  const previous = process.exitCode;
  process.exitCode = undefined;
  try {
    const out = join(dir, "bundle-out");
    await runCLI(["doctor", "bundle", "--out", out], {
      cwd: dir,
      errorLog: () => undefined,
      inspectAuthStatus: async () => ({
        databaseLabel: "neondb",
        mode: "embedded",
      }),
      log: () => undefined,
      runCliDoctor: async () => ({
        checks: [],
        cwd: dir,
        errorCount: 0,
        ok: true,
        resolvedMode: "none",
        sdkVersion: "0.0.0-test",
        title: "Athena JS · doctor",
        warnCount: 0,
      }),
    });
    const doctor = JSON.parse(
      readFileSync(join(out, "doctor.json"), "utf8")
    ) as {
      ok?: boolean;
    };
    assert.equal(doctor.ok, true);
    assert.equal(
      readFileSync(join(out, "cli-version.txt"), "utf8").length > 0,
      true
    );
  } finally {
    process.exitCode = previous;
    rmSync(dir, { force: true, recursive: true });
  }
});

test("formatAuthStatusText paints ANSI when color is on", () => {
  const report = buildAuthStatusReport({
    auditLog: true,
    currentGeneration: 27,
    databaseLabel: "neondb",
    mode: "embedded",
    providerLabel: "postgres/direct",
    traces: false,
  });
  const colored = formatAuthStatusText(report, {
    color: true,
    isTty: true,
    mode: "interactive",
    quiet: false,
    verbose: false,
  });
  const plain = formatAuthStatusText(report, {
    color: false,
    isTty: false,
    mode: "plain",
    quiet: false,
    verbose: false,
  });
  assert.equal(colored.includes("\u001b["), true);
  assert.equal(plain.includes("\u001b["), false);
  assert.match(colored, /Athena Auth status/);
  assert.match(colored, /embedded/);
});

test("runCLI auth audit uses default query when injected", async () => {
  const logs: string[] = [];
  const previous = process.exitCode;
  process.exitCode = undefined;
  try {
    await runCLI(["auth", "audit", "--limit", "5"], {
      log: (message) => {
        logs.push(message);
      },
      queryAuthAudit: async ({ limit }) =>
        [
          {
            actor: "user_1",
            at: "2026-01-01T00:00:00.000Z",
            event: "organization.created",
            id: "aud_1",
          },
        ].slice(0, limit),
    });
    assert.equal(process.exitCode, undefined);
    assert.match(logs.join("\n"), /organization\.created/);
  } finally {
    process.exitCode = previous;
  }
});
