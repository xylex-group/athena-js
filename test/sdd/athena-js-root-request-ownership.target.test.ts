/**
 * Target suite: Athena JS Phase 2 root vs request ownership finality.
 *
 * Encodes SPEC acceptance (docs/sdd/xylex/athena-js-root-request-ownership-finality/SPEC.md)
 * including remaining closeout: stale product tests must lock `"request"` +
 * ATHENA_RUNTIME_OWNERSHIP_INVALID (not leftover `"view"` / silent close /
 * ATHENA_HANDLER_ROOT_CLIENT_REQUIRED).
 *
 * Must stay RED on CURRENT HEAD until that closeout lands. Do not implement
 * product ownership here — src/runtime/ownership.ts is already the contract.
 */

import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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
const testRoot = join(here, "..");

const OWNERSHIP_INVALID = "ATHENA_RUNTIME_OWNERSHIP_INVALID";
const LEGACY_HANDLER_CODE = "ATHENA_HANDLER_ROOT_CLIENT_REQUIRED";

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
    databaseUrl: `postgresql://postgres@127.0.0.1:5432/athena_sdd_p2_target_${suffix}`,
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

test('P2: internals ownership === "request" (AthenaRequestRuntime)', () => {
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

  const root = createRoot("request_runtime");
  const view = root.withContext({ userId: "u1" });
  const viewInternals = getAthenaClientInternals(view);
  const rootInternals = getAthenaClientInternals(root);

  assert.equal(viewInternals?.ownership, "request");
  assert.notEqual(viewInternals?.ownership, "view");
  assert.equal(viewInternals?.source, "request");
  assert.equal(viewInternals?.runtimeOwnership, "borrowed");
  assert.equal(rootInternals?.ownership, "root");
  assert.equal(rootInternals?.runtimeOwnership, "owned");
});

test("P2: request-view misuse throws ATHENA_RUNTIME_OWNERSHIP_INVALID", () => {
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
});

test("P2: unknown objects use ATHENA_CLIENT_RUNTIME_VERSION_MISMATCH", () => {
  assert.throws(
    () =>
      createAthenaDataHandlers({
        client: {} as never,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AthenaRuntimeOwnershipError);
      assert.equal(error.code, "ATHENA_CLIENT_RUNTIME_VERSION_MISMATCH");
      assert.equal(error.received, "foreign-runtime");
      assert.notEqual(error.code, OWNERSHIP_INVALID);
      return true;
    }
  );
  assert.throws(
    () => requireAthenaRootClientInternals({}, "createAthenaAuthRuntime"),
    (error: unknown) => {
      assert.ok(error instanceof AthenaRuntimeOwnershipError);
      assert.equal(error.code, "ATHENA_CLIENT_RUNTIME_VERSION_MISMATCH");
      return true;
    }
  );
});

test("P2: request client cannot close or replace runtime-owned resources", async () => {
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

test("P2: withContext / createAthenaServerClient borrow root transport", async () => {
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
      "postgresql://postgres@127.0.0.1:5432/athena_sdd_p2_target_server_facade",
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

test("P2: 1000 request views share one postgres runtime", async () => {
  const root = createRoot("share_pg", { mode: "local" });
  const rootRuntime = getAthenaClientInternals(root)?.postgresRuntime;
  assert.ok(rootRuntime);
  const views = await Promise.all(
    Array.from({ length: 1000 }, (_, index) =>
      createAthenaServerClient({
        client: root,
        requestCookies: `session=${index}`,
        requestHeaders: { "x-request-id": String(index) },
        scope: { organizationId: `org-${index % 7}`, userId: `u-${index}` },
      })
    )
  );
  assert.equal(views.length, 1000);
  for (const requestView of views) {
    const internals = getAthenaClientInternals(requestView);
    assert.equal(internals?.postgresRuntime, rootRuntime);
    assert.equal(internals?.ownership, "request");
    assert.equal(internals?.source, "request");
    assert.equal(internals?.runtimeOwnership, "borrowed");
  }
  await assert.rejects(
    () => (views[0] as unknown as { close(): Promise<void> }).close(),
    (error: unknown) => assertOwnershipInvalid(error)
  );
  assert.equal(getAthenaClientInternals(root)?.postgresRuntime, rootRuntime);
  assert.equal(getAthenaClientInternals(root)?.lifecycle.closed, false);
  await rootRuntime.getPool();
});

test("P2: AthenaRequestClient still Omits close; no extra public client factories", () => {
  const brandsSrc = readFileSync(join(srcRoot, "client-brands.ts"), "utf8");
  const packageJson = readFileSync(join(pkgRoot, "package.json"), "utf8");
  const v3Src = readFileSync(join(srcRoot, "v3-client.ts"), "utf8");
  const indexSrc = readFileSync(join(srcRoot, "index.ts"), "utf8");
  const serverSrc = readFileSync(join(srcRoot, "server.ts"), "utf8");
  const nextServerSrc = readFileSync(
    join(srcRoot, "next", "server.ts"),
    "utf8"
  );
  const migrationsSrc = readFileSync(
    join(srcRoot, "migrations", "index.ts"),
    "utf8"
  );

  assert.match(brandsSrc, /Omit<\s*TClient,\s*"close"\s*>/);
  assert.equal(brandsSrc.includes("createDatabaseClient"), false);
  for (const name of [
    "createDatabaseClient",
    "createAuthClient",
    "createPolicyClient",
    "createEmbeddedClient",
    "createCloudflareDatabaseClient",
    "createEmbeddedAuthRuntime",
    "getRuntimeDiagnostics",
  ] as const) {
    assert.equal(packageJson.includes(name), false);
    assert.equal(v3Src.includes(`export function ${name}`), false);
    assert.equal(indexSrc.includes(name), false);
    assert.equal(serverSrc.includes(`export function ${name}`), false);
    assert.equal(nextServerSrc.includes(`export function ${name}`), false);
  }

  assert.match(migrationsSrc, /never execute migrations/);
  assert.equal(migrationsSrc.includes("createClient"), true);
  assert.equal(migrationsSrc.includes("export function createClient"), false);
  assert.equal(migrationsSrc.includes("AthenaRequestRuntime"), false);

  const root = createRoot("identity_lock");
  const view = root.withContext({ userId: "u1" });
  assert.equal(getAthenaClientInternals(view)?.ownership, "request");
  assert.equal(getAthenaClientInternals(view)?.close, undefined);
  assert.equal(typeof (root as { close?: unknown }).close, "function");
});

test("P2: leftover inverted baseline is superseded or rewritten to landed contract", () => {
  const leftoverPath = join(
    here,
    "athena-js-root-request-ownership.baseline.test.ts"
  );
  const supersededPath = join(
    here,
    "superseded",
    "athena-js-root-request-ownership.baseline.test.ts"
  );
  const leftoverMoved = !existsSync(leftoverPath) && existsSync(supersededPath);
  const living = leftoverMoved
    ? readFileSync(supersededPath, "utf8")
    : readFileSync(leftoverPath, "utf8");

  const invertedSilentClose = living.includes(
    "P2: view.close is a silent no-op"
  );
  const invertedViewOwnership = living.includes(
    'P2: internals ownership === "view"'
  );
  const invertedMissingCode = living.includes(
    "P2: ATHENA_RUNTIME_OWNERSHIP_INVALID is missing"
  );
  const invertedDiagnostics = living.includes(
    "P2: getAthenaRuntimeDiagnostics works on views"
  );

  assert.equal(
    invertedSilentClose ||
      invertedViewOwnership ||
      invertedMissingCode ||
      invertedDiagnostics,
    false,
    'leftover inverted baseline must be superseded or rewritten; pre-implement silent-close / ownership "view" must not remain GREEN on CURRENT'
  );
  assert.equal(living.includes(OWNERSHIP_INVALID), true);
  assert.equal(living.includes('ownership: "request"') || leftoverMoved, true);
});

test('P2: stale product tests assert "request" + ATHENA_RUNTIME_OWNERSHIP_INVALID', () => {
  const files = [
    "server-export.test.ts",
    "runtime-request-scope.test.ts",
    join("finality", "ownership.test.ts"),
    "finality-handlers-from-root.test.ts",
  ] as const;

  for (const rel of files) {
    const src = readFileSync(join(testRoot, rel), "utf8");
    assert.equal(
      src.includes(OWNERSHIP_INVALID),
      true,
      `${rel} must assert ${OWNERSHIP_INVALID}`
    );
    assert.equal(
      src.includes(LEGACY_HANDLER_CODE),
      false,
      `${rel} must not expect production ${LEGACY_HANDLER_CODE}`
    );
    assert.equal(
      src.includes(', "view"'),
      false,
      `${rel} must not lock internals ownership/source as "view"`
    );
    assert.equal(
      src.includes('ownership, "view"'),
      false,
      `${rel} must not assert diagnostics ownership "view"`
    );
  }

  const serverExport = readFileSync(
    join(testRoot, "server-export.test.ts"),
    "utf8"
  );
  assert.match(
    serverExport,
    /getAthenaRuntimeDiagnostics\(\s*view\s*\)[\s\S]*ATHENA_RUNTIME_OWNERSHIP_INVALID|throws[\s\S]*getAthenaRuntimeDiagnostics\(\s*view/
  );

  const requestScope = readFileSync(
    join(testRoot, "runtime-request-scope.test.ts"),
    "utf8"
  );
  assert.equal(requestScope.includes('source, "request"'), true);
  assert.match(
    requestScope,
    /assert\.rejects[\s\S]*close\(\)|rejects[\s\S]*ATHENA_RUNTIME_OWNERSHIP_INVALID/
  );
});
