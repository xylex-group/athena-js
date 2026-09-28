import { strict as assert } from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CLI_COMMAND_REGISTRY } from "../src/cli/commands/register.ts";
import {
  getCliExitCode,
  setCliExitCode,
  withCliExitCodeContext,
} from "../src/cli/exit-code.ts";
import { CliExitCode, parseCommand, runCLI } from "../src/cli/index.ts";
import { createCliLogger } from "../src/cli/logging/logger.ts";
import { createCliTraceContext } from "../src/cli/logging/tracer.ts";
import { parseCommandResolved } from "../src/cli/parse-command.ts";
import { defineCommand } from "../src/cli/platform/define-command.ts";
import { dispatchRegistered } from "../src/cli/platform/execute.ts";
import {
  CLI_JSON_SCHEMA_VERSION,
  encodeCliJsonFailure,
  encodeCliJsonSuccess,
  peelGlobalFlags,
} from "../src/cli/platform/index.ts";
import { CommandRegistry } from "../src/cli/platform/registry.ts";
import { resolveCliCapabilities } from "../src/cli/ui/capabilities.ts";

test("registry is the executable SSOT for migrate subcommands", () => {
  const ids = CLI_COMMAND_REGISTRY.ids();
  assert.equal(ids.includes("migrate"), true);
  assert.equal(ids.includes("migrate.plan"), true);
  assert.equal(ids.includes("migrate.status"), true);
  assert.equal(ids.includes("migrate.check"), true);
  assert.equal(ids.includes("migrate.reconcile"), true);
  assert.equal(ids.includes("migrate.repair"), true);
  assert.ok(CLI_COMMAND_REGISTRY.findByPath(["migrate", "plan"]));
  assert.equal(
    CLI_COMMAND_REGISTRY.match(["migrate", "plan", "--json"])?.command.id,
    "migrate.plan"
  );
});

test("peelGlobalFlags treats --json/-j as --output json and leaves command argv", () => {
  const peeled = peelGlobalFlags([
    "migrate",
    "plan",
    "--json",
    "--config",
    "./athena.config.ts",
    "--strict",
  ]);
  assert.equal(peeled.globals.output, "json");
  assert.equal(peeled.globals.strict, true);
  assert.equal(peeled.globals.configPath, "./athena.config.ts");
  assert.deepEqual(peeled.argv, ["migrate", "plan"]);

  const alias = peelGlobalFlags(["doctor", "-j"]);
  assert.equal(alias.globals.output, "json");
  assert.deepEqual(alias.argv, ["doctor"]);
});

test("peelGlobalFlags accepts -o as a report file path", () => {
  const file = peelGlobalFlags([
    "migrate",
    "check",
    "--strict",
    "-o",
    "strict.txt",
  ]);
  assert.equal(file.globals.output, "text");
  assert.equal(file.globals.outputPath, "strict.txt");
  assert.equal(file.globals.strict, true);
  assert.deepEqual(file.argv, ["migrate", "check"]);

  const format = peelGlobalFlags(["migrate", "status", "-o", "json"]);
  assert.equal(format.globals.output, "json");
  assert.equal(format.globals.outputPath, undefined);

  const both = peelGlobalFlags([
    "migrate",
    "check",
    "--json",
    "--out-file",
    "strict.json",
  ]);
  assert.equal(both.globals.output, "json");
  assert.equal(both.globals.outputPath, "strict.json");
});

test("peelGlobalFlags keeps -v/-q for version and -C for commands", () => {
  const version = peelGlobalFlags(["-v", "--short"]);
  assert.equal(version.globals.verbosity, "normal");
  assert.deepEqual(version.argv, ["-v", "--short"]);

  const quietVersion = peelGlobalFlags(["version", "-q"]);
  assert.equal(quietVersion.globals.verbosity, "normal");
  assert.deepEqual(quietVersion.argv, ["version", "-q"]);

  const commands = peelGlobalFlags(["-C", "--json"]);
  assert.equal(commands.globals.output, "json");
  assert.deepEqual(commands.argv, ["-C"]);

  const verbose = peelGlobalFlags(["doctor", "--verbose"]);
  assert.equal(verbose.globals.verbosity, "verbose");
  assert.deepEqual(verbose.argv, ["doctor"]);
});

test("parseCommand still returns legacy migrate objects after registry split", () => {
  assert.equal(parseCommand(["migrate", "plan"]).command, "migrate");
  assert.equal(
    parseCommand(["migrate", "plan"]).command === "migrate" &&
      parseCommand(["migrate", "plan"]).mode,
    "plan"
  );
  assert.equal(
    parseCommand(["migrate", "plan", "--json"]).command === "migrate" &&
      parseCommand(["migrate", "plan", "--json"]).json,
    true
  );
});

test("resolved parsing retains the exact canonical registration", () => {
  const plan = parseCommandResolved(["migrate", "plan"]);
  const status = parseCommandResolved(["migrate", "status"]);
  const alias = parseCommandResolved(["key", "list"]);
  assert.equal(plan.registration.id, "migrate.plan");
  assert.equal(status.registration.id, "migrate.status");
  assert.equal(alias.registration.id, "api-key");
  assert.equal(plan.value.command, "migrate");
});

test("command registry rejects duplicate canonical ids", () => {
  const command = defineCommand({
    legacy: "help",
    parse: () => ({ command: "help", topic: "root" }),
    path: ["one"],
    run: async () => undefined,
    usage: () => "",
  });
  assert.throws(
    () => new CommandRegistry([command, { ...command, path: ["two"] }]),
    /duplicate command id/i
  );
});

test("concurrent CLI exit contexts remain isolated", async () => {
  const observed: number[] = [];
  await Promise.all([
    withCliExitCodeContext(async () => {
      setCliExitCode(3);
      await new Promise((resolve) => setTimeout(resolve, 5));
      observed.push(getCliExitCode() ?? -1);
    }),
    withCliExitCodeContext(async () => {
      setCliExitCode(5);
      await new Promise((resolve) => setTimeout(resolve, 1));
      observed.push(getCliExitCode() ?? -1);
    }),
  ]);
  assert.deepEqual(observed.sort(), [3, 5]);
});

test("dispatch owns failed command results and emits one structured error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "athena-cli-command-result-"));
  const env = {
    ATHENA_CLI_LOG: "all",
    ATHENA_HOME: dir,
  };
  const command = defineCommand({
    legacy: "help",
    parse: () => ({ command: "help", topic: "root" }),
    path: ["failure"],
    run: async () => ({
      category: "domain" as const,
      code: "CLI_TEST_FAILURE",
      exitCode: CliExitCode.Validation,
      message: "expected domain failure",
      ok: false,
    }),
    usage: () => "",
  });
  const registry = new CommandRegistry([command]);
  const logger = createCliLogger({ env });
  const globals = peelGlobalFlags([]).globals;
  const context = {
    capabilities: resolveCliCapabilities({ plain: true }),
    cwd: dir,
    errorLog: () => undefined,
    globals,
    log: () => undefined,
    logger,
    logRaw: () => undefined,
    output: "text" as const,
    presentation: { forceColor: false, noColor: true },
    reportError: () => undefined,
    runtime: {},
    trace: createCliTraceContext(logger),
    verbosity: "normal" as const,
  };

  await assert.rejects(
    () =>
      dispatchRegistered(registry, context, {
        registration: command,
        sanitizedArgv: ["failure"],
        value: { command: "help", topic: "root" },
      }),
    /expected domain failure/
  );
  logger.finish({ exitCode: CliExitCode.Validation, outcome: "failure" });
  await logger.flush();
  const events = readFileSync(logger.logPath ?? "", "utf8")
    .trim()
    .split("\n")
    .map(
      (line) =>
        JSON.parse(line) as { kind?: string; error?: { message?: string } }
    );
  assert.equal(events.filter((event) => event.kind === "error").length, 1);
  assert.equal(
    events.some((event) => event.error?.message === "expected domain failure"),
    true
  );
});

test("JSON protocol encodes schemaVersion 1 success and failure envelopes", () => {
  assert.deepEqual(encodeCliJsonSuccess("migrate.plan", { pending: 2 }), {
    command: "migrate.plan",
    data: { pending: 2 },
    ok: true,
    schemaVersion: CLI_JSON_SCHEMA_VERSION,
  });
  assert.deepEqual(
    encodeCliJsonFailure("migrate.apply", {
      code: "ATHENA_MIGRATION_CHECKSUM_MISMATCH",
      hint: "athena-js migrate reconcile",
      message: "checksum mismatch",
    }),
    {
      command: "migrate.apply",
      error: {
        code: "ATHENA_MIGRATION_CHECKSUM_MISMATCH",
        hint: "athena-js migrate reconcile",
        message: "checksum mismatch",
      },
      ok: false,
      schemaVersion: CLI_JSON_SCHEMA_VERSION,
    }
  );
});

test("runCLI unknown command uses usage exit code 2 and JSON envelope for --json", async () => {
  const previous = process.exitCode;
  process.exitCode = undefined;
  const errors: string[] = [];
  try {
    await runCLI(["generat"], {
      errorLog: (message) => {
        errors.push(message);
      },
      log: () => undefined,
    });
    assert.equal(process.exitCode, CliExitCode.Usage);
    assert.equal(
      errors.some((line) => line.includes('Unknown command "generat"')),
      true
    );
  } finally {
    process.exitCode = previous;
  }

  process.exitCode = undefined;
  const logs: string[] = [];
  try {
    await runCLI(["generat", "--json"], {
      errorLog: () => undefined,
      log: (message) => {
        logs.push(message);
      },
    });
    assert.equal(process.exitCode, CliExitCode.Usage);
    const envelope = JSON.parse(logs[0] ?? "{}") as {
      schemaVersion?: number;
      ok?: boolean;
      error?: { code?: string };
    };
    assert.equal(envelope.schemaVersion, 1);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error?.code, "CLI002");
  } finally {
    process.exitCode = previous;
  }
});

test("global parse failures print one user-facing error", async () => {
  const previous = process.exitCode;
  process.exitCode = undefined;
  const errors: string[] = [];
  try {
    const summary = await runCLI(["--output"], {
      env: {
        ATHENA_CLI_LOG: "off",
        ATHENA_HOME: mkdtempSync(join(tmpdir(), "athena-cli-global-parse-")),
      },
      errorLog: (message) => errors.push(message),
      log: () => undefined,
    });
    assert.equal(summary.exitCode, CliExitCode.Usage);
    assert.equal(errors.length, 1);
  } finally {
    process.exitCode = previous;
  }
});

test("runCLI -o writes the report to a file", async () => {
  const previous = process.exitCode;
  process.exitCode = undefined;
  const dir = mkdtempSync(join(tmpdir(), "athena-cli-out-"));
  const dest = join(dir, "strict.txt");
  try {
    await runCLI(["generat", "-o", dest], {
      errorLog: () => undefined,
      log: () => undefined,
    });
    assert.equal(process.exitCode, CliExitCode.Usage);
    const body = readFileSync(dest, "utf8");
    assert.match(body, /Unknown command "generat"/);
  } finally {
    process.exitCode = previous;
    rmSync(dir, { force: true, recursive: true });
  }
});
