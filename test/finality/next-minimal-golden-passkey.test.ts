/**
 * Packed next-minimal passkey closure:
 * APP_URL + passkey.onboarding → RP on first /ok → registration options.
 * Chromium virtual-authenticator ceremony lives in Auth UI e2e (not a
 * hardware release gate).
 */
import { strict as assert } from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureRoot = join(pkgRoot, "test", "fixtures", "next-minimal-golden");

function requireDatabaseUrl(): string {
  const url = (
    process.env.ATHENA_TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    ""
  ).trim();
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    throw new Error(
      "fail-closed: packed passkey canary requires ATHENA_TEST_DATABASE_URL or DATABASE_URL"
    );
  }
  return url;
}

function databaseNameFromUrl(databaseUrl: string): string | undefined {
  try {
    const url = new URL(databaseUrl.replace(/^postgresql:/i, "postgres:"));
    const name = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    return name.length > 0 ? name : undefined;
  } catch {
    /* invalid DATABASE_URL */
  }
}

function postgresTargetEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const database = databaseNameFromUrl(databaseUrl);
  return {
    ...process.env,
    ATHENA_TEST_DATABASE_URL: databaseUrl,
    CI: "true",
    DATABASE_URL: databaseUrl,
    ...(database
      ? {
        ATHENA_DATABASE: database,
        ATHENA_GENERATOR_DB: database,
        PGDATABASE: database,
      }
      : {}),
  };
}

function assertPackedInstall(): void {
  const require = createRequire(join(fixtureRoot, "package.json"));
  let resolved: string;
  try {
    resolved = require.resolve("@xylex-group/athena/server");
  } catch (error) {
    throw new Error(
      `packed @xylex-group/athena missing in next-minimal-golden: ${String(error)}`
    );
  }
  if (resolved.replaceAll("\\", "/").includes("/packages/athena-js/src/")) {
    throw new Error("E2E must not resolve the SDK from src/");
  }
}

async function resetEmptyDatabase(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`
			DROP TABLE IF EXISTS athena_billing_migrations;
			DROP TABLE IF EXISTS athena_event_ingress_migrations;
			DROP SCHEMA IF EXISTS athena CASCADE;
			DROP SCHEMA IF EXISTS billing CASCADE;
			DROP SCHEMA IF EXISTS public CASCADE;
			CREATE SCHEMA public;
			GRANT ALL ON SCHEMA public TO PUBLIC;
		`);
  } finally {
    await client.end();
  }
}

function packedCliBin(): string {
  return join(
    fixtureRoot,
    "node_modules",
    "@xylex-group",
    "athena",
    "bin",
    "athena-js.js"
  );
}

function runPackedMigrate(databaseUrl: string): void {
  const result = spawnSync(
    process.execPath,
    [packedCliBin(), "migrate", "--plain"],
    {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: postgresTargetEnv(databaseUrl),
      shell: false,
    }
  );
  const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(
      `packed athena-js migrate failed (${result.status}):\n${log}`
    );
  }
}

async function listenPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function waitHttp(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status > 0) {
        return;
      }
    } catch {
      await delay(200);
    }
  }
  throw new Error(`next-minimal-golden did not become ready at ${url}`);
}

test("packed APP_URL + passkey.onboarding: first /ok + registration options", async () => {
  assertPackedInstall();
  const databaseUrl = requireDatabaseUrl();
  await resetEmptyDatabase(databaseUrl);
  runPackedMigrate(databaseUrl);

  const port = await listenPort();
  const origin = `http://127.0.0.1:${port}`;
  const child: ChildProcess = spawn(
    process.execPath,
    [join(fixtureRoot, "server.mjs")],
    {
      cwd: fixtureRoot,
      env: {
        ...postgresTargetEnv(databaseUrl),
        APP_URL: origin,
        HOST: "127.0.0.1",
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  try {
    await waitHttp(`${origin}/api/auth/ok`);
    const ok = await fetch(`${origin}/api/auth/ok`);
    assert.equal(ok.status, 200, stderr);
    const body = (await ok.json()) as {
      capabilities?: {
        passkey?: { onboarding?: boolean };
        passkeys?: boolean;
      };
    };
    assert.equal(body.capabilities?.passkeys, true);
    assert.equal(body.capabilities?.passkey?.onboarding, true);

    const options = await fetch(
      `${origin}/api/auth/passkey/generate-register-options?email=ada@example.com`
    );
    assert.equal(options.status, 200, await options.clone().text());
    const wire = (await options.json()) as { rp?: { id?: string } };
    assert.equal(wire.rp?.id, "127.0.0.1");
  } finally {
    child.kill();
  }
});
