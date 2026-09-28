/**
 * Surviving baseline for Athena Embedded Storage Runtime.
 * Characterization after Waves 1–6: keep-green, not inverted B1–B4.
 */

import { strict as assert } from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import { parseAthenaRuntimeDiscoveryDocument } from "../../src/gateway/discovery-types.ts";
import { createAthenaNextHandlers } from "../../src/next/data-handlers.ts";
import { ACTION_BITS } from "../../src/policy/types.ts";
import type { AthenaStorageFileUploadInput } from "../../src/storage/file.ts";
import { createClient } from "../../src/v3-client.ts";

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

test("B1 surviving: createAthenaNextHandlers still exposes auth and data", () => {
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
  assert.equal(typeof handlers.auth.GET, "function");
  assert.equal(typeof handlers.data.POST, "function");
});

test("B2 surviving: discovery endpoints still include data", () => {
  const parsed = parseAthenaRuntimeDiscoveryDocument({
    athena: true,
    capabilities: {
      auth: { available: false },
      delete: true,
      fetch: true,
      insert: true,
      models: "off",
      nestedRelations: false,
      policy: false,
      rawSql: false,
      rpc: false,
      update: true,
    },
    endpoints: {
      data: "/api/athena",
      storage: "/api/athena/storage",
    },
    protocol: { major: 1, minor: 1 },
    runtime: "next-local",
    runtimeImplementation: "athena-js",
  });
  assert.ok(parsed);
  assert.equal(parsed?.endpoints?.data, "/api/athena");
});

test("B3 surviving: Policy still has CRUD action bits", () => {
  assert.equal(ACTION_BITS.select, 1);
  assert.equal(ACTION_BITS.insert, 2);
  assert.equal(ACTION_BITS.update, 4);
  assert.equal(ACTION_BITS.delete, 8);
});

test("B4 surviving: upload input still has an s3_id field", () => {
  const sample = { s3_id: "conn_1" } as AthenaStorageFileUploadInput;
  assert.equal(sample.s3_id, "conn_1");
});

test("B5: createStorageClient is not a package export", async () => {
  const mod = await import("../../src/index.ts");
  assert.equal(
    "createStorageClient" in mod,
    false,
    "public createStorageClient() is forbidden"
  );
});

test("B6: local ObjectStore materialize still works", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-storage-sdd-b6-"));
  const client = createClient({
    storage: { provider: "local", root },
  });
  const key = "baseline/notes.txt";
  await client.storage.file.upload({
    name: "notes.txt",
    source: new TextEncoder().encode("baseline"),
    storage_key: key,
  } as never);
  const bytes = await client.storage.file.get({ storage_key: key } as never);
  assert.ok(bytes);
});
