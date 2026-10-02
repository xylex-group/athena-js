#!/usr/bin/env node
/**
 * Start the package Docker Postgres (port 55432) when no DATABASE_URL is set,
 * then run live PostgreSQL tests. Fail closed if Docker cannot launch.
 *
 * Default Auth tests use a disposable empty database on the compose server so
 * they do not race migrateAthenaAuthSchema on the introspection catalog.
 *
 *   node scripts/run-postgres-docker-tests.mjs
 *   node scripts/run-postgres-docker-tests.mjs --all
 *   node scripts/run-postgres-docker-tests.mjs --up-only
 *   node scripts/run-postgres-docker-tests.mjs --down
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "./ensure-dev-self-link.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const composeFile = join(
  root,
  "test",
  "integration",
  "postgres",
  "docker-compose.yml"
);
const COMPOSE_URL = "postgresql://postgres:postgres@127.0.0.1:55432/athena_js";
const CONTAINER = "athena-js-introspection-postgres";
const AUTH_DATABASE = "athena_js_auth";
const EMBEDDED_DATABASE = "athena_js_embedded";
const FINALITY_DATABASE = "athena_js_auth_finality";

const AUTH_SUITE = [
  "test/auth/authorization-server-postgres.test.ts",
  "test/auth/oidc-provider-conformance.test.ts",
  "test/auth/identity-connections-postgres.test.ts",
  "test/auth/organization-lifecycle-postgres.test.ts",
  "test/finality/token-key-store-postgres.test.ts",
  "test/auth-postgres-timeouts.live.test.ts",
];

const EMBEDDED_SUITE = ["test/sdd/athena-js-embedded-sql-migrate.pg.test.ts"];

const INTEGRATION_SUITE = [
  "test/postgres-introspection.integration.test.ts",
  "test/postgres-direct-live.test.ts",
  "test/postgres-direct-live-ast.test.ts",
  "test/postgres-direct-relations.live.test.ts",
  "test/sdd/athena-local-runtime.live.test.ts",
  "test/sdd/athena-local-runtime.r6.test.ts",
  "test/sdd/athena-local-runtime.r7.test.ts",
  "test/sdd/athena-local-runtime.r7.live.test.ts",
  "test/sdd/speedrun-pg-finality.live.test.ts",
];

function isPostgresUri(value) {
  return (
    typeof value === "string" && /^postgres(?:ql)?:\/\//i.test(value.trim())
  );
}

function resolveProvidedUrl() {
  const preferred = process.env.ATHENA_TEST_DATABASE_URL;
  if (isPostgresUri(preferred)) {
    return preferred.trim();
  }
  const fallback = process.env.DATABASE_URL;
  if (isPostgresUri(fallback)) {
    return fallback.trim();
  }
}

function dockerCompose(args) {
  return spawnSync("docker", ["compose", "-f", composeFile, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function nodeExecutable() {
  if (process.versions.bun != null) {
    return "node";
  }
  return process.execPath;
}

function upCompose() {
  const result = dockerCompose(["up", "-d", "--wait"]);
  if (result.status !== 0) {
    fail(
      "fail-closed: docker compose could not start test/integration/postgres (is Docker running?)"
    );
  }
}

function downCompose() {
  dockerCompose(["down"]);
}

function composeDatabaseUrl(database) {
  return `postgresql://postgres:postgres@127.0.0.1:55432/${database}`;
}

function psqlAdmin(sql) {
  return spawnSync(
    "docker",
    [
      "exec",
      CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    {
      cwd: root,
      encoding: "utf8",
      stdio: "inherit",
    }
  );
}

function recreateComposeDatabase(database) {
  const statements = [
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}' AND pid <> pg_backend_pid();`,
    `DROP DATABASE IF EXISTS ${database};`,
    `CREATE DATABASE ${database};`,
  ];
  for (const sql of statements) {
    const result = psqlAdmin(sql);
    if (result.status !== 0) {
      fail(`fail-closed: could not recreate PostgreSQL database ${database}`);
    }
  }
}

function runNodeTest(files, databaseUrl, extraEnv = {}) {
  const env = {
    ...process.env,
    ATHENA_TEST_DATABASE_URL: databaseUrl,
    DATABASE_URL: databaseUrl,
    PG_INTROSPECTION_URL: databaseUrl,
    ATHENA_PG_DIRECT_URI: databaseUrl,
    ATHENA_LOCAL_RUNTIME_PG_URI: databaseUrl,
    ...extraEnv,
  };
  return spawnSync(
    nodeExecutable(),
    [
      "--import",
      "./test/register-server-only.mjs",
      "--import",
      "tsx",
      ...(process.platform === "win32"
        ? ["--import", "./test/windows-defer-force-exit.mjs"]
        : []),
      "--test",
      "--test-concurrency=1",
      ...(process.platform === "win32" ? [] : ["--test-force-exit"]),
      ...files,
    ],
    {
      cwd: root,
      env,
      shell: false,
      stdio: "inherit",
    }
  );
}

function exitFor(result) {
  process.exit(typeof result.status === "number" ? result.status : 1);
}

const args = new Set(process.argv.slice(2));
if (args.has("--down")) {
  downCompose();
  process.exit(0);
}

const providedUrl = resolveProvidedUrl();
if (!providedUrl) {
  upCompose();
}

if (args.has("--up-only")) {
  process.stdout.write(`${providedUrl ?? COMPOSE_URL}\n`);
  process.exit(0);
}

function provisionAuthDatabases() {
  if (providedUrl) {
    return;
  }
  recreateComposeDatabase(AUTH_DATABASE);
  recreateComposeDatabase(EMBEDDED_DATABASE);
  recreateComposeDatabase(FINALITY_DATABASE);
}

function runAuthAndEmbedded() {
  provisionAuthDatabases();
  const authUrl = providedUrl ?? composeDatabaseUrl(AUTH_DATABASE);
  const auth = runNodeTest(AUTH_SUITE, authUrl);
  if (auth.status !== 0) {
    exitFor(auth);
  }
  const embeddedUrl = providedUrl ?? composeDatabaseUrl(EMBEDDED_DATABASE);
  const finalityUrl = providedUrl ?? composeDatabaseUrl(FINALITY_DATABASE);
  exitFor(
    runNodeTest(EMBEDDED_SUITE, embeddedUrl, {
      ATHENA_AUTH_FINALITY_DATABASE_URL: finalityUrl,
    })
  );
}

if (args.has("--all")) {
  const url = providedUrl ?? COMPOSE_URL;
  const integration = runNodeTest(INTEGRATION_SUITE, url);
  if (integration.status !== 0) {
    exitFor(integration);
  }
  runAuthAndEmbedded();
}

runAuthAndEmbedded();
