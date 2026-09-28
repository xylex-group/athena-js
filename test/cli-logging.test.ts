import { strict as assert } from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBootstrapSession } from "../bin/bootstrap-logging.js";
import { isDebugEnabled, withCliDebugContext } from "../src/cli/debug.ts";
import { gatewayAdminRequest } from "../src/cli/gateway-admin.ts";
import { runCLI } from "../src/cli/index.ts";
import {
  exportCliLog,
  listCliLogs,
  pruneCliLogs,
  resolveLatestCompletedLog,
} from "../src/cli/logging/inventory.ts";
import { createCliLogger } from "../src/cli/logging/logger.ts";
import {
  resolveAthenaCliLogPaths,
  resolveAthenaHome,
} from "../src/cli/logging/paths.ts";
import {
  redactSecrets,
  redactValue,
  sanitizeCliArgv,
  serializeCliLogEvent,
} from "../src/cli/logging/redact.ts";
import { createCliTraceContext } from "../src/cli/logging/tracer.ts";
import { PACKAGE_VERSION } from "../src/sdk-version.ts";

function testEnv(home: string): Record<string, string> {
  return {
    ATHENA_CLI_LOG: "all",
    ATHENA_HOME: home,
  };
}

function readEvents(logPath: string): Array<Record<string, unknown>> {
  return readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("resolves the default and override Athena homes to absolute paths", () => {
  const home = resolveAthenaHome({ ATHENA_HOME: ".athena-test" }, "C:\\work");
  assert.equal(home, "C:\\work\\.athena-test");
  assert.equal(
    resolveAthenaHome({ HOME: "C:\\ignored" }, "C:\\work"),
    join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".athena")
  );

  const paths = resolveAthenaCliLogPaths({
    command: "dangerous/command",
    env: testEnv("C:\\work\\.athena"),
    invocationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    now: new Date("2026-08-29T16:42:12.120Z"),
  });
  assert.equal(paths.home, "C:\\work\\.athena");
  assert.match(
    paths.logFile,
    /20260829T164212\.120Z-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\.jsonl$/
  );
  assert.equal(paths.logFile.includes("dangerous"), false);
  assert.equal(paths.dayDir.split(sep).at(-1), "2026-08-29");
});

test("flush waits for ordered events and children share one sink", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-log-"));
  const logger = createCliLogger({
    env: testEnv(home),
    invocationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    now: new Date("2026-08-29T16:42:12.120Z"),
  });
  const child = logger.child({ password: "do-not-write", requestId: "req-1" });

  for (let index = 0; index < 100; index += 1) {
    logger.info(`event-${index}`);
  }
  child.info("child-event");
  logger.finish({ exitCode: 0, outcome: "success" });
  logger.finish({ exitCode: 1, outcome: "failure" });
  await child.flush();

  const events = readEvents(logger.logPath ?? "");
  assert.equal(
    events.filter((event) => event.kind === "invocation.finish").length,
    1
  );
  assert.equal(new Set(events.map((event) => event.invocationId)).size, 1);
  assert.equal(new Set(events.map((event) => event.traceId)).size, 1);
  assert.deepEqual(
    events.map((event) => event.sequence),
    events.map((_, index) => index + 1)
  );
  assert.equal(
    events.some((event) => JSON.stringify(event).includes("do-not-write")),
    false
  );
  assert.equal(statSync(logger.logPath ?? "").isFile(), true);
});

test("errors mode persists buffered failures but creates no successful log", async () => {
  const successHome = await mkdtemp(
    join(tmpdir(), "athena-cli-errors-success-")
  );
  const success = createCliLogger({
    env: { ...testEnv(successHome), ATHENA_CLI_LOG: "errors" },
    invocationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  });
  success.info("discarded");
  success.finish({ exitCode: 0, outcome: "success" });
  await success.flush();
  assert.equal(existsSync(join(successHome, "logs")), false);

  const failureHome = await mkdtemp(
    join(tmpdir(), "athena-cli-errors-failure-")
  );
  const failure = createCliLogger({
    env: { ...testEnv(failureHome), ATHENA_CLI_LOG: "errors" },
    invocationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  });
  failure.info("before failure");
  failure.finish({ exitCode: 1, outcome: "failure" });
  await failure.flush();
  assert.equal(
    readEvents(failure.logPath ?? "").at(-1)?.kind,
    "invocation.finish"
  );
});

test("filesystem logging failures remain fail-open", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-log-failure-"));
  const blockedHome = join(home, "not-a-directory");
  await writeFile(blockedHome, "occupied", "utf8");
  const logger = createCliLogger({
    env: testEnv(blockedHome),
    invocationId: "12121212-1212-4121-8121-121212121212",
  });
  logger.info("business operation still succeeds");
  logger.finish({ exitCode: 0, outcome: "success" });
  await assert.doesNotReject(() => logger.flush());
  assert.equal(logger.loggingFailed, true);
});

test("redaction preserves diagnostic codes and removes unlabeled credentials", () => {
  const apiKey = "ath_live_0123456789abcdef0123456789abcdef";
  const generatedKey = "a8Kx1ZpQ7mN2vR5tY9cL3sD6fG0hJ4kU8wE2nB6qP1x";
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.signature";
  const privateKey = [
    "-----BEGIN PRIVATE KEY-----",
    "super-secret-key-material",
    "-----END PRIVATE KEY-----",
  ].join("\n");
  const raw = [
    "postgresql://admin:hunter2@example.com:5432/neondb?sslmode=require",
    "https://user:password@example.com/callback?access_token=query-secret",
    `Authorization: Bearer ${apiKey}`,
    "Cookie: session=secret-cookie",
    `generated=${apiKey}`,
    generatedKey,
    `jwt=${jwt}`,
    privateKey,
    "Mollie access token: live_abcdefghijklmnopqrstuvwxyz",
    "Stripe token: sk_live_abcdefghijklmnopqrstuvwxyz",
  ].join("\n");

  const redacted = redactSecrets(raw);
  assert.equal(redacted.includes("hunter2"), false);
  assert.equal(redacted.includes("query-secret"), false);
  assert.equal(redacted.includes(apiKey), false);
  assert.equal(redacted.includes(generatedKey), false);
  assert.equal(redacted.includes(jwt), false);
  assert.equal(redacted.includes("secret-cookie"), false);
  assert.equal(redacted.includes("super-secret-key-material"), false);
  assert.equal(redacted.includes("live_abcdefghijklmnopqrstuvwxyz"), false);
  assert.equal(redacted.includes("sk_live_abcdefghijklmnopqrstuvwxyz"), false);
  assert.match(
    redacted,
    /postgresql:\/\/admin:\*\*\*@example\.com:5432\/neondb/
  );

  const error = redactValue({
    code: "ATHENA_MIGRATION_CHECKSUM_MISMATCH",
    databaseUrl: "postgresql://admin:hunter2@example.com/neondb",
    password: "secret",
    sqlState: "42P01",
    traceId: "0123456789abcdef0123456789abcdef",
  });
  assert.equal(
    (error as { code: string }).code,
    "ATHENA_MIGRATION_CHECKSUM_MISMATCH"
  );
  assert.equal((error as { sqlState: string }).sqlState, "42P01");
  assert.equal((error as { password: string }).password, "***");
  assert.equal(
    (error as { databaseUrl: string }).databaseUrl.includes("hunter2"),
    false
  );
});

test("redaction safely handles cyclic metadata", () => {
  const cyclic: Record<string, unknown> = { code: "CLI001" };
  cyclic.self = cyclic;
  assert.doesNotThrow(() => redactValue(cyclic));
  const sanitized = redactValue(cyclic) as { self?: unknown };
  assert.equal(sanitized.self, "[Circular]");
});

test("serializes bounded events as valid JSON when metadata is oversized", () => {
  const oversized = {
    data: { values: Array.from({ length: 100 }, () => "x".repeat(4096)) },
    invocationId: "11111111-1111-4111-8111-111111111111",
    kind: "diagnostic" as const,
    level: "info" as const,
    schemaVersion: 1 as const,
    sequence: 1,
    timestamp: new Date().toISOString(),
    traceId: "22222222222222222222222222222222",
  };
  const encoded = serializeCliLogEvent(oversized);
  assert.doesNotThrow(() => JSON.parse(encoded));
  assert.equal(Buffer.byteLength(encoded, "utf8") < 64 * 1024, true);
  assert.equal(
    (JSON.parse(encoded) as { truncated?: boolean }).truncated,
    true
  );
});

test("trace spans retain the original error and record lifecycle events", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-trace-"));
  const logger = createCliLogger({
    env: testEnv(home),
    invocationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  });
  const trace = createCliTraceContext(logger);
  await assert.rejects(
    trace.span(
      "database.discover",
      { connectionString: "postgresql://u:p@host/db" },
      async () => {
        throw new Error("database failed");
      }
    ),
    /database failed/
  );
  logger.finish({ exitCode: 1, outcome: "failure" });
  await logger.flush();

  const events = readEvents(logger.logPath ?? "");
  assert.equal(
    events.some((event) => event.kind === "call.start"),
    true
  );
  const errorEvents = events.filter((event) => event.kind === "error");
  const failedSpan = events.find(
    (event) => event.kind === "call.finish" && event.data?.success === false
  );
  assert.equal(errorEvents.length, 1);
  assert.equal(typeof errorEvents[0]?.errorId, "string");
  assert.equal(failedSpan?.data?.errorId, errorEvents[0]?.errorId);
  assert.equal(failedSpan?.error, undefined);
  assert.equal(
    events.some((event) => JSON.stringify(event).includes("u:p@host")),
    false
  );
});

test("the logger records one authoritative structured error per throwable", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-error-dedupe-"));
  const logger = createCliLogger({
    env: testEnv(home),
    invocationId: "23232323-2323-4232-8232-232323232323",
  });
  const failure = new Error("same failure");
  logger.error("first report", undefined, failure);
  logger.error("duplicate report", undefined, failure);
  logger.finish({ exitCode: 1, outcome: "failure" });
  await logger.flush();

  const errors = readEvents(logger.logPath ?? "").filter(
    (event) => event.kind === "error"
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.error?.message, "same failure");
});

test("caught command failures still produce one structured error event", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-caught-error-"));
  const env = testEnv(home);
  const summary = await runCLI(["api-key", "list"], {
    cwd: home,
    env,
    errorLog: () => undefined,
    log: () => undefined,
  });
  assert.notEqual(summary.exitCode, 0);
  const events = readEvents(summary.logPath ?? "");
  assert.equal(events.filter((event) => event.kind === "error").length, 1);
});

test("logging metadata never persists raw argv", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-raw-argv-"));
  const logger = createCliLogger({
    baseMetadata: {
      rawArgv: ["api-key", "list", "--admin-key", "short"],
    },
    env: testEnv(home),
  });
  logger.finish({ exitCode: 0, outcome: "success" });
  await logger.flush();
  const text = readFileSync(logger.logPath ?? "", "utf8");
  assert.equal(text.includes("rawArgv"), false);
  assert.equal(text.includes("short"), false);
});

test("short generated base64url secrets are redacted from output events", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-short-secret-"));
  const logger = createCliLogger({ env: testEnv(home) });
  const secret = "aB3dE5gH7jK9mN2pQ4sT6v";
  logger.info(secret);
  logger.finish({ exitCode: 0, outcome: "success" });
  await logger.flush();
  assert.equal(
    readFileSync(logger.logPath ?? "", "utf8").includes(secret),
    false
  );
});

test("no-log disables persistent logging for the complete invocation", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-no-log-"));
  const summary = await runCLI(["version", "--short", "--no-log"], {
    env: testEnv(home),
    errorLog: () => undefined,
    log: () => undefined,
  });
  assert.equal(summary.logPath, undefined);
  assert.equal(existsSync(join(home, "logs")), false);
});

test("runCLI records parse, command, output, and final invocation lifecycle", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-run-"));
  const logger = createCliLogger({
    env: testEnv(home),
    invocationId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  });
  const output: string[] = [];
  const summary = await runCLI(["version", "--short"], {
    errorLog: (message) => output.push(message),
    log: (message) => output.push(message),
    logger,
  });
  logger.finish(summary);
  await logger.flush();

  const events = readEvents(logger.logPath ?? "");
  assert.deepEqual(output, [PACKAGE_VERSION]);
  assert.equal(
    events.some((event) => event.kind === "parse.start"),
    true
  );
  assert.equal(
    events.some((event) => event.kind === "command.start"),
    true
  );
  assert.equal(
    events.some((event) => event.kind === "command.finish"),
    true
  );
  assert.equal(
    events.filter((event) => event.kind === "invocation.finish").length,
    1
  );
  assert.equal(events.at(-1)?.outcome, "success");
});

test("logs list and latest expose persisted invocations without raw secrets", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-inventory-"));
  const env = testEnv(home);
  const versionOutput: string[] = [];
  await runCLI(["version"], {
    env,
    log: (message) => versionOutput.push(message),
  });

  const listOutput: string[] = [];
  await runCLI(["logs", "list", "--json"], {
    env,
    log: (message) => listOutput.push(message),
  });
  const listed = JSON.parse(listOutput.at(-1) ?? "{}") as {
    data?: { logs?: Array<{ invocationId?: string }> };
  };
  assert.equal(versionOutput.length, 1);
  assert.equal((listed.data?.logs?.length ?? 0) >= 1, true);

  const latestOutput: string[] = [];
  await runCLI(["logs", "latest", "--json"], {
    env,
    log: (message) => latestOutput.push(message),
  });
  const latest = JSON.parse(latestOutput.at(-1) ?? "{}") as {
    data?: { events?: Array<{ kind?: string }> };
  };
  assert.equal(
    latest.data?.events?.some((event) => event.kind === "invocation.start"),
    true
  );
});

test("Athena-owned gateway requests propagate local trace correlation", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-http-trace-"));
  const logger = createCliLogger({
    env: testEnv(home),
    invocationId: "13131313-1313-4131-8131-131313131313",
  });
  let requestHeaders: Headers | undefined;
  await gatewayAdminRequest({
    adminKey: "secret-admin-key",
    baseUrl: "https://gateway.example.com",
    fetchImpl: async (_url, init) => {
      requestHeaders = new Headers(init?.headers);
      return new Response("{}", { status: 200 });
    },
    method: "GET",
    path: "/admin/health",
    trace: createCliTraceContext(logger),
  });
  assert.match(
    requestHeaders?.get("traceparent") ?? "",
    /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/
  );
  assert.equal(
    requestHeaders?.get("x-athena-invocation-id"),
    logger.invocationId
  );
  logger.finish({ exitCode: 0, outcome: "success" });
  await logger.flush();
});

test("nested and parallel spans use the active parent span", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-trace-parent-"));
  const logger = createCliLogger({
    env: testEnv(home),
    invocationId: "14141414-1414-4141-8141-141414141414",
  });
  const trace = createCliTraceContext(logger);
  await trace.span("parent", undefined, async () => {
    await trace.span("child", undefined, () => undefined);
    await Promise.all([
      trace.span("parallel-a", undefined, () => undefined),
      trace.span("parallel-b", undefined, () => undefined),
    ]);
  });
  logger.finish({ exitCode: 0, outcome: "success" });
  await logger.flush();

  const starts = readEvents(logger.logPath ?? "").filter(
    (event) => event.kind === "call.start"
  );
  const parent = starts.find((event) => event.data?.name === "parent");
  const child = starts.find((event) => event.data?.name === "child");
  const parallel = starts.filter((event) =>
    ["parallel-a", "parallel-b"].includes(String(event.data?.name))
  );
  assert.equal(typeof parent?.spanId, "string");
  assert.equal(child?.parentSpanId, parent?.spanId);
  assert.equal(parallel.length, 2);
  assert.equal(parallel[0]?.parentSpanId, parent?.spanId);
  assert.equal(parallel[1]?.parentSpanId, parent?.spanId);
  assert.notEqual(parallel[0]?.spanId, parallel[1]?.spanId);
});

test("logger rejects all-zero trace identities", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-trace-id-"));
  const logger = createCliLogger({
    env: testEnv(home),
    invocationId: "26262626-2626-4262-8262-262626262626",
    traceId: "00000000000000000000000000000000",
  });
  logger.finish({ exitCode: 0, outcome: "success" });
  await logger.flush();
  const events = readEvents(logger.logPath ?? "");
  assert.match(events[0]?.traceId as string, /^[0-9a-f]{32}$/);
  assert.notEqual(events[0]?.traceId, "00000000000000000000000000000000");
});

test("gateway traceparent uses the local request span id", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-http-span-"));
  const logger = createCliLogger({
    env: testEnv(home),
    invocationId: "15151515-1515-4151-8151-151515151515",
  });
  let requestHeaders: Headers | undefined;
  await gatewayAdminRequest({
    adminKey: "secret-admin-key",
    baseUrl: "https://gateway.example.com",
    fetchImpl: async (_url, init) => {
      requestHeaders = new Headers(init?.headers);
      return new Response("{}", { status: 200 });
    },
    method: "GET",
    path: "/admin/health",
    trace: createCliTraceContext(logger),
  });
  logger.finish({ exitCode: 0, outcome: "success" });
  await logger.flush();

  const requestStart = readEvents(logger.logPath ?? "").find(
    (event) =>
      event.kind === "call.start" &&
      event.data?.name === "gateway.admin.request"
  );
  const traceparentSpanId = requestHeaders?.get("traceparent")?.split("-")[2];
  assert.equal(traceparentSpanId, requestStart?.spanId);
});

test("concurrent debug contexts do not overwrite one another", async () => {
  const observed: boolean[] = [];
  await Promise.all([
    withCliDebugContext(true, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      observed.push(isDebugEnabled());
    }),
    withCliDebugContext(false, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      observed.push(isDebugEnabled());
    }),
  ]);
  assert.deepEqual(observed.sort(), [false, true]);
});

test("latest completed log excludes the active invocation", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-latest-completed-"));
  const env = testEnv(home);
  const previous = createCliLogger({
    env,
    invocationId: "16161616-1616-4161-8161-161616161616",
  });
  previous.info("completed invocation");
  previous.finish({ exitCode: 0, outcome: "success" });
  await previous.flush();

  const active = createCliLogger({
    env,
    invocationId: "17171717-1717-4171-8171-171717171717",
  });
  active.info("active invocation");
  await active.flush();

  const latest = await resolveLatestCompletedLog({
    env,
    excludeInvocationIds: [active.invocationId],
    excludePaths: [active.logPath ?? ""],
  });
  assert.equal(latest, previous.logPath);
  active.finish({ exitCode: 0, outcome: "success" });
  await active.flush();
});

test("latest resolver rejects symlink-escaped log pointers", async () => {
  if (process.platform === "win32") {
    return;
  }
  const home = await mkdtemp(join(tmpdir(), "athena-cli-latest-symlink-"));
  const env = testEnv(home);
  const paths = resolveAthenaCliLogPaths({
    env,
    invocationId: "25252525-2525-4252-8252-252525252525",
    now: new Date("2026-08-29T00:00:00.000Z"),
  });
  const outside = join(home, "outside.jsonl");
  await writeFile(
    outside,
    `${JSON.stringify({
      exitCode: 0,
      invocationId: "25252525-2525-4252-8252-252525252525",
      kind: "invocation.finish",
      level: "info",
      outcome: "success",
      schemaVersion: 1,
      sequence: 1,
      timestamp: "2026-08-29T00:00:00.000Z",
      traceId: "35353535353535353535353535353535",
    })}\n`,
    "utf8"
  );
  await mkdir(paths.dayDir, { recursive: true });
  const escaped = join(
    paths.dayDir,
    "20260829T000000.000Z-25252525-2525-4252-8252-252525252525.jsonl"
  );
  await symlink(outside, escaped);
  await mkdir(paths.cliLogsRoot, { recursive: true });
  await writeFile(
    paths.latestPointer,
    JSON.stringify({ path: escaped }),
    "utf8"
  );
  assert.equal(await resolveLatestCompletedLog({ env }), undefined);
});

test("invalid prune duration is rejected before deleting any log", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-prune-validation-"));
  const env = testEnv(home);
  const logger = createCliLogger({
    env,
    invocationId: "18181818-1818-4181-8181-181818181818",
  });
  logger.info("preserve me");
  logger.finish({ exitCode: 0, outcome: "success" });
  await logger.flush();
  const path = logger.logPath ?? "";

  await assert.rejects(
    () => pruneCliLogs({ env, olderThan: "0d" }),
    /invalid.*duration/i
  );
  assert.equal(existsSync(path), true);
});

test("logs prune maps invalid duration to usage exit code without mutation", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-prune-command-"));
  const env = testEnv(home);
  const logger = createCliLogger({
    env,
    invocationId: "24242424-2424-4242-8242-242424242424",
  });
  logger.info("preserve me");
  logger.finish({ exitCode: 0, outcome: "success" });
  await logger.flush();
  const output: string[] = [];
  const summary = await runCLI(["logs", "prune", "--older-than", "0d"], {
    env,
    errorLog: (message) => output.push(message),
    log: (message) => output.push(message),
  });
  assert.equal(summary.exitCode, 2);
  assert.equal(existsSync(logger.logPath ?? ""), true);
  assert.equal(
    output.some((line) => line.includes("Invalid --older-than")),
    true
  );
});

test("export performs a second redaction pass and creates a private artifact", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-export-"));
  const source = join(home, "source.jsonl");
  const destination = join(home, "nested", "support.jsonl");
  await writeFile(
    source,
    `${JSON.stringify({
      invocationId: "19191919-1919-4191-8191-191919191919",
      kind: "diagnostic",
      level: "info",
      message: "legacy secret=export-sentinel",
      schemaVersion: 1,
      sequence: 1,
      timestamp: new Date().toISOString(),
      traceId: "29292929292929292929292929292929",
    })}\n`,
    "utf8"
  );
  await exportCliLog(source, destination);
  const exported = readFileSync(destination, "utf8");
  assert.equal(exported.includes("export-sentinel"), false);
  if (process.platform !== "win32") {
    assert.equal(statSync(destination).mode & 0o777, 0o600);
  }
});

test("doctor bundle references the selected CLI log instead of embedding it twice", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-bundle-reference-"));
  const env = testEnv(home);
  const previous = createCliLogger({
    env,
    invocationId: "20202020-2020-4202-8202-202020202020",
  });
  previous.info("previous completed log");
  previous.finish({ exitCode: 0, outcome: "success" });
  await previous.flush();

  const outputDir = join(home, "bundle");
  await runCLI(
    ["doctor", "bundle", "--include-latest-log", "--out", outputDir],
    {
      cwd: home,
      env,
      errorLog: () => undefined,
      log: () => undefined,
      runCliDoctor: async () => ({
        checks: [],
        cwd: home,
        errorCount: 0,
        ok: true,
        resolvedMode: "none",
        sdkVersion: "0.0.0-test",
        title: "Athena JS · doctor",
        warnCount: 0,
      }),
    }
  );
  const bundle = JSON.parse(
    readFileSync(join(outputDir, "bundle.json"), "utf8")
  ) as { "cli-log.jsonl"?: unknown };
  assert.equal(typeof bundle["cli-log.jsonl"], "object");
  assert.equal(
    JSON.stringify(bundle).includes("previous completed log"),
    false
  );
});

test("normal logger completion schedules automatic retention", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-retention-"));
  const env = {
    ...testEnv(home),
    ATHENA_CLI_LOG_RETENTION_DAYS: "1",
  };
  const old = resolveAthenaCliLogPaths({
    env,
    invocationId: "21212121-2121-4212-8212-212121212121",
    now: new Date("2020-01-01T00:00:00.000Z"),
  });
  await mkdir(dirname(old.logFile), { recursive: true });
  await writeFile(
    old.logFile,
    `${JSON.stringify({
      exitCode: 0,
      invocationId: "21212121-2121-4212-8212-212121212121",
      kind: "invocation.finish",
      level: "info",
      outcome: "success",
      schemaVersion: 1,
      sequence: 1,
      timestamp: "2020-01-01T00:00:00.000Z",
      traceId: "31313131313131313131313131313131",
    })}\n`,
    "utf8"
  );
  const current = createCliLogger({
    env,
    invocationId: "22222222-2222-4222-8222-222222222222",
  });
  current.finish({ exitCode: 0, outcome: "success" });
  await current.flush();
  assert.equal(existsSync(old.logFile), false);
});

test("retention repairs a latest pointer whose target was deleted", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-retention-pointer-"));
  const env = testEnv(home);
  const old = resolveAthenaCliLogPaths({
    env,
    invocationId: "27272727-2727-4272-8272-272727272727",
    now: new Date("2020-01-01T00:00:00.000Z"),
  });
  const current = resolveAthenaCliLogPaths({
    env,
    invocationId: "28282828-2828-4282-8282-282828282828",
    now: new Date(),
  });
  await mkdir(dirname(old.logFile), { recursive: true });
  await mkdir(dirname(current.logFile), { recursive: true });
  const event = (invocationId: string, timestamp: string) =>
    JSON.stringify({
      exitCode: 0,
      invocationId,
      kind: "invocation.finish",
      level: "info",
      outcome: "success",
      schemaVersion: 1,
      sequence: 1,
      timestamp,
      traceId: "36363636363636363636363636363636",
    });
  await writeFile(
    old.logFile,
    `${event("27272727-2727-4272-8272-272727272727", "2020-01-01T00:00:00.000Z")}\n`,
    "utf8"
  );
  await writeFile(
    current.logFile,
    `${event("28282828-2828-4282-8282-282828282828", new Date().toISOString())}\n`,
    "utf8"
  );
  await mkdir(dirname(old.latestPointer), { recursive: true });
  await writeFile(
    old.latestPointer,
    JSON.stringify({ path: old.logFile }),
    "utf8"
  );

  await pruneCliLogs({ env, olderThan: "1d" });
  const pointer = JSON.parse(readFileSync(old.latestPointer, "utf8")) as {
    path?: string;
  };
  assert.equal(pointer.path, current.logFile);
});

test("semantic argv sanitization redacts secret flag values without consuming options", () => {
  assert.deepEqual(
    sanitizeCliArgv([
      "api-key",
      "create",
      "--admin-key",
      "short",
      "--url=https://gateway.example.com",
      "--ADMIN_KEY=-secret-value",
      "--admin-key",
      "--json",
      "--name",
      "demo",
      "eyJabcdefgh.payloadvalue.signaturevalue",
    ]),
    [
      "api-key",
      "create",
      "--admin-key",
      "[REDACTED]",
      "--url=https://gateway.example.com",
      "--ADMIN_KEY=[REDACTED]",
      "--admin-key",
      "--json",
      "--name",
      "demo",
      "[REDACTED]",
    ]
  );
});

test("bootstrap events adopt one canonical writer without replacing invocation identity", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-bootstrap-adoption-"));
  const env = testEnv(home);
  const bootstrap = createBootstrapSession({
    argv: ["api-key", "create", "--admin-key", "short"],
    env,
  });
  bootstrap.info("before runtime");
  const handoff = bootstrap.getBootstrapHandoff();
  assert.equal(handoff?.version, 1);
  assert.equal(handoff?.events.length, 2);
  assert.deepEqual(handoff?.sanitizedArgv, [
    "api-key",
    "create",
    "--admin-key",
    "[REDACTED]",
  ]);

  const canonical = createCliLogger({
    env,
    invocationId: handoff.invocationId,
    mode: "all",
    now: new Date(handoff.startedAt),
    skipStart: true,
    traceId: handoff.traceId,
  });
  const adoptBootstrap = canonical.adoptBootstrap;
  assert.ok(adoptBootstrap);
  adoptBootstrap(handoff);
  bootstrap.adopt(canonical);
  bootstrap.info("after runtime");
  bootstrap.finish({ exitCode: 0, outcome: "success" });
  await bootstrap.flush();

  const events = readEvents(canonical.logPath ?? "");
  assert.equal(events[0]?.kind, "invocation.start");
  assert.equal(events.at(-1)?.kind, "invocation.finish");
  assert.equal(
    events.filter((event) => event.kind === "invocation.start").length,
    1
  );
  assert.equal(new Set(events.map((event) => event.invocationId)).size, 1);
  assert.equal(new Set(events.map((event) => event.traceId)).size, 1);
  assert.equal(
    events.every((event) => event.writer === "canonical"),
    true
  );
  assert.equal(JSON.stringify(events).includes("short"), false);
});

test("runCLI adopts a launcher bootstrap session before dispatch", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-bootstrap-run-"));
  const env = testEnv(home);
  const bootstrap = createBootstrapSession({
    argv: ["version", "--short"],
    env,
  });
  const output: string[] = [];
  const summary = await runCLI(["version", "--short"], {
    env,
    log: (message) => output.push(message),
    session: bootstrap,
  });
  bootstrap.finish(summary);
  await bootstrap.flush();

  const events = readEvents(summary.logPath ?? "");
  assert.deepEqual(output, [PACKAGE_VERSION]);
  assert.equal(events[0]?.kind, "invocation.start");
  assert.equal(events.at(-1)?.kind, "invocation.finish");
  assert.equal(
    events.every((event) => event.writer === "canonical"),
    true
  );
});

test("bootstrap handoff keeps bounded events in sequence order", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-bootstrap-bound-"));
  const env = testEnv(home);
  const bootstrap = createBootstrapSession({
    argv: ["version"],
    env,
  });
  for (let index = 0; index < 400; index += 1) {
    bootstrap.info(`pre-runtime-${index}`);
  }
  const handoff = bootstrap.getBootstrapHandoff();
  assert.equal(handoff.events.length <= 256, true);
  assert.equal(
    handoff.events.every(
      (event, index) =>
        index === 0 ||
        event.sequence > (handoff.events[index - 1]?.sequence ?? 0)
    ),
    true
  );
  const canonical = createCliLogger({
    env,
    invocationId: handoff.invocationId,
    mode: "all",
    now: new Date(handoff.startedAt),
    skipStart: true,
    traceId: handoff.traceId,
  });
  canonical.adoptBootstrap?.(handoff);
  bootstrap.adopt(canonical);
  bootstrap.finish({ exitCode: 0, outcome: "success" });
  await bootstrap.flush();
});

test("launcher signal shutdown terminates a blocked command with one terminal event", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-signal-"));
  const launcher = fileURLToPath(
    new URL("../bin/athena-js.js", import.meta.url)
  );
  const blockedEntrypoint = fileURLToPath(
    new URL("./fixtures/cli-blocked-entry.mjs", import.meta.url)
  );
  const script = [
    `import { main } from ${JSON.stringify(pathToFileURL(launcher).href)};`,
    `await main({ argv: ["blocked"], cliEntrypointPath: ${JSON.stringify(blockedEntrypoint)} });`,
  ].join("\n");
  const startedAt = Date.now();
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    env: {
      ...process.env,
      ATHENA_CLI_LOG: "all",
      ATHENA_HOME: home,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const result = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    const timer = setTimeout(() => child.kill("SIGINT"), 100);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  if (process.platform === "win32") {
    assert.equal(result.code === 130 || result.signal === "SIGINT", true);
  } else {
    assert.equal(result.code, 130);
  }
  assert.equal(Date.now() - startedAt < 2000, true);
});

test("launcher fatal handling records one failure and terminates", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-fatal-"));
  const launcher = fileURLToPath(
    new URL("../bin/athena-js.js", import.meta.url)
  );
  const fatalEntrypoint = fileURLToPath(
    new URL("./fixtures/cli-fatal-entry.mjs", import.meta.url)
  );
  const script = [
    `import { main } from ${JSON.stringify(pathToFileURL(launcher).href)};`,
    `await main({ argv: ["fatal"], cliEntrypointPath: ${JSON.stringify(fatalEntrypoint)} });`,
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    env: {
      ...process.env,
      ATHENA_CLI_LOG: "all",
      ATHENA_HOME: home,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const result = await new Promise<{ code: number | null }>((resolve) => {
    child.once("exit", (code) => resolve({ code }));
  });
  assert.equal(result.code, 1);
  const logs = await listCliLogs({
    env: { ATHENA_CLI_LOG: "all", ATHENA_HOME: home },
  });
  assert.equal(logs.length, 1);
  const events = readEvents(logs[0]?.path ?? "");
  assert.equal(events.filter((event) => event.kind === "error").length, 1);
  assert.equal(
    events.filter((event) => event.kind === "invocation.finish").length,
    1
  );
});

test("launcher SIGTERM terminates a blocked command with conventional status", async () => {
  const home = await mkdtemp(join(tmpdir(), "athena-cli-sigterm-"));
  const launcher = fileURLToPath(
    new URL("../bin/athena-js.js", import.meta.url)
  );
  const blockedEntrypoint = fileURLToPath(
    new URL("./fixtures/cli-blocked-entry.mjs", import.meta.url)
  );
  const script = [
    `import { main } from ${JSON.stringify(pathToFileURL(launcher).href)};`,
    `await main({ argv: ["blocked"], cliEntrypointPath: ${JSON.stringify(blockedEntrypoint)} });`,
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    env: {
      ...process.env,
      ATHENA_CLI_LOG: "all",
      ATHENA_HOME: home,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const result = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    const timer = setTimeout(() => child.kill("SIGTERM"), 100);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  if (process.platform === "win32") {
    assert.equal(result.code === 143 || result.signal === "SIGTERM", true);
  } else {
    assert.equal(result.code, 143);
  }
});
