/**
 * Target dual-suite T1–T12 for Athena Embedded Storage Runtime.
 */

import { strict as assert } from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../../src/auth/contract/index.ts";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import {
  type AthenaRuntimeDiscoveryDocument,
  parseAthenaRuntimeDiscoveryDocument,
} from "../../src/gateway/discovery-types.ts";
import { createAthenaNextHandlers } from "../../src/next/data-handlers.ts";
import { createPolicyRegistry } from "../../src/policy/registry.ts";
import { ACTION_BITS } from "../../src/policy/types.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";
import { getAthenaClientInternals } from "../../src/runtime/client-internals.ts";
import { materializeStorage } from "../../src/runtime/materializers/storage.ts";
import type { AthenaStorageFileUploadInput } from "../../src/storage/file.ts";
import {
  bindStorageProvider,
  bindStorageRuntime,
  createStorageRuntime,
  DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT,
  decodeAthenaStorageBytes,
  executeStorageOverlay,
  getStorageProvider,
  isAthenaStorageBytesEnvelope,
  resolveBrowserStorageEndpoint,
} from "../../src/storage/runtime/index.ts";
import {
  overlayDeleteFolder,
  overlayMoveFile,
} from "../../src/storage/runtime/object-ops.ts";
import type {
  AuthorizedStorageOperation,
  StorageObjectProvider,
} from "../../src/storage/runtime/types.ts";
import { createClient } from "../../src/v3-client.ts";
import { createMockR2 } from "../helpers/d1-r2-mocks.ts";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "src");

const PRINCIPAL = {
  authenticated: true,
  grants: [] as const,
  rights: [parseAthenaRightKey("storage.*")],
  userId: "user_storage_sdd",
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

function localRoot(): string {
  return mkdtempSync(join(tmpdir(), "athena-storage-sdd-t-"));
}

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

function asBytes(value: unknown): Uint8Array {
  const decoded = decodeAthenaStorageBytes(value);
  if (decoded) {
    return decoded;
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  if (value && typeof value === "object" && "body" in value) {
    return asBytes((value as { body: unknown }).body);
  }
  if (value && typeof value === "object" && "data" in value) {
    return asBytes((value as { data: unknown }).data);
  }
  throw new Error(`expected bytes, got ${typeof value}`);
}

test("T1: StorageRuntime exists internally; createStorageClient stays unpublished", async () => {
  const runtime = createStorageRuntime({
    provider: {
      async execute() {
        return { data: { key: "x" }, ok: true, status: 200 };
      },
    },
  });
  assert.equal(typeof runtime.execute, "function");
  const pub = await import("../../src/index.ts");
  assert.equal("createStorageClient" in pub, false);
});

test("T2: provider port exists; local/r2 providers do not import Policy or Next", () => {
  const localSrc = readSrc("storage/runtime/providers/local-provider.ts");
  const r2Src = readSrc("storage/runtime/providers/r2-provider.ts");
  assert.match(localSrc, /StorageObjectProvider|AuthorizedStorageOperation/);
  assert.match(r2Src, /StorageObjectProvider|AuthorizedStorageOperation/);
  for (const src of [localSrc, r2Src]) {
    assert.equal(/from ["'].*policy\//.test(src), false);
    assert.equal(/from ["'].*next\//.test(src), false);
  }
});

test("T3: materializer returns a provider handle for local and r2", () => {
  const root = localRoot();
  const local = materializeStorage({
    storage: { provider: "local", root },
  });
  assert.ok(getStorageProvider(local.storage));

  const r2 = materializeStorage({
    storage: { r2: createMockR2() },
  });
  assert.ok(getStorageProvider(r2.storage));
});

test("T4: Nucleus executes object ops; unknown Policy action is denied", async () => {
  const root = localRoot();
  const materialized = materializeStorage({
    storage: { provider: "local", root },
  });
  const provider = getStorageProvider(materialized.storage);
  assert.ok(provider);
  const allowRead = createPolicyRegistry({
    definitions: [
      {
        actions: ACTION_BITS["storage.object.read"],
        composition: "permissive",
        id: "sto-read",
        principals: [{ kind: "authenticated" }],
        resource: { schema: "storage", table: "object" },
      },
    ],
    mode: "enforce",
  });
  const runtime = createStorageRuntime({
    policies: allowRead,
    provider,
  });
  const denied = await runtime.execute(
    { body: new TextEncoder().encode("nope"), key: "denied.txt", op: "put" },
    PRINCIPAL
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.error?.errorNumber, 3003);

  const open = createStorageRuntime({ provider });
  const put = await open.execute(
    { body: new TextEncoder().encode("hello"), key: "ok.txt", op: "put" },
    PRINCIPAL
  );
  assert.equal(put.ok, true);
  const got = await open.execute({ key: "ok.txt", op: "get" }, PRINCIPAL);
  assert.equal(got.ok, true);
  assert.equal(new TextDecoder().decode(asBytes(got.data)), "hello");
});

test("T4-SCOPE: storage key scoping is principal-derived and opt-in", async () => {
  const calls: Array<{ key?: string; op: string; prefix?: string }> = [];
  const objects = new Map<string, Uint8Array>();
  const provider: StorageObjectProvider = {
    async execute(op) {
      calls.push({ key: op.key, op: op.op, prefix: op.prefix });
      if (op.op === "put") {
        objects.set(op.key ?? "", op.body ?? new Uint8Array());
        return { data: { key: op.key }, ok: true, status: 200 };
      }
      if (op.op === "get") {
        const body = objects.get(op.key ?? "");
        return body
          ? { data: body, ok: true, status: 200 }
          : {
              error: {
                code: "storage_file_not_found",
                errorNumber: 3005,
                message: "missing",
              },
              ok: false,
              status: 404,
            };
      }
      if (op.op === "list") {
        return {
          data: {
            objects: [...objects.keys()]
              .filter((key) => key.startsWith(op.prefix ?? ""))
              .map((key) => ({ key })),
          },
          ok: true,
          status: 200,
        };
      }
      return {
        data: { key: op.key },
        ok: true,
        status: 200,
      };
    },
  };
  const principal = { ...PRINCIPAL, userId: "tenant-a-user" };
  const unscoped = createStorageRuntime({ provider });
  await unscoped.execute({ key: "docs/a.txt", op: "get" }, principal);
  assert.equal(calls.at(-1)?.key, "docs/a.txt");

  const scoped = createStorageRuntime({
    keyScope: (subject) => `organizations/${subject.userId}/`,
    provider,
  });
  await scoped.execute(
    { body: "tenant-a", key: "docs/a.txt", op: "put" },
    principal
  );
  await scoped.execute({ key: "/", op: "get" }, principal);
  assert.equal(calls.at(-1)?.key, "organizations/tenant-a-user/");
  const otherPrincipal = { ...PRINCIPAL, userId: "tenant-b-user" };
  const otherRead = await scoped.execute(
    { key: "docs/a.txt", op: "get" },
    otherPrincipal
  );
  assert.equal(otherRead.status, 404);
  await scoped.execute({ op: "list", prefix: "docs" }, principal);
  assert.equal(calls.at(-1)?.prefix, "organizations/tenant-a-user/docs");
  const otherList = await scoped.execute(
    { op: "list", prefix: "docs" },
    otherPrincipal
  );
  assert.deepEqual((otherList.data as { objects: unknown[] }).objects, []);
  const scopedRead = await scoped.execute(
    { key: "docs/a.txt", op: "get" },
    principal
  );
  assert.ok(scopedRead.data instanceof Uint8Array);
  assert.deepEqual(scopedRead.data, new TextEncoder().encode("tenant-a"));
  const scopedKeys = [...objects.keys()];
  assert.deepEqual(scopedKeys, ["organizations/tenant-a-user/docs/a.txt"]);
  const invalid = await scoped.execute(
    { key: "../tenant-b/docs/a.txt", op: "get" },
    principal
  );
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, 403);
});

test("T4-SCOPE-FAIL-CLOSED: empty namespaces never reach the provider", async () => {
  let providerCalls = 0;
  const provider: StorageObjectProvider = {
    async execute() {
      providerCalls += 1;
      return { data: {}, ok: true, status: 200 };
    },
  };

  for (const keyScopeValue of ["", "  ", "/", "///"]) {
    const runtime = createStorageRuntime({
      keyScope: () => keyScopeValue,
      provider,
    });
    const result = await runtime.execute(
      { key: "private.txt", op: "get" },
      PRINCIPAL
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
  }

  assert.equal(providerCalls, 0);
});

test("T4-SCOPE-METADATA: scoped listings preserve Date metadata", async () => {
  const uploadedAt = new Date("2026-10-17T12:34:56.000Z");
  const runtime = createStorageRuntime({
    keyScope: (principal) => `organizations/${principal.userId}/`,
    provider: {
      async execute() {
        return {
          data: {
            objects: [
              {
                key: `organizations/${PRINCIPAL.userId}/docs/report.pdf`,
                lastModified: uploadedAt,
              },
            ],
          },
          ok: true,
          status: 200,
        };
      },
    },
  });

  const result = await runtime.execute(
    { op: "list", prefix: "docs/" },
    PRINCIPAL
  );
  const objects = (result.data as { objects: Array<{ lastModified: unknown }> })
    .objects;

  assert.ok(objects[0]?.lastModified instanceof Date);
  assert.equal(objects[0]?.lastModified, uploadedAt);
});

test("T4-FOLDER-PAGE: folder deletion fails before mutation when listing is incomplete", async () => {
  let page = 0;
  let deleted = 0;
  const runtime = createStorageRuntime({
    provider: {
      async execute(op) {
        if (op.op === "list") {
          page += 1;
          return {
            data: {
              cursor: `page-${page}`,
              objects: [{ key: `docs/${page}.txt` }],
            },
            ok: true,
            status: 200,
          };
        }
        if (op.op === "delete") {
          deleted += 1;
        }
        return { data: {}, ok: true, status: 200 };
      },
    },
  });
  await assert.rejects(
    () => overlayDeleteFolder(runtime, { prefix: "docs/" }),
    /incomplete|pagination/i
  );
  assert.equal(page, 50);
  assert.equal(deleted, 0);
});

test("T4-FOLDER-TRUNCATED: missing cursor fails before folder mutation", async () => {
  let deleted = 0;
  const runtime = createStorageRuntime({
    provider: {
      async execute(op) {
        if (op.op === "list") {
          return {
            data: {
              objects: [{ key: "docs/a.txt" }],
              truncated: true,
            },
            ok: true,
            status: 200,
          };
        }
        if (op.op === "delete") {
          deleted += 1;
        }
        return { data: {}, ok: true, status: 200 };
      },
    },
  });

  await assert.rejects(
    () => overlayDeleteFolder(runtime, { prefix: "docs/" }),
    /incomplete|pagination/i
  );
  assert.equal(deleted, 0);
});

test("T4-FOLDER-PARTIAL: failed deletes report already completed keys", async () => {
  const runtime = createStorageRuntime({
    provider: {
      async execute(op) {
        if (op.op === "list") {
          return {
            data: { objects: [{ key: "docs/a" }, { key: "docs/b" }] },
            ok: true,
            status: 200,
          };
        }
        if (op.op === "delete" && op.key === "docs/b") {
          return {
            error: {
              code: "storage_internal",
              errorNumber: 3010,
              message: "provider failed",
            },
            ok: false,
            status: 500,
          };
        }
        return { data: {}, ok: true, status: 200 };
      },
    },
  });
  await assert.rejects(
    () => overlayDeleteFolder(runtime, { prefix: "docs/" }),
    (error: unknown) => {
      assert.deepEqual((error as { deleted?: string[] }).deleted, ["docs/a"]);
      assert.deepEqual((error as { remaining?: string[] }).remaining, [
        "docs/b",
      ]);
      return true;
    }
  );
});

test("T4-MOVE: object moves preserve metadata and reject occupied destinations", async () => {
  let failSourceDelete = false;
  const ifAbsentWrites: boolean[] = [];
  const objects = new Map<
    string,
    { body: Uint8Array; contentType: string; metadata: Record<string, string> }
  >([
    [
      "source.txt",
      {
        body: new TextEncoder().encode("source"),
        contentType: "text/plain",
        metadata: { owner: "a" },
      },
    ],
    [
      "target.txt",
      {
        body: new TextEncoder().encode("target"),
        contentType: "text/target",
        metadata: { owner: "b" },
      },
    ],
  ]);
  const runtime = createStorageRuntime({
    provider: {
      async execute(op) {
        if (op.op === "get") {
          const found = objects.get(op.key ?? "");
          return found
            ? { data: found.body, ok: true, status: 200 }
            : {
                error: {
                  code: "storage_file_not_found",
                  errorNumber: 3005,
                  message: "missing",
                },
                ok: false,
                status: 404,
              };
        }
        if (op.op === "head") {
          const found = objects.get(op.key ?? "");
          return found
            ? {
                data: {
                  contentType: found.contentType,
                  metadata: found.metadata,
                },
                ok: true,
                status: 200,
              }
            : {
                error: {
                  code: "storage_file_not_found",
                  errorNumber: 3005,
                  message: "missing",
                },
                ok: false,
                status: 404,
              };
        }
        if (op.op === "put") {
          ifAbsentWrites.push(op.ifAbsent === true);
          objects.set(op.key ?? "", {
            body: op.body ?? new Uint8Array(),
            contentType: op.contentType ?? "",
            metadata: op.metadata ?? {},
          });
          return { data: {}, ok: true, status: 200 };
        }
        if (op.op === "delete") {
          if (failSourceDelete && op.key === "source.txt") {
            return {
              error: {
                code: "storage_internal",
                errorNumber: 3010,
                message: "delete failed",
              },
              ok: false,
              status: 500,
            };
          }
          objects.delete(op.key ?? "");
          return { data: {}, ok: true, status: 200 };
        }
        return { data: {}, ok: true, status: 200 };
      },
    },
  });
  await assert.rejects(
    () => overlayMoveFile(runtime, { from: "source.txt", to: "target.txt" }),
    /destination|exist|conflict/i
  );
  assert.equal(
    new TextDecoder().decode(objects.get("source.txt")?.body),
    "source"
  );
  assert.equal(
    new TextDecoder().decode(objects.get("target.txt")?.body),
    "target"
  );

  objects.delete("target.txt");
  await overlayMoveFile(runtime, { from: "source.txt", to: "target.txt" });
  assert.deepEqual(objects.get("target.txt"), {
    body: new TextEncoder().encode("source"),
    contentType: "text/plain",
    metadata: { owner: "a" },
  });
  assert.deepEqual(ifAbsentWrites, [true]);
  assert.equal(objects.has("source.txt"), false);

  objects.set("source.txt", {
    body: new TextEncoder().encode("source"),
    contentType: "text/plain",
    metadata: { owner: "a" },
  });
  objects.delete("target.txt");
  failSourceDelete = true;
  await assert.rejects(
    () => overlayMoveFile(runtime, { from: "source.txt", to: "target.txt" }),
    (error: unknown) => {
      assert.deepEqual((error as { copied?: string[] }).copied, ["target.txt"]);
      return true;
    }
  );
  assert.deepEqual(ifAbsentWrites, [true, true]);
  assert.equal(objects.has("source.txt"), true);
  assert.equal(objects.has("target.txt"), true);
});

test("T5: lifecycle.storage is invoked around execute", async () => {
  const phases: string[] = [];
  const runtime = createStorageRuntime({
    lifecycle: {
      after: () => {
        phases.push("after");
      },
      before: () => {
        phases.push("before");
      },
    },
    provider: {
      async execute() {
        phases.push("provider");
        return { data: { key: "k" }, ok: true, status: 200 };
      },
    },
  });
  await runtime.execute({ key: "k", op: "get" }, PRINCIPAL);
  assert.deepEqual(phases, ["before", "provider", "after"]);
});

test("T6: createAthenaNextHandlers().storage is a method map", () => {
  const client = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_storage_sdd",
    gatewayTransport: mockTransport(),
    storage: { provider: "local", root: localRoot() },
  });
  const handlers = createAthenaNextHandlers({
    client,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  assert.equal(typeof handlers.storage.GET, "function");
  assert.equal(typeof handlers.storage.POST, "function");
});

test("T6-AUTH-FIRST: storage POST authenticates before reading its JSON body", async () => {
  const client = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_storage_sdd",
    gatewayTransport: mockTransport(),
    storage: { provider: "local", root: localRoot() },
  });
  const handlers = createAthenaNextHandlers({
    auth: {
      lookupSession: async () => null,
      mode: "athena-session",
    },
    client,
    security: { mode: "authenticated" },
  });
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulled += 1;
        controller.enqueue(new TextEncoder().encode('{"operation":"get"}'));
        controller.close();
      },
    },
    { highWaterMark: 0 }
  );
  const request = new Request("http://localhost/api/athena/storage", {
    body,
    // Node's Request requires duplex for a streaming request body.
    duplex: "half",
    headers: { origin: "http://localhost" },
    method: "POST",
  } as RequestInit & { duplex: "half" });
  const response = await handlers.storage.POST(request);
  assert.equal(response.status, 401);
  assert.equal(pulled, 0);
});

test("T6-BODY-LIMIT: configured storage body limit rejects oversized JSON", async () => {
  const client = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_storage_sdd",
    gatewayTransport: mockTransport(),
    storage: { provider: "local", root: localRoot() },
  });
  const handlers = createAthenaNextHandlers({
    client,
    security: { mode: "trusted" },
    storage: { maxBodyBytes: 8 },
    unsafeAllowUnauthenticated: true,
  });
  const response = await handlers.storage.POST(
    new Request("http://localhost/api/athena/storage", {
      body: '{"operation":"get"}',
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(response.status, 413);
});

test("T7: discovery endpoints.storage is a string and JSON has no secrets", async () => {
  const client = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_storage_sdd",
    gatewayTransport: mockTransport(),
    storage: { provider: "local", root: localRoot() },
  });
  const handlers = createAthenaNextHandlers({
    client,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  const response = await handlers.storage.GET(
    new Request("http://localhost/api/athena/storage")
  );
  assert.equal(response.ok, true);
  const body = (await response.json()) as AthenaRuntimeDiscoveryDocument;
  assert.equal(typeof body.endpoints?.storage, "string");
  const parsed = parseAthenaRuntimeDiscoveryDocument(body);
  assert.equal(typeof parsed?.endpoints?.storage, "string");
  const json = JSON.stringify(body);
  assert.equal(/secret|password|accessKey|privateKey/i.test(json), false);
});

test("T8: browser transport uses /api/athena/storage or discovery endpoint", () => {
  assert.equal(DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT, "/api/athena/storage");
  assert.equal(resolveBrowserStorageEndpoint(undefined), "/api/athena/storage");
  assert.equal(
    resolveBrowserStorageEndpoint({ storage: "/custom/storage" }),
    "/custom/storage"
  );
});

test("T9: same operation identity server-direct vs HTTP", async () => {
  const root = localRoot();
  const client = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_storage_sdd",
    gatewayTransport: mockTransport(),
    storage: { provider: "local", root },
  });
  const internals = getAthenaClientInternals(client);
  const runtime = internals?.storageRuntime;
  assert.ok(runtime);
  const key = "same-op.bin";
  const payload = new TextEncoder().encode("same-bytes");
  const direct = await runtime.execute(
    { body: payload, key, op: "put" },
    PRINCIPAL
  );
  assert.equal(direct.ok, true);
  const handlers = createAthenaNextHandlers({
    auth: {
      lookupSession: async (token) =>
        token === "sess_storage"
          ? {
              session: { id: "session-storage", userId: "user_storage_sdd" },
              user: {
                id: "user_storage_sdd",
                rights: ["storage.*"],
              },
            }
          : null,
      mode: "athena-session",
    },
    client,
    security: { mode: "authenticated" },
  });
  const sessionHeaders = {
    "content-type": "application/json",
    cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_storage`,
    origin: "http://localhost",
  };
  const httpPut = await handlers.storage.POST(
    new Request("http://localhost/api/athena/storage", {
      body: JSON.stringify({
        operation: "put",
        payload: {
          body: Buffer.from(payload).toString("base64"),
          key,
        },
      }),
      headers: sessionHeaders,
      method: "POST",
    })
  );
  assert.equal(httpPut.ok, true);
  const collision = await handlers.storage.POST(
    new Request("http://localhost/api/athena/storage", {
      body: JSON.stringify({
        operation: "put",
        payload: {
          body: Buffer.from(new TextEncoder().encode("overwrite")).toString(
            "base64"
          ),
          ifAbsent: true,
          key,
        },
      }),
      headers: sessionHeaders,
      method: "POST",
    })
  );
  assert.equal(collision.status, 409);
  const httpGet = await handlers.storage.POST(
    new Request("http://localhost/api/athena/storage", {
      body: JSON.stringify({ operation: "get", payload: { key } }),
      headers: sessionHeaders,
      method: "POST",
    })
  );
  assert.equal(httpGet.ok, true);
  const httpBody = (await httpGet.json()) as { data?: unknown };
  const viaHttp = asBytes(httpBody.data);
  const viaDirect = await runtime.execute({ key, op: "get" }, PRINCIPAL);
  assert.deepEqual(asBytes(viaDirect.data), viaHttp);
  assert.equal(new TextDecoder().decode(viaHttp), "same-bytes");
});

test("T13: Embedded Storage HTTP preserves binary bytes without UTF-8 decoding", async () => {
  const handlersSrc = readSrc("next/storage-handlers.ts");
  assert.match(handlersSrc, /decodeAthenaStorageRequestBody\(payload\.body\)/);

  const objects = new Map<string, Uint8Array>();
  const provider: StorageObjectProvider = {
    async execute(op: AuthorizedStorageOperation) {
      if (op.op === "put" && op.key) {
        objects.set(op.key, op.body ?? new Uint8Array());
        return { data: { key: op.key }, ok: true, status: 200 };
      }
      if (op.op === "get" && op.key) {
        const body = objects.get(op.key);
        if (!body) {
          return {
            error: {
              code: "storage_file_not_found",
              errorNumber: 3005,
              message: "missing",
            },
            ok: false,
            status: 404,
          };
        }
        return { data: body, ok: true, status: 200 };
      }
      return {
        error: {
          code: "storage_invalid_request",
          errorNumber: 3000,
          message: `unsupported ${op.op}`,
        },
        ok: false,
        status: 400,
      };
    },
  };
  const runtime = createStorageRuntime({ provider });
  const client = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_storage_sdd",
    gatewayTransport: mockTransport(),
    storage: bindStorageRuntime(bindStorageProvider({}, provider), runtime),
  });
  const key = "binary.bin";
  const payload = Uint8Array.from([0, 127, 128, 255, 10]);
  assert.notDeepEqual(
    new TextEncoder().encode(new TextDecoder().decode(payload)),
    payload
  );
  const put = await runtime.execute(
    { body: payload, key, op: "put" },
    PRINCIPAL
  );
  assert.equal(put.ok, true);
  const handlers = createAthenaNextHandlers({
    auth: {
      lookupSession: async (token) =>
        token === "sess_storage"
          ? {
              session: { id: "session-storage", userId: "user_storage_sdd" },
              user: {
                id: "user_storage_sdd",
                rights: ["storage.*"],
              },
            }
          : null,
      mode: "athena-session",
    },
    client,
    security: { mode: "authenticated" },
  });
  const sessionHeaders = {
    "content-type": "application/json",
    cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_storage`,
    origin: "http://localhost",
  };
  const httpGet = await handlers.storage.POST(
    new Request("http://localhost/api/athena/storage", {
      body: JSON.stringify({ operation: "get", payload: { key } }),
      headers: sessionHeaders,
      method: "POST",
    })
  );
  assert.equal(httpGet.ok, true);
  const httpBody = (await httpGet.json()) as { data?: unknown };
  assert.equal(isAthenaStorageBytesEnvelope(httpBody.data), true);
  assert.deepEqual(asBytes(httpBody.data), payload);
  const rawGet = await handlers.storage.GET(
    new Request(
      `http://localhost/api/athena/storage?key=${encodeURIComponent(key)}`,
      {
        headers: {
          cookie: sessionHeaders.cookie,
          origin: sessionHeaders.origin,
        },
      }
    )
  );
  assert.equal(rawGet.ok, true);
  assert.match(rawGet.headers.get("content-type") ?? "", /octet-stream/i);
  assert.deepEqual(new Uint8Array(await rawGet.arrayBuffer()), payload);
});

test("T10: browser graph cannot materialize credentialed S3/R2", () => {
  const browser = readSrc("browser.ts");
  const core = readSrc("v3-client-core.ts");
  const transport = readSrc("storage/runtime/browser-transport.ts");
  for (const src of [browser, core, transport]) {
    assert.equal(src.includes("storage/local.ts"), false);
    assert.equal(/from ["']node:fs/.test(src), false);
    assert.equal(/secretAccessKey|aws_secret_access_key/.test(src), false);
  }
});

test("T11: upload input type allows omitted s3_id when runtime authorized", () => {
  const without: AthenaStorageFileUploadInput = {
    files: new Uint8Array(),
    name: "notes.txt",
    storage_key: "notes.txt",
  };
  assert.equal(without.s3_id, undefined);
});

test("T12: overlay path calls Nucleus, not the provider", async () => {
  const seen: string[] = [];
  const provider: StorageObjectProvider = {
    async execute(op: AuthorizedStorageOperation) {
      seen.push(`provider:${op.op}`);
      return { data: { key: op.key }, ok: true, status: 200 };
    },
  };
  const runtime = createStorageRuntime({
    lifecycle: {
      before: () => {
        seen.push("nucleus");
      },
    },
    provider,
  });
  await executeStorageOverlay(runtime, {
    key: "overlay.txt",
    op: "put",
    source: new TextEncoder().encode("via-nucleus"),
  });
  assert.ok(seen.includes("nucleus"));
  assert.ok(seen.some((item) => item.startsWith("provider:")));
});
