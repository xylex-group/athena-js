/**
 * Baseline characterization: Athena JS Phase 2 root vs request ownership
 * as shipped TODAY on HEAD (landed runtime assertions).
 *
 * Found cases — GREEN on current HEAD. Locks the implemented contract:
 * ownership is "root" | "request" (not "view"); request views borrow;
 * close / diagnostics / migrate / handler factories throw
 * ATHENA_RUNTIME_OWNERSHIP_INVALID.
 *
 * See docs/sdd/xylex/athena-js-root-request-ownership-finality/SPEC.md
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import {
  createAthenaAuthHandlers,
  createAthenaAuthProxyHandlers,
} from "../../src/auth/http/proxy.ts";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import {
  createAthenaDataHandlers,
  createAthenaNextHandlers,
} from "../../src/next/data-handlers.ts";
import { createAthenaServerClient } from "../../src/next/server.ts";
import {
  AthenaRuntimeOwnershipError,
  getAthenaClientInternals,
  getAthenaRuntimeDiagnostics,
  requireAthenaRootClientInternals,
} from "../../src/runtime/client-internals.ts";
import { createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "src");
const pkgRoot = join(here, "..", "..");

const OWNERSHIP_INVALID = "ATHENA_RUNTIME_OWNERSHIP_INVALID";

function mockTransport(): AthenaGatewayClient {
  const ok = async () =>
    ({
      count: null,
      data: [],
      error: null,
      ok: true,
      raw: { data: [] },
      status: 200,
      statusText: "OK",
    }) as never;
  return {
    baseUrl: "https://athena.local/postgres-direct",
    buildHeaders() {
      return {};
    },
    deleteGateway: ok,
    fetchGateway: ok,
    insertGateway: ok,
    queryGateway: ok,
    async resolveCallOptions(options) {
      return options;
    },
    rpcGateway: ok,
    updateGateway: ok,
    async verifyConnection() {
      return { ok: true } as never;
    },
  };
}

function createRoot(
  suffix: string,
  auth:
    | false
    | { mode: "local" }
    | {
        mode: "remote";
        routing: "same-origin";
        upstreamUrl: string;
      } = false
) {
  return createClient({
    auth,
    databaseUrl: `postgresql://postgres@127.0.0.1:5432/athena_sdd_p2_baseline_${suffix}`,
    env: {},
    gatewayTransport: mockTransport(),
  });
}

function assertOwnershipInvalid(
  error: unknown,
  received: "request-view" = "request-view"
): boolean {
  assert.ok(error instanceof AthenaRuntimeOwnershipError);
  assert.equal(error.code, OWNERSHIP_INVALID);
  assert.equal(error.received, received);
  assert.equal(error.expected, "root");
  return true;
}

test("P2 baseline: internals ownership === \"request\" (AthenaRequestRuntime)", () => {
  const ownershipSrc = readFileSync(
    join(srcRoot, "runtime", "ownership.ts"),
    "utf8"
  );
  const internalsSrc = readFileSync(
    join(srcRoot, "runtime", "client-internals.ts"),
    "utf8"
  );
  const errorsSrc = readFileSync(join(srcRoot, "config", "errors.ts"), "utf8");

  assert.equal(ownershipSrc.includes("interface AthenaRootRuntime"), true);
  assert.equal(ownershipSrc.includes("interface AthenaRequestRuntime"), true);
  assert.match(
    ownershipSrc,
    /interface AthenaRootRuntime[\s\S]*ownership:\s*"root"/
  );
  assert.match(
    ownershipSrc,
    /interface AthenaRequestRuntime[\s\S]*ownership:\s*"request"/
  );
  assert.equal(ownershipSrc.includes('"root" | "request"'), true);
  assert.equal(ownershipSrc.includes('"root" | "view"'), false);
  assert.equal(errorsSrc.includes(OWNERSHIP_INVALID), true);
  assert.equal(ownershipSrc.includes(OWNERSHIP_INVALID), true);
  assert.equal(internalsSrc.includes(OWNERSHIP_INVALID), true);
  assert.equal(
    internalsSrc.includes('ownership: "request"'),
    true
  );
  assert.match(
    internalsSrc,
    /createViewClientInternals[\s\S]*runtimeOwnership:\s*"borrowed"/
  );

  const root = createRoot("request_runtime");
  const view = root.withContext({ userId: "u1" });
  const viewInternals = getAthenaClientInternals(view);
  const rootInternals = getAthenaClientInternals(root);

  assert.equal(viewInternals?.ownership, "request");
  assert.notEqual(viewInternals?.ownership, "view");
  assert.equal(viewInternals?.source, "request");
  assert.equal(viewInternals?.runtimeOwnership, "borrowed");
  assert.equal(viewInternals?.close, undefined);
  assert.equal(rootInternals?.ownership, "root");
  assert.equal(rootInternals?.source, "root");
  assert.equal(rootInternals?.runtimeOwnership, "owned");
});

test("P2 baseline: request-view misuse throws ATHENA_RUNTIME_OWNERSHIP_INVALID", () => {
  const root = createRoot("handler_misuse", {
    mode: "remote",
    routing: "same-origin",
    upstreamUrl: "https://auth.example.com",
  });
  const view = root.withContext({ userId: "u1" });
  const asRoot = view as unknown as typeof root;

  assert.throws(
    () => createAthenaNextHandlers({ client: asRoot }),
    (error: unknown) => assertOwnershipInvalid(error)
  );
  assert.throws(
    () => createAthenaDataHandlers({ client: asRoot }),
    (error: unknown) => assertOwnershipInvalid(error)
  );
  assert.throws(
    () => createAthenaAuthHandlers(view),
    (error: unknown) => assertOwnershipInvalid(error)
  );
  assert.throws(
    () => createAthenaAuthProxyHandlers({ client: view }),
    (error: unknown) => assertOwnershipInvalid(error)
  );
  assert.throws(
    () => requireAthenaRootClientInternals(view, "createAthenaAuthRuntime"),
    (error: unknown) => assertOwnershipInvalid(error)
  );

  assert.throws(
    () =>
      createAthenaDataHandlers({
        client: {} as never,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AthenaRuntimeOwnershipError);
      assert.equal(error.code, "ATHENA_CLIENT_RUNTIME_VERSION_MISMATCH");
      assert.equal(error.received, "foreign-runtime");
      return true;
    }
  );
});

test("P2 baseline: request client cannot close or replace runtime-owned resources", async () => {
  const root = createRoot("cannot_close", { mode: "local" });
  const view = root.withContext({ userId: "u1" });
  const rootInternals = getAthenaClientInternals(root);
  assert.ok(rootInternals?.postgresRuntime);
  assert.ok(rootInternals.authRuntime);
  const rootAuth = rootInternals.authRuntime;
  const rootPg = rootInternals.postgresRuntime;

  const viewMigrate = (
    view as {
      auth?: { server?: { migrate?: () => Promise<void> } };
    }
  ).auth?.server?.migrate;
  assert.equal(typeof viewMigrate, "function");
  await assert.rejects(
    () => viewMigrate(),
    (error: unknown) => assertOwnershipInvalid(error)
  );

  assert.equal(typeof (view as { close?: unknown }).close, "function");
  await assert.rejects(
    () => (view as unknown as { close(): Promise<void> }).close(),
    (error: unknown) => assertOwnershipInvalid(error)
  );

  assert.throws(
    () => getAthenaRuntimeDiagnostics(view),
    (error: unknown) => assertOwnershipInvalid(error)
  );

  const rootDiag = getAthenaRuntimeDiagnostics(root);
  assert.ok(rootDiag);
  assert.equal(rootDiag.ownership, "root");
  assert.equal(rootDiag.closed, false);
  assert.equal(getAthenaClientInternals(root)?.lifecycle.closed, false);
  assert.equal(getAthenaClientInternals(root)?.postgresRuntime, rootPg);
  assert.equal(getAthenaClientInternals(root)?.authRuntime, rootAuth);
  const pool = await rootPg.getPool();
  assert.ok(pool);
});

test("P2 baseline: withContext / createAthenaServerClient borrow root transport", async () => {
  const root = createRoot("borrow_transport", { mode: "local" });
  const view = root.withContext({
    organizationId: "org-1",
    userId: "u-borrow",
  });
  const rootInternals = getAthenaClientInternals(root);
  const viewInternals = getAthenaClientInternals(view);

  assert.equal(viewInternals?.ownership, "request");
  assert.equal(viewInternals?.runtimeOwnership, "borrowed");
  assert.equal(viewInternals?.postgresRuntime, rootInternals?.postgresRuntime);
  assert.equal(viewInternals?.authRuntime, rootInternals?.authRuntime);
  assert.equal(viewInternals?.getAuthStores, rootInternals?.getAuthStores);
  assert.equal(
    viewInternals?.lifecycle.runtimeId,
    rootInternals?.lifecycle.runtimeId
  );

  const borrowed = await createAthenaServerClient({
    client: root,
    requestCookies: "",
    requestHeaders: {},
    scope: { userId: "u-server" },
  });
  const borrowedInternals = getAthenaClientInternals(borrowed);
  assert.equal(borrowedInternals?.ownership, "request");
  assert.equal(borrowedInternals?.runtimeOwnership, "borrowed");
  assert.equal(
    borrowedInternals?.postgresRuntime,
    rootInternals?.postgresRuntime
  );
  assert.equal(borrowedInternals?.authRuntime, rootInternals?.authRuntime);

  const facade = await createAthenaServerClient({
    auth: false,
    databaseUrl:
      "postgresql://postgres@127.0.0.1:5432/athena_sdd_p2_baseline_server_facade",
    env: {},
    gatewayTransport: mockTransport(),
    requestCookies: "",
    requestHeaders: {},
  });
  const facadeInternals = getAthenaClientInternals(facade);
  assert.equal(facadeInternals?.ownership, "request");
  assert.equal(facadeInternals?.runtimeOwnership, "borrowed");
  assert.throws(
    () =>
      createAthenaNextHandlers({
        client: facade as unknown as typeof root,
      }),
    (error: unknown) => assertOwnershipInvalid(error)
  );
  await assert.rejects(
    () => (facade as unknown as { close(): Promise<void> }).close(),
    (error: unknown) => assertOwnershipInvalid(error)
  );
});

test("P2 baseline: AthenaRequestClient still Omits close; no extra public client factories", () => {
  const brandsSrc = readFileSync(join(srcRoot, "client-brands.ts"), "utf8");
  const packageJson = readFileSync(join(pkgRoot, "package.json"), "utf8");
  const v3Src = readFileSync(join(srcRoot, "v3-client.ts"), "utf8");
  const indexSrc = readFileSync(join(srcRoot, "index.ts"), "utf8");

  assert.match(brandsSrc, /Omit<\s*TClient,\s*"close"\s*>/);
  assert.equal(brandsSrc.includes("createDatabaseClient"), false);
  for (const name of [
    "createDatabaseClient",
    "createAuthClient",
    "createPolicyClient",
    "createEmbeddedClient",
    "createCloudflareDatabaseClient",
    "createEmbeddedAuthRuntime",
  ] as const) {
    assert.equal(packageJson.includes(name), false);
    assert.equal(v3Src.includes(`export function ${name}`), false);
    assert.equal(indexSrc.includes(name), false);
  }

  const root = createRoot("identity_lock");
  const view = root.withContext({ userId: "u1" });
  assert.equal(getAthenaClientInternals(view)?.ownership, "request");
  assert.equal(getAthenaClientInternals(view)?.close, undefined);
  assert.equal(typeof (root as { close?: unknown }).close, "function");
});
