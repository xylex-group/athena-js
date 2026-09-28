import { strict as assert } from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { CLI_COMMAND_REGISTRY } from "../src/cli/commands/register.ts";
import { formatDbLogsOutput } from "../src/cli/commands/db/index.ts";
import { createCliUi } from "../src/cli/ui/index.ts";
import { runCLI, usage, type CliRuntime } from "../src/cli/index.ts";
import {
  parseRegisteredCommand,
  parseRegisteredCommandResolved,
} from "../src/cli/platform/parse.ts";
import type { LocalPostgresRuntime } from "../src/local/runtime.ts";
import type { MigrationRunSummary, RunMigrationsOptions } from "../src/migrations/types.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const localRuntimeState = {
  containerName: "athena-postgres-test",
  createdAt: "2026-09-08T00:00:00.000Z",
  database: "app_db",
  identity: "test-project",
  image: "postgres:17-alpine",
  password: "secret",
  port: 55_432,
  user: "postgres",
  volumeName: "athena-postgres-test",
};

function createTestLocalRuntime(
  options: Parameters<NonNullable<CliRuntime["createLocalRuntime"]>>[0]
): LocalPostgresRuntime {
  return {
    async restart() {
      await options.migrate?.("postgres://127.0.0.1:55432/app_db");
      return localRuntimeState;
    },
    async start() {
      await options.migrate?.("postgres://127.0.0.1:55432/app_db");
      return localRuntimeState;
    },
  } as unknown as LocalPostgresRuntime;
}

function successfulMigrationSummary(): MigrationRunSummary {
  return {
    appliedCount: 1,
    conflicts: [],
    databaseLabel: "app_db",
    directory: "athena/migrations",
    dryRun: false,
    failedCount: 0,
    mode: "apply",
    newlyApplied: [],
    pendingCount: 0,
    plan: { applied: [], conflicts: [], pending: [] },
    providerLabel: "postgres/direct",
    skippedCount: 0,
  };
}

function runMigrationsWithReport(output: string[]) {
  return async (options: RunMigrationsOptions): Promise<MigrationRunSummary> => {
    const ui =
      options.ui ??
      createCliUi({
        json: options.json,
        plain: options.plain,
        write: (message) => {
          output.push(message);
        },
      });
    ui.renderMigrationReport({
      application: { rows: [] },
      auth: { rows: [] },
      diagnostics: [],
      outcome: "1 migration(s) applied",
      title: "Migrations",
    });
    return successfulMigrationSummary();
  };
}

test("billing root and webhook subcommands resolve -h to help", () => {
  assert.equal(
    parseRegisteredCommand(CLI_COMMAND_REGISTRY, ["billing", "-h"]).command,
    "help"
  );
  assert.equal(
    parseRegisteredCommand(CLI_COMMAND_REGISTRY, ["billing", "--help"]).command,
    "help"
  );
  const webhookHelp = parseRegisteredCommand(CLI_COMMAND_REGISTRY, [
    "billing",
    "webhooks",
    "reconcile",
    "-h",
  ]);
  assert.equal(webhookHelp.command, "help");
  assert.equal(
    webhookHelp.command === "help" ? webhookHelp.topic : "",
    "billing"
  );
});

test("bare db resolves to the help registration without a runtime", async () => {
  const parsed = parseRegisteredCommand(CLI_COMMAND_REGISTRY, ["db"]);
  assert.deepEqual(parsed, { command: "help", topic: "db" });

  const resolved = parseRegisteredCommandResolved(CLI_COMMAND_REGISTRY, ["db"]);
  assert.deepEqual(resolved.value, { command: "help", topic: "db" });
  assert.deepEqual(resolved.registration.path, ["help"]);

  let createdRuntime = false;
  const logs: string[] = [];
  const result = await runCLI(["db"], {
    createLocalRuntime: () => {
      createdRuntime = true;
      return {} as unknown as LocalPostgresRuntime;
    },
    log: (message) => {
      logs.push(message);
    },
  });
  assert.equal(result.outcome, "success");
  assert.equal(createdRuntime, false);
  assert.equal(logs.join("\n").includes("Usage:"), true);
  assert.equal(logs.join("\n").includes("athena-js db start"), true);
});

test("db usage documents actions instead of flags after db", () => {
  const db = usage("db");
  assert.equal(db.includes("athena-js db start"), true);
  assert.equal(db.includes("athena-js db stop"), true);
  assert.equal(db.includes("athena-js db status"), true);
  assert.equal(db.includes("athena-js db restart"), true);
  assert.equal(db.includes("athena-js db reset"), true);
  assert.equal(db.includes("athena-js db logs"), true);
  assert.equal(db.includes("athena-js db --config"), false);
});

test("db lifecycle commands parse through the executable registry", () => {
  const parsed = parseRegisteredCommand(CLI_COMMAND_REGISTRY, [
    "db",
    "start",
    "--write-env",
    "--force",
  ]);
  assert.deepEqual(parsed, {
    action: "start",
    command: "db",
    configPath: undefined,
    force: true,
    json: false,
    writeEnv: true,
    yes: false,
  });

  assert.deepEqual(
    parseRegisteredCommand(CLI_COMMAND_REGISTRY, ["db", "reset", "--yes"]),
    {
      action: "reset",
      command: "db",
      configPath: undefined,
      force: false,
      json: false,
      writeEnv: false,
      yes: true,
    }
  );
});

test("db logs JSON output is a stable object", () => {
  assert.equal(
    formatDbLogsOutput("postgres ready\n", true),
    JSON.stringify({ logs: "postgres ready\n" })
  );
});

test("db cleanup commands do not require a readable athena config", async () => {
  for (const action of ["stop", "reset", "logs"] as const) {
    const root = mkdtempSync(join(tmpdir(), `athena-db-${action}-broken-config-`));
    try {
      writeFileSync(join(root, "athena.config.ts"), "throw new Error('broken');\n");
      const options: Parameters<
        NonNullable<CliRuntime["createLocalRuntime"]>
      >[0][] = [];
      const runtime: CliRuntime = {
        createLocalRuntime: (runtimeOptions) => {
          options.push(runtimeOptions);
          return {
            async logs() {
              return "postgres logs\n";
            },
            async reset() {},
            async stop() {},
          } as unknown as LocalPostgresRuntime;
        },
        cwd: root,
        log: () => undefined,
      };
      const result = await runCLI([
        "db",
        action,
        ...(action === "reset" ? ["--yes"] : []),
      ], runtime);
      assert.equal(result.outcome, "success");
      assert.equal(options.length, 1);
      assert.equal(options[0]?.config, undefined);
      assert.equal(options[0]?.projectRoot, root);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
});

test("db cleanup commands work when the project config is missing", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-db-missing-config-"));
  try {
    let receivedConfigPath: string | undefined;
    const result = await runCLI(["db", "stop"], {
      createLocalRuntime: (options) => {
        receivedConfigPath = options.configPath;
        return {
          async stop() {},
        } as unknown as LocalPostgresRuntime;
      },
      cwd: root,
      log: () => undefined,
    });
    assert.equal(result.outcome, "success");
    assert.equal(receivedConfigPath, join(root, "athena.config.ts"));
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("db start and restart JSON keep nested migration output off stdout", async () => {
  for (const action of ["start", "restart"] as const) {
    const logs: string[] = [];
    const migrationOutput: string[] = [];
    const runtime: CliRuntime = {
      createLocalRuntime: createTestLocalRuntime,
      cwd: packageRoot,
      log: (message) => {
        logs.push(message);
      },
      runMigrations: runMigrationsWithReport(migrationOutput),
    };

    const result = await runCLI(["db", action, "--json"], runtime);

    assert.equal(result.outcome, "success");
    assert.deepEqual(migrationOutput, []);
    assert.equal(logs.length, 1);
    const output = logs[0];
    assert.ok(output);
    assert.deepEqual(JSON.parse(output), {
      database: "app_db",
      port: 55_432,
      status: "healthy",
    });
  }
});

test("db start keeps nested migration output in human mode", async () => {
  const logs: string[] = [];
  const migrationOutput: string[] = [];
  const result = await runCLI(["db", "start"], {
    createLocalRuntime: createTestLocalRuntime,
    cwd: packageRoot,
    log: (message) => {
      logs.push(message);
    },
    runMigrations: runMigrationsWithReport(migrationOutput),
  });

  assert.equal(result.outcome, "success");
  assert.equal(migrationOutput.length > 0, true);
  assert.deepEqual(logs, ["Local PostgreSQL is healthy on 55432."]);
});

test("db start propagates nested migration failures", async () => {
  const logs: string[] = [];
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const result = await runCLI(["db", "start", "--json"], {
      createLocalRuntime: createTestLocalRuntime,
      cwd: packageRoot,
      log: (message) => {
        logs.push(message);
      },
      runMigrations: async () => {
        throw new Error("nested migration failed");
      },
    });

    assert.equal(result.outcome, "failure");
    assert.equal(logs.length, 1);
    const output = logs[0];
    assert.ok(output);
    assert.match(output, /nested migration failed/);
  } finally {
    process.exitCode = previousExitCode;
  }
});
