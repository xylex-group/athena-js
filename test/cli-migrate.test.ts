import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  type CliRuntime,
  parseCommand,
  runCLI,
  usage,
} from "../src/cli/index.ts";
import type { MigrationRunSummary } from "../src/migrations/types.ts";
import { MigrationError } from "../src/migrations/types.ts";

test("root help mentions migrate", () => {
  const text = usage("root");
  assert.equal(text.includes("athena-js migrate"), true);
  assert.equal(text.includes("migrate status"), true);
});

test("migrate help documents dry-run and direct postgres", () => {
  const text = usage("migrate");
  assert.equal(text.includes("athena-js migrate"), true);
  assert.equal(text.includes("--dry-run"), true);
  assert.equal(text.includes("provider.mode=direct"), true);
  assert.equal(text.includes("advisory lock"), true);
});

test("migrate status help is available", () => {
  const text = usage("migrate-status");
  assert.equal(text.includes("migrate status"), true);
  assert.equal(text.includes("Does not apply migrations"), true);
});

test("parseCommand supports migrate modes", () => {
  assert.deepEqual(parseCommand(["migrate"]), {
    command: "migrate",
    configPath: undefined,
    dryRun: false,
    json: false,
    mode: "apply",
    plain: false,
    yes: false,
  });
  assert.deepEqual(parseCommand(["migrate", "status"]), {
    command: "migrate",
    configPath: undefined,
    dryRun: false,
    json: false,
    mode: "status",
    plain: false,
    yes: false,
  });
  assert.deepEqual(parseCommand(["migrate", "--dry-run"]), {
    command: "migrate",
    configPath: undefined,
    dryRun: true,
    json: false,
    mode: "dry-run",
    plain: false,
    yes: false,
  });
  assert.deepEqual(parseCommand(["migrate", "plan", "--config", "./athena.config.ts"]), {
    command: "migrate",
    configPath: "./athena.config.ts",
    dryRun: false,
    json: false,
    mode: "plan",
    plain: false,
    yes: false,
  });
  assert.deepEqual(parseCommand(["migrate", "--help"]), {
    command: "help",
    topic: "migrate",
  });
  assert.deepEqual(parseCommand(["help", "migrate"]), {
    command: "help",
    topic: "migrate",
  });
  assert.deepEqual(parseCommand(["migrate", "status", "--help"]), {
    command: "help",
    topic: "migrate-status",
  });
});

test("parseCommand rejects unknown migrate options", () => {
  assert.throws(() => parseCommand(["migrate", "--force"]), /Unknown option "--force"/);
});

test("runCLI migrate delegates and sets exit code on MigrationError", async () => {
  const logs: string[] = [];
  const errors: string[] = [];
  let sawOptions: unknown;

  const runtime: CliRuntime = {
    log: (message) => {
      logs.push(message);
    },
    errorLog: (message) => {
      errors.push(message);
    },
    runMigrations: async (options) => {
      sawOptions = options;
      throw new MigrationError(
        "PROVIDER",
        "athena-js migrate currently requires a direct PostgreSQL provider."
      );
    },
  };

  const previous = process.exitCode;
  process.exitCode = undefined;
  try {
    await runCLI(["migrate", "--dry-run", "--config", "./athena.config.ts"], runtime);
    assert.equal(process.exitCode, 1);
    assert.equal(
      (sawOptions as { configPath?: string }).configPath,
      "./athena.config.ts"
    );
    assert.equal((sawOptions as { dryRun?: boolean }).dryRun, true);
    assert.equal((sawOptions as { mode?: string }).mode, "dry-run");
    assert.equal((sawOptions as { log?: unknown }).log, runtime.log);
    assert.equal(
      errors.some((line) => line.includes("direct PostgreSQL provider")),
      true
    );
  } finally {
    process.exitCode = previous;
  }
});

test("runCLI migrate success path does not set failure exit code", async () => {
  const summary: MigrationRunSummary = {
    appliedCount: 0,
    conflicts: [],
    databaseLabel: "app",
    directory: "athena/migrations",
    dryRun: true,
    failedCount: 0,
    mode: "dry-run",
    newlyApplied: [],
    pendingCount: 0,
    plan: { applied: [], conflicts: [], pending: [] },
    providerLabel: "postgres/direct",
    skippedCount: 0,
  };

  const previous = process.exitCode;
  process.exitCode = undefined;
  try {
    await runCLI(["migrate", "--dry-run"], {
      runMigrations: async () => summary,
      log: () => undefined,
      errorLog: () => undefined,
    });
    assert.equal(process.exitCode === undefined || process.exitCode === 0, true);
  } finally {
    process.exitCode = previous;
  }
});
