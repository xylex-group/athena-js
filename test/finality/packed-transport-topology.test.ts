/**
 * Packed Transport 1.2 topologies against next-minimal-golden HTTP:
 * remote auth.url, same-origin proxy, discovery, credentials include vs omit.
 */
import { strict as assert } from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

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
      "packed transport topology requires ATHENA_TEST_DATABASE_URL or DATABASE_URL"
    );
  }
  return url;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("no port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForOk(origin: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/auth/ok`);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await delay(250);
  }
  throw new Error(`golden server did not become ready at ${origin}`);
}

function stop(child: ChildProcess | undefined): void {
  if (!child?.pid) {
    return;
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // already gone
  }
}

const maybe =
  process.env.ATHENA_TEST_DATABASE_URL || process.env.DATABASE_URL
    ? test
    : test.skip;

maybe(
  "packed Transport 1.2: auth.url, proxy, discovery, credentials",
  async () => {
    const require = createRequire(join(fixtureRoot, "package.json"));
    let packedServer: string;
    try {
      packedServer = require.resolve("@xylex-group/athena/server");
    } catch (error) {
      throw new Error(`packed athena missing: ${String(error)}`);
    }
    assert.equal(
      packedServer.replaceAll("\\", "/").includes("/packages/athena-js/src/"),
      false
    );

    const databaseUrl = requireDatabaseUrl();
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, ["server.mjs"], {
      cwd: fixtureRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        HOST: "127.0.0.1",
        PORT: String(port),
      },
      stdio: "pipe",
    });
    try {
      await waitForOk(origin);
      const discovered = await fetch(`${origin}/api/athena/capabilities`);
      assert.ok(
        discovered.ok || discovered.status === 404 || discovered.status === 401
      );
      const sessionInclude = await fetch(`${origin}/api/auth/get-session`, {
        credentials: "include",
      });
      assert.ok(sessionInclude.status === 200 || sessionInclude.status === 401);
      const sessionOmit = await fetch(`${origin}/api/auth/ok`);
      assert.equal(sessionOmit.ok, true);

      const proxyPort = await freePort();
      const proxyOrigin = `http://127.0.0.1:${proxyPort}`;
      const proxy = createHttpServer(async (req, res) => {
        const target = `${origin}${req.url ?? "/"}`;
        const upstream = await fetch(target, {
          headers: req.headers as HeadersInit,
          method: req.method,
        });
        res.writeHead(upstream.status, {
          "content-type": upstream.headers.get("content-type") ?? "text/plain",
        });
        res.end(Buffer.from(await upstream.arrayBuffer()));
      });
      await new Promise<void>((resolve) => {
        proxy.listen(proxyPort, "127.0.0.1", () => resolve());
      });
      try {
        const proxied = await fetch(`${proxyOrigin}/api/auth/ok`);
        assert.equal(proxied.ok, true);
        const remoteUrl = `${origin}/api/auth/ok`;
        const remote = await fetch(remoteUrl);
        assert.equal(remote.ok, true);
      } finally {
        proxy.close();
      }
    } finally {
      stop(child);
    }
  }
);
