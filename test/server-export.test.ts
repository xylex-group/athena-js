import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { AthenaConfigurationError } from "../src/config/errors.ts";
import {
  AthenaRuntimeOwnershipError,
  getAthenaClientInternals,
  getAthenaRuntimeDiagnostics,
} from "../src/runtime/client-internals.ts";
import { createClient } from "../src/v3-client.ts";
import {
  createAthenaDataHandlers,
  createAthenaNextHandlers,
} from "../src/next/data-handlers.ts";
import type { AthenaGatewayClient } from "../src/gateway/client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const require = createRequire(import.meta.url);
const pkg = require(join(pkgRoot, "package.json")) as {
  exports: Record<string, { import?: string; types?: string }>;
  typesVersions: { "*": Record<string, string[]> };
};

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

test("@xylex-group/athena/server is a published unconditional export", () => {
  const exp = pkg.exports["./server"];
  assert.ok(exp, "package.json exports must include ./server");
  assert.equal(exp.types, "./dist/server.d.ts");
  assert.equal(exp.import, "./dist/server.js");
  assert.deepEqual(pkg.typesVersions["*"].server, ["dist/server.d.ts"]);
});

test("Node createClient attaches root internals and satisfies next handlers", () => {
  const client = createClient({
    auth: {
      mode: "remote",
      routing: "same-origin",
      upstreamUrl: "https://auth.example.com",
    },
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_server_export",
    gatewayTransport: mockTransport(),
  });
  const internals = getAthenaClientInternals(client);
  assert.equal(internals?.source, "root");
  assert.ok(internals?.gatewayTransport);

  const handlers = createAthenaNextHandlers({
    client,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  assert.equal(typeof handlers.data.GET, "function");
  assert.equal(typeof handlers.auth.GET, "function");
});

test("request views keep source=view and cannot own handlers", () => {
  const root = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_server_export",
    gatewayTransport: mockTransport(),
  });
  const view = root.withContext({ userId: "user-1" });
  assert.equal(getAthenaClientInternals(view)?.source, "view");
  assert.equal(getAthenaClientInternals(view)?.ownership, "view");
  assert.equal(getAthenaClientInternals(view)?.runtimeOwnership, "borrowed");
  const rootDiag = getAthenaRuntimeDiagnostics(root);
  const viewDiag = getAthenaRuntimeDiagnostics(view);
  assert.ok(rootDiag);
  assert.ok(viewDiag);
  assert.equal(rootDiag.runtimeId, viewDiag.runtimeId);
  assert.equal(rootDiag.ownership, "root");
  assert.equal(viewDiag.ownership, "view");
  assert.throws(
    () =>
      createAthenaDataHandlers({
        client: view as unknown as typeof root,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AthenaRuntimeOwnershipError);
      assert.ok(error instanceof AthenaConfigurationError);
      assert.equal(error.code, "ATHENA_HANDLER_ROOT_CLIENT_REQUIRED");
      assert.equal(error.received, "request-view");
      assert.equal(error.expected, "root");
      return true;
    },
  );
});
