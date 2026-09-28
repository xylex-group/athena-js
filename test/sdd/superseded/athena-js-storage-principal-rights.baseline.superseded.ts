/**
 * Retired characterization baseline for Storage HTTP synthetic principal.
 * SSOT: test/sdd/athena-js-storage-principal-rights.target.test.ts
 * See docs/sdd/xylex/athena-js-storage-principal-rights/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { AthenaGatewayClient } from "../../../src/gateway/client.ts";
import { createAthenaNextHandlers } from "../../../src/next/data-handlers.ts";
import { createClient } from "../../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..", "..");
const srcRoot = join(pkgRoot, "src");

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

test("B-STO-SYNTHETIC: P?: storage HTTP uses synthetic storage-http principal", () => {
  const src = readSrc("next/storage-handlers.ts");
  assert.match(src, /userId:\s*["']storage-http["']/);
});

test("B-STO-NO-AUTHORITY: P?: storage handlers do not import runtime/authority", () => {
  const src = readSrc("next/storage-handlers.ts");
  assert.equal(/runtime\/authority/.test(src), false);
});

test("B-STO-NO-NUCLEUS-RIGHTS: P?: Storage Nucleus does not check AthenaRightKey", () => {
  const src = readSrc("storage/runtime/nucleus.ts");
  assert.equal(src.includes("missingRequiredRights"), false);
});

test("B-STO-HTTP-UNAUTH-ALLOW: P?: unauthenticated storage HTTP put succeeds", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-sto-b-"));
  const client = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_storage_sdd",
    gatewayTransport: mockTransport(),
    storage: { provider: "local", root },
  });
  const handlers = createAthenaNextHandlers({
    client,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  const httpPut = await handlers.storage.POST(
    new Request("http://localhost/api/athena/storage", {
      body: JSON.stringify({
        operation: "put",
        payload: {
          body: Buffer.from("hello").toString("base64"),
          key: "anon.bin",
        },
      }),
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
      },
      method: "POST",
    })
  );
  assert.equal(httpPut.ok, true);
});
