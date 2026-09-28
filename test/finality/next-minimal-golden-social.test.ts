/**
 * Packed next-minimal golden Social OAuth (O19):
 * empty Postgres → packed tarball → migrate → createClient testProvider
 * → discovery → sign-in/social → fixture OAuth → callback session.
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
import { startOAuthProviderFixture } from "../fixtures/oauth-provider/index.ts";

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
      "fail-closed: packed social golden-path requires ATHENA_TEST_DATABASE_URL or DATABASE_URL"
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
    throw new Error(`packed migrate failed (${result.status}):\n${log}`);
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
  throw new Error(`golden server did not become ready at ${url}`);
}

function cookieHeader(response: Response): string {
  const getSetCookie = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  const cookies =
    typeof getSetCookie === "function"
      ? getSetCookie.call(response.headers)
      : [];
  if (cookies.length > 0) {
    return cookies
      .map((entry) => entry.split(";", 1)[0])
      .filter(Boolean)
      .join("; ");
  }
  const single = response.headers.get("set-cookie");
  return single ? (single.split(";", 1)[0] ?? "") : "";
}

function assertNoBearerInLocation(location: string | null): void {
  assert.ok(location, "callback Location");
  assert.equal(
    /(?:^|[?&])(?:token|session|bearer)=/i.test(location),
    false,
    location
  );
}

async function followProviderAuthorization(authorizeUrl: string): Promise<{
  code: string;
  state: string;
}> {
  const response = await fetch(authorizeUrl, { redirect: "manual" });
  const location = response.headers.get("location");
  assert.ok(location, `provider Location missing (${response.status})`);
  const dest = new URL(location);
  return {
    code: dest.searchParams.get("code") ?? "",
    state: dest.searchParams.get("state") ?? "",
  };
}

test("packed next-minimal golden Social OAuth: fixture IdP, discovery, session, link", {
  timeout: 180_000,
}, async () => {
  assertPackedInstall();
  const databaseUrl = requireDatabaseUrl();
  await resetEmptyDatabase(databaseUrl);
  runPackedMigrate(databaseUrl);

  const oauth = await startOAuthProviderFixture();
  const port = await listenPort();
  const origin = `http://127.0.0.1:${port}`;
  const child: ChildProcess = spawn(
    process.execPath,
    [join(fixtureRoot, "server.mjs")],
    {
      cwd: fixtureRoot,
      env: {
        ...postgresTargetEnv(databaseUrl),
        ATHENA_OAUTH_CLIENT_ID: oauth.clientId,
        ATHENA_OAUTH_CLIENT_SECRET: oauth.clientSecret,
        ATHENA_OAUTH_FIXTURE_ISSUER: oauth.issuer,
        ATHENA_OAUTH_LINK_CLIENT_ID: oauth.secondClientId,
        ATHENA_OAUTH_LINK_CLIENT_SECRET: oauth.secondClientSecret,
        HOST: "127.0.0.1",
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const childLogs: string[] = [];
  child.stdout?.on("data", (chunk) => childLogs.push(String(chunk)));
  child.stderr?.on("data", (chunk) => childLogs.push(String(chunk)));
  try {
    try {
      await waitHttp(`${origin}/api/auth/ok`);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : error}\n${childLogs.join("")}`
      );
    }

    const discovery = await fetch(`${origin}/api/athena`);
    assert.ok(discovery.status < 500, await discovery.clone().text());
    const ok = await fetch(`${origin}/api/auth/ok`);
    assert.equal(ok.status, 200, await ok.clone().text());
    const capabilities = (await ok.json()) as {
      capabilities?: { social?: { providers?: string[] } };
    };
    assert.deepEqual(capabilities.capabilities?.social?.providers, [
      "testProvider",
      "testProviderB",
    ]);

    const start = await fetch(`${origin}/api/auth/sign-in/social`, {
      body: JSON.stringify({
        callbackURL: `${origin}/dashboard`,
        provider: "testProvider",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(start.status, 200, await start.clone().text());
    const started = (await start.json()) as { url?: string };
    assert.ok(started.url);
    const { code, state } = await followProviderAuthorization(started.url);
    const callback = await fetch(
      `${origin}/api/auth/callback/testProvider?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
      { redirect: "manual" }
    );
    assert.equal(callback.status, 302, await callback.clone().text());
    assertNoBearerInLocation(callback.headers.get("location"));
    const cookie = cookieHeader(callback);
    assert.match(cookie, /session/i);
    const session = await fetch(`${origin}/api/auth/get-session`, {
      headers: { cookie },
    });
    assert.equal(session.status, 200);
    const body = (await session.json()) as {
      session?: { id?: string };
      user?: { id?: string };
    };
    assert.ok(body.session?.id);
    assert.ok(body.user?.id);

    const password = await fetch(`${origin}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email: "packed-link@example.com",
        name: "Packed Link",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(password.status, 200, await password.clone().text());
    const passwordCookie = cookieHeader(password);
    const before = (await (
      await fetch(`${origin}/api/auth/get-session`, {
        headers: { cookie: passwordCookie },
      })
    ).json()) as { session?: { id?: string }; user?: { id?: string } };
    const linkStart = await fetch(`${origin}/api/auth/link-social`, {
      body: JSON.stringify({
        callbackURL: `${origin}/settings`,
        provider: "testProviderB",
      }),
      headers: {
        "content-type": "application/json",
        cookie: passwordCookie,
      },
      method: "POST",
    });
    assert.equal(linkStart.status, 200, await linkStart.clone().text());
    const linkBody = (await linkStart.json()) as { url?: string };
    const linked = await followProviderAuthorization(String(linkBody.url));
    const linkCb = await fetch(
      `${origin}/api/auth/callback/testProviderB?code=${encodeURIComponent(linked.code)}&state=${encodeURIComponent(linked.state)}`,
      { headers: { cookie: passwordCookie }, redirect: "manual" }
    );
    assert.equal(linkCb.status, 302, await linkCb.clone().text());
    assertNoBearerInLocation(linkCb.headers.get("location"));
    const afterCookie = cookieHeader(linkCb) || passwordCookie;
    const after = (await (
      await fetch(`${origin}/api/auth/get-session`, {
        headers: { cookie: afterCookie },
      })
    ).json()) as { session?: { id?: string }; user?: { id?: string } };
    assert.equal(after.session?.id, before.session?.id);
    assert.equal(after.user?.id, before.user?.id);
    const listed = await fetch(`${origin}/api/auth/list-accounts`, {
      headers: { cookie: afterCookie },
    });
    assert.equal(listed.status, 200);
    const accounts = (await listed.json()) as Array<{ providerId?: string }>;
    assert.ok(accounts.some((row) => row.providerId === "testProviderB"));
  } finally {
    if (child.pid) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill("SIGTERM");
      });
    }
    await oauth.close();
  }
});
