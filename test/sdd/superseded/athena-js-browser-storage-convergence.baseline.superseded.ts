/**
 * Retired characterization baseline for browser Storage HTTP attach.
 * SSOT: test/sdd/athena-js-browser-storage-convergence.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { AthenaGatewayClient } from "../../../src/gateway/client.ts";
import { createAthenaNextHandlers } from "../../../src/next/data-handlers.ts";
import { createClient } from "../../../src/v3-client.ts";
import { createClient as createCoreClient } from "../../../src/v3-client-core.ts";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "..", "src");
const pkgRoot = join(here, "..", "..", "..");

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

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

function withBrowserEnv<T>(fn: () => T): T {
  const g = globalThis as { window?: unknown };
  const previous = g.window;
  g.window = {};
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete g.window;
    } else {
      g.window = previous;
    }
  }
}

test("B-BR-NO-ATTACH: P?: browser createClient does not attach createBrowserStorageTransport", () => {
  const core = readSrc("v3-client-core.ts");
  assert.equal(core.includes("createBrowserStorageTransport"), false);
});

test("B-BR-UNAVAILABLE: P?: browser createClient storage without url is an unavailable namespace", async () => {
  const hits: string[] = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    hits.push(String(input instanceof Request ? input.url : input));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const client = withBrowserEnv(() =>
      createCoreClient({ gatewayTransport: mockTransport() })
    );
    await assert.rejects(async () =>
      (
        client.storage as { file: { upload: (i: unknown) => Promise<unknown> } }
      ).file.upload({
        name: "a.txt",
        storage_key: "a.txt",
      })
    );
    assert.equal(
      hits.some((url) => url.includes("/api/athena/storage")),
      false
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("B-BR-DISCOVERY-ALWAYS: P?: Next discovery always advertises endpoints.storage", async () => {
  const client = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_storage_sdd",
    gatewayTransport: mockTransport(),
  });
  const handlers = createAthenaNextHandlers({
    client,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  const response = await handlers.storage.GET(
    new Request("http://localhost/api/athena/storage")
  );
  const body = (await response.json()) as {
    endpoints?: { storage?: string };
  };
  assert.equal(typeof body.endpoints?.storage, "string");
});

test("B-BR-NO-CTOR: P?: createStorageClient is not a package export", async () => {
  const mod = await import("../../../src/index.ts");
  assert.equal("createStorageClient" in mod, false);
  const pkg = JSON.parse(
    readFileSync(join(pkgRoot, "package.json"), "utf8")
  ) as {
    exports?: Record<string, unknown>;
  };
  assert.equal(pkg.exports?.["./storage-client"], undefined);
});
