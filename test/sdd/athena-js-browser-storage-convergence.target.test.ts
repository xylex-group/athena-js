/**
 * Target: browser createClient().storage → /api/athena/storage → StorageRuntime.
 * See docs/sdd/xylex/athena-js-browser-storage-convergence/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../../src/auth/contract/index.ts";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import {
  createClient as createNextBrowserClient,
  resetAthenaDiscoverySessionCache,
} from "../../src/next/client.ts";
import { createAthenaNextHandlers } from "../../src/next/data-handlers.ts";
import { getAthenaClientInternals } from "../../src/runtime/client-internals.ts";
import { DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT } from "../../src/runtime/data/discovery-document.ts";
import { normalizeAthenaPrincipal } from "../../src/runtime/data/principal.ts";
import {
  bindStorageProvider,
  bindStorageRuntime,
  createStorageRuntime,
  decodeAthenaStorageBytes,
} from "../../src/storage/runtime/index.ts";
import type {
  AuthorizedStorageOperation,
  StorageObjectProvider,
} from "../../src/storage/runtime/types.ts";
import { createClient } from "../../src/v3-client.ts";
import {
  type AthenaStorageConfig,
  createClient as createCoreClient,
} from "../../src/v3-client-core.ts";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "src");
const pkgRoot = join(here, "..", "..");

const PRINCIPAL = normalizeAthenaPrincipal({
  authenticated: true,
  rights: ["storage.*"],
  userId: "user_storage_sdd",
});

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

function localRoot(): string {
  return mkdtempSync(join(tmpdir(), "athena-br-sto-"));
}

function sessionHeaders(): Record<string, string> {
  return {
    cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_storage`,
    origin: "http://localhost",
  };
}

function asBytes(value: unknown): Uint8Array {
  const decoded = decodeAthenaStorageBytes(value);
  if (decoded) {
    return decoded;
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  if (value && typeof value === "object" && "data" in value) {
    return asBytes((value as { data: unknown }).data);
  }
  if (value && typeof value === "object" && "body" in value) {
    return asBytes((value as { body: unknown }).body);
  }
  throw new Error(`expected bytes, got ${typeof value}`);
}

function installHandlerFetch(
  handlers: ReturnType<typeof createAthenaNextHandlers>["storage"],
  options?: { cookie?: string }
): () => void {
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    if (options?.cookie && !headers.has("cookie")) {
      headers.set("cookie", options.cookie);
    }
    if (!headers.has("origin")) {
      headers.set("origin", "http://localhost");
    }
    const request = new Request(url, {
      body: init?.body ?? (input instanceof Request ? input.body : undefined),
      headers,
      method,
    });
    if (method === "GET") {
      return handlers.GET(request);
    }
    return handlers.POST(request);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previous;
  };
}

test("T-BR-ATTACH: P?: browser createClient attaches Embedded Storage HTTP transport", () => {
  const core = readSrc("v3-client-assembly.ts");
  assert.match(core, /createBrowserStorageTransport/);
  const restore = installHandlerFetch({
    GET: async () =>
      Response.json({ endpoints: { storage: "/api/athena/storage" } }),
    POST: async () =>
      Response.json({ data: { key: "x" }, ok: true, status: 200 }),
  });
  try {
    const client = withBrowserEnv(() =>
      createCoreClient({ gatewayTransport: mockTransport() })
    );
    assert.equal(typeof client.storage.file.upload, "function");
    assert.equal(typeof client.storage.file.get, "function");
    assert.equal(typeof client.storage.file.list, "function");
    assert.equal(typeof client.storage.file.delete, "function");
  } finally {
    restore();
  }
});

test("T-BR-DEFAULT: P?: browser Storage defaults to /api/athena/storage", async () => {
  const urls: string[] = [];
  const restore = installHandlerFetch({
    GET: async (request) => {
      urls.push(new URL(request.url).pathname);
      return Response.json({ athena: true, endpoints: {} }, { status: 200 });
    },
    POST: async (request) => {
      urls.push(new URL(request.url).pathname);
      return Response.json({ data: { key: "k" }, ok: true, status: 200 });
    },
  });
  try {
    const client = withBrowserEnv(() =>
      createCoreClient({ gatewayTransport: mockTransport() })
    );
    await client.storage.file
      .upload({
        name: "k.txt",
        source: new TextEncoder().encode("x"),
        storage_key: "k.txt",
      } as never)
      .catch(() => undefined);
    assert.ok(
      urls.includes(DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT),
      `expected ${DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT}, got ${urls.join(",")}`
    );
  } finally {
    restore();
  }
});

test("T-BR-DISCOVERY: P?: without topology, browser Storage uses the default path and does not GET-probe", async () => {
  const gets: string[] = [];
  const posts: string[] = [];
  const restore = installHandlerFetch({
    GET: async (request) => {
      gets.push(new URL(request.url).pathname);
      return Response.json({
        athena: true,
        endpoints: { storage: "/custom/storage" },
      });
    },
    POST: async (request) => {
      posts.push(new URL(request.url).pathname);
      return Response.json({ data: { key: "k" }, ok: true, status: 200 });
    },
  });
  try {
    const client = withBrowserEnv(() =>
      createCoreClient({ gatewayTransport: mockTransport() })
    );
    await client.storage.file.upload({
      name: "k.txt",
      source: new TextEncoder().encode("x"),
      storage_key: "k.txt",
    } as never);
    assert.deepEqual(gets, []);
    assert.deepEqual(posts, [DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT]);
  } finally {
    restore();
  }
});

test("T-BR-NO-CTOR: P?: createStorageClient is not recommended or exported", async () => {
  const mod = await import("../../src/index.ts");
  assert.equal("createStorageClient" in mod, false);
  const pkg = JSON.parse(
    readFileSync(join(pkgRoot, "package.json"), "utf8")
  ) as {
    exports?: Record<string, unknown>;
  };
  assert.equal(pkg.exports?.["./storage-client"], undefined);
  assert.equal(
    readSrc("v3-client-core.ts").includes("createStorageClient"),
    false
  );
});

test("T-BR-NODE-DIRECT: P?: Node createClient storage uses direct local execution not browser HTTP", async () => {
  const root = localRoot();
  const hits: string[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    hits.push(String(input instanceof Request ? input.url : input));
    return new Response("nope", { status: 500 });
  }) as typeof fetch;
  try {
    const client = createClient({
      storage: { provider: "local", root },
    });
    await client.storage.file.upload({
      name: "direct.txt",
      source: new TextEncoder().encode("disk"),
      storage_key: "direct.txt",
    } as never);
    assert.equal(readFileSync(join(root, "direct.txt"), "utf8"), "disk");
    assert.equal(
      hits.some((url) => url.includes("/api/athena/storage")),
      false
    );
  } finally {
    globalThis.fetch = previous;
  }
});

test("T-BR-DISCOVERY-CONDITIONAL: P?: discovery advertises Storage only when a Storage Runtime exists", async () => {
  const without = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_storage_sdd",
    gatewayTransport: mockTransport(),
  });
  const withoutHandlers = createAthenaNextHandlers({
    client: without,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  const withoutBody = (await (
    await withoutHandlers.storage.GET(
      new Request("http://localhost/api/athena/storage")
    )
  ).json()) as { endpoints?: { storage?: string } };
  assert.equal(withoutBody.endpoints?.storage, undefined);

  const withStorage = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_storage_sdd",
    gatewayTransport: mockTransport(),
    storage: { provider: "local", root: localRoot() },
  });
  const withHandlers = createAthenaNextHandlers({
    client: withStorage,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  const withBody = (await (
    await withHandlers.storage.GET(
      new Request("http://localhost/api/athena/storage")
    )
  ).json()) as { endpoints?: { storage?: string } };
  assert.equal(
    withBody.endpoints?.storage,
    DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT
  );
});

test("T-BR-API: P?: browser and server expose the same file upload/get/list/delete API", () => {
  const server = createClient({
    storage: { provider: "local", root: localRoot() },
  });
  const browser = withBrowserEnv(() =>
    createCoreClient({ gatewayTransport: mockTransport() })
  );
  for (const method of ["upload", "get", "list", "delete"] as const) {
    assert.equal(
      typeof server.storage.file[method],
      "function",
      `server ${method}`
    );
    assert.equal(
      typeof browser.storage.file[method],
      "function",
      `browser ${method}`
    );
  }
});

test("T-BR-BUNDLE: P?: browser graph has no filesystem, R2 provider impl, AWS credentials, or server-only Auth", () => {
  const files = [
    "browser.ts",
    "v3-client-core.ts",
    "next/client.ts",
    "react-native/index.ts",
    "storage/runtime/browser-transport.ts",
    "storage/runtime/index.ts",
    "storage/runtime/nucleus.ts",
    "storage/runtime/overlays.ts",
  ];
  const blob = files.map((rel) => readSrc(rel)).join("\n");
  assert.equal(/from ["']node:fs/.test(blob), false);
  assert.equal(blob.includes("storage/local.ts"), false);
  assert.equal(blob.includes("providers/local-provider"), false);
  assert.equal(blob.includes("providers/r2-provider"), false);
  assert.equal(/aws_secret_access_key|secretAccessKey/.test(blob), false);
  assert.equal(/from ["']server-only["']/.test(blob), false);
  assert.equal(/from ["'][^"']*\/runtime\/authority\//.test(blob), false);
  assert.equal(blob.includes("auth/local/runtime"), false);
  assert.equal(blob.includes("auth/local/database"), false);
  assert.equal(
    existsSync(join(srcRoot, "storage", "runtime", "browser-transport.ts")),
    true
  );
});

test("T-BR-EQUIV-OP: P?: direct and browser HTTP Storage share operation identity", async () => {
  const root = localRoot();
  const server = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_storage_sdd",
    gatewayTransport: mockTransport(),
    storage: { provider: "local", root },
  });
  const runtime = getAthenaClientInternals(server)?.storageRuntime;
  assert.ok(runtime);
  const key = "same.bin";
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
              user: { id: "user_storage_sdd", rights: ["storage.*"] },
            }
          : null,
      mode: "athena-session",
    },
    client: server,
    security: { mode: "authenticated" },
  });
  const restore = installHandlerFetch(handlers.storage, {
    cookie: sessionHeaders().cookie,
  });
  try {
    const browser = withBrowserEnv(() =>
      createCoreClient({ gatewayTransport: mockTransport() })
    );
    await browser.storage.file.upload({
      name: key,
      source: payload,
      storage_key: key,
    } as never);
    const viaBrowser = await browser.storage.file.get({
      storage_key: key,
    } as never);
    const viaDirect = await runtime.execute({ key, op: "get" }, PRINCIPAL);
    assert.deepEqual(asBytes(viaDirect.data), asBytes(viaBrowser));
    assert.equal(new TextDecoder().decode(asBytes(viaBrowser)), "same-bytes");
  } finally {
    restore();
  }
});

test("T-BR-EQUIV-ERR: P?: direct and browser HTTP Storage share error identity", async () => {
  const server = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_storage_sdd",
    gatewayTransport: mockTransport(),
    storage: { provider: "local", root: localRoot() },
  });
  const runtime = getAthenaClientInternals(server)?.storageRuntime;
  assert.ok(runtime);
  const denied = await runtime.execute(
    { body: new TextEncoder().encode("x"), key: "deny.bin", op: "put" },
    normalizeAthenaPrincipal({
      authenticated: true,
      rights: ["storage.get"],
      userId: "user-a",
    })
  );
  const handlers = createAthenaNextHandlers({
    auth: {
      lookupSession: async () => ({
        session: { id: "session-a", userId: "user-a" },
        user: { id: "user-a", rights: ["storage.get"] },
      }),
      mode: "athena-session",
    },
    client: server,
    security: { mode: "authenticated" },
  });
  const restore = installHandlerFetch(handlers.storage, {
    cookie: sessionHeaders().cookie,
  });
  try {
    const browser = withBrowserEnv(() =>
      createCoreClient({ gatewayTransport: mockTransport() })
    );
    await assert.rejects(
      async () =>
        browser.storage.file.upload({
          name: "deny.bin",
          source: new TextEncoder().encode("x"),
          storage_key: "deny.bin",
        } as never),
      (error: unknown) =>
        error instanceof Error &&
        (error.message.includes("missing required storage right") ||
          error.message.includes("denied"))
    );
    assert.equal(denied.ok, false);
    assert.equal(denied.error?.errorNumber, 3003);
  } finally {
    restore();
  }
});

test("T-BR-EQUIV-LIFECYCLE: P?: browser HTTP Storage runs server Storage lifecycle", async () => {
  const phases: string[] = [];
  const server = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_storage_sdd",
    gatewayTransport: mockTransport(),
    lifecycle: {
      storage: {
        after: () => {
          phases.push("after");
        },
        before: () => {
          phases.push("before");
        },
      },
    },
    storage: { provider: "local", root: localRoot() },
  });
  const handlers = createAthenaNextHandlers({
    auth: {
      lookupSession: async () => ({
        session: { id: "session-storage", userId: "user_storage_sdd" },
        user: { id: "user_storage_sdd", rights: ["storage.*"] },
      }),
      mode: "athena-session",
    },
    client: server,
    security: { mode: "authenticated" },
  });
  const restore = installHandlerFetch(handlers.storage, {
    cookie: sessionHeaders().cookie,
  });
  try {
    const browser = withBrowserEnv(() =>
      createCoreClient({ gatewayTransport: mockTransport() })
    );
    await browser.storage.file.upload({
      name: "life.bin",
      source: new TextEncoder().encode("x"),
      storage_key: "life.bin",
    } as never);
    assert.ok(phases.includes("before"));
    assert.ok(phases.includes("after"));
  } finally {
    restore();
  }
});

test("T-BR-EQUIV-AUTH: P?: browser HTTP Storage uses request principal authorization", async () => {
  const server = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_storage_sdd",
    gatewayTransport: mockTransport(),
    storage: { provider: "local", root: localRoot() },
  });
  const handlers = createAthenaNextHandlers({
    auth: {
      lookupSession: async (token) =>
        token === "sess_storage"
          ? {
              session: { id: "session-storage", userId: "user_storage_sdd" },
              user: { id: "user_storage_sdd", rights: ["storage.*"] },
            }
          : null,
      mode: "athena-session",
    },
    client: server,
    security: { mode: "authenticated" },
  });
  const restoreAnon = installHandlerFetch(handlers.storage);
  try {
    const browser = withBrowserEnv(() =>
      createCoreClient({ gatewayTransport: mockTransport() })
    );
    await assert.rejects(async () =>
      browser.storage.file.upload({
        name: "auth.bin",
        source: new TextEncoder().encode("x"),
        storage_key: "auth.bin",
      } as never)
    );
  } finally {
    restoreAnon();
  }
  const restoreAuth = installHandlerFetch(handlers.storage, {
    cookie: sessionHeaders().cookie,
  });
  try {
    const browser = withBrowserEnv(() =>
      createCoreClient({ gatewayTransport: mockTransport() })
    );
    const uploaded = await browser.storage.file.upload({
      name: "auth.bin",
      source: new TextEncoder().encode("ok"),
      storage_key: "auth.bin",
    } as never);
    assert.ok(uploaded);
  } finally {
    restoreAuth();
  }
});

type NucleusListPage = {
  cursor?: string;
  objects: Array<{ key: string }>;
  truncated: boolean;
};

function asEmbeddedStorageFile(file: unknown): {
  head: (input: unknown) => Promise<unknown>;
} {
  return file as {
    head: (input: unknown) => Promise<unknown>;
  };
}

function asNucleusListPage(value: unknown): NucleusListPage {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const objects = Array.isArray(record.objects)
    ? record.objects.flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }
        const key = (entry as { key?: unknown }).key;
        return typeof key === "string" ? [{ key }] : [];
      })
    : [];
  return {
    ...(typeof record.cursor === "string" ? { cursor: record.cursor } : {}),
    objects,
    truncated: record.truncated === true,
  };
}

function memoryObjectProvider(): StorageObjectProvider & {
  calls: AuthorizedStorageOperation[];
} {
  const objects = new Map<
    string,
    { body: Uint8Array; metadata?: Record<string, string> }
  >();
  const calls: AuthorizedStorageOperation[] = [];
  return {
    calls,
    async execute(op: AuthorizedStorageOperation) {
      calls.push(op);
      switch (op.op) {
        case "put": {
          if (!op.key) {
            return {
              error: {
                code: "storage_invalid_request",
                errorNumber: 3000,
                message: "put requires key",
              },
              ok: false,
              status: 400,
            };
          }
          objects.set(op.key, {
            body: op.body ?? new Uint8Array(),
            metadata: op.metadata,
          });
          return { data: { key: op.key }, ok: true, status: 200 };
        }
        case "get": {
          const row = op.key ? objects.get(op.key) : undefined;
          if (!row) {
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
          return { data: row.body, ok: true, status: 200 };
        }
        case "head": {
          const row = op.key ? objects.get(op.key) : undefined;
          return {
            data: {
              key: op.key,
              metadata: row?.metadata,
              size: row?.body.byteLength ?? 0,
            },
            ok: true,
            status: 200,
          };
        }
        case "delete": {
          if (op.key) {
            objects.delete(op.key);
          }
          return { data: { deleted: [op.key] }, ok: true, status: 200 };
        }
        case "list": {
          const keys = [...objects.keys()].sort();
          const start = op.cursor ? keys.indexOf(op.cursor) + 1 : 0;
          const limit = op.limit ?? keys.length;
          const page = keys.slice(
            Math.max(start, 0),
            Math.max(start, 0) + limit
          );
          const last = page.at(-1);
          return {
            data: {
              cursor: last,
              objects: page.map((key) => ({ key })),
              truncated: Math.max(start, 0) + limit < keys.length,
            },
            ok: true,
            status: 200,
          };
        }
        default: {
          const _never: never = op.op;
          return _never;
        }
      }
    },
  };
}

function storageSessionClient(provider: StorageObjectProvider) {
  const runtime = createStorageRuntime({ provider });
  const server = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_storage_sdd",
    gatewayTransport: mockTransport(),
    storage: bindStorageRuntime(
      bindStorageProvider({} as AthenaStorageConfig, provider),
      runtime
    ),
  });
  const handlers = createAthenaNextHandlers({
    auth: {
      lookupSession: async (token) =>
        token === "sess_storage"
          ? {
              session: { id: "session-storage", userId: "user_storage_sdd" },
              user: { id: "user_storage_sdd", rights: ["storage.*"] },
            }
          : null,
      mode: "athena-session",
    },
    client: server,
    security: { mode: "authenticated" },
  });
  return { handlers, runtime, server };
}

test("T-BR-EQUIV-BYTES: P?: direct HTTP and browser Storage round-trip non-UTF-8 bytes", async () => {
  const provider = memoryObjectProvider();
  const { handlers, runtime } = storageSessionClient(provider);
  const key = "noise.bin";
  const payload = Uint8Array.from([0, 127, 128, 255, 10]);
  const direct = await runtime.execute(
    { body: payload, key, op: "put" },
    PRINCIPAL
  );
  assert.equal(direct.ok, true);
  const httpGet = await handlers.storage.POST(
    new Request("http://localhost/api/athena/storage", {
      body: JSON.stringify({ operation: "get", payload: { key } }),
      headers: {
        "content-type": "application/json",
        ...sessionHeaders(),
      },
      method: "POST",
    })
  );
  assert.equal(httpGet.ok, true);
  const httpBody = (await httpGet.json()) as { data?: unknown };
  assert.deepEqual(asBytes(httpBody.data), payload);
  const restore = installHandlerFetch(handlers.storage, {
    cookie: sessionHeaders().cookie,
  });
  try {
    const browser = withBrowserEnv(() =>
      createCoreClient({ gatewayTransport: mockTransport() })
    );
    const viaBrowser = await browser.storage.file.get({
      storage_key: key,
    } as never);
    const viaDirect = await runtime.execute({ key, op: "get" }, PRINCIPAL);
    assert.deepEqual(asBytes(viaDirect.data), payload);
    assert.deepEqual(asBytes(viaBrowser), payload);
  } finally {
    restore();
  }
});

test("T-BR-EQUIV-META: P?: browser Storage forwards object metadata to the runtime", async () => {
  const provider = memoryObjectProvider();
  const { handlers, runtime } = storageSessionClient(provider);
  const restore = installHandlerFetch(handlers.storage, {
    cookie: sessionHeaders().cookie,
  });
  try {
    const browser = withBrowserEnv(() =>
      createCoreClient({ gatewayTransport: mockTransport() })
    );
    await browser.storage.file.upload({
      metadata: { role: "docs" },
      name: "meta.bin",
      source: new Uint8Array([1, 2, 3]),
      storage_key: "meta.bin",
    } as never);
    const viaDirect = await runtime.execute(
      { key: "meta.bin", op: "head" },
      PRINCIPAL
    );
    assert.equal(viaDirect.ok, true);
    assert.deepEqual(
      (viaDirect.data as { metadata?: Record<string, string> }).metadata,
      { role: "docs" }
    );
    const viaBrowser = await asEmbeddedStorageFile(browser.storage.file).head({
      storage_key: "meta.bin",
    });
    assert.deepEqual(
      (viaBrowser as { metadata?: Record<string, string> }).metadata,
      { role: "docs" }
    );
    const put = provider.calls.find((call) => call.op === "put");
    assert.deepEqual(put?.metadata, { role: "docs" });
  } finally {
    restore();
  }
});

test("T-BR-EQUIV-LIST: P?: browser Storage forwards list cursor and limit", async () => {
  const provider = memoryObjectProvider();
  const { handlers, runtime } = storageSessionClient(provider);
  for (const key of ["a.bin", "b.bin", "c.bin", "d.bin"]) {
    const put = await runtime.execute(
      { body: new Uint8Array([1]), key, op: "put" },
      PRINCIPAL
    );
    assert.equal(put.ok, true);
  }
  const restore = installHandlerFetch(handlers.storage, {
    cookie: sessionHeaders().cookie,
  });
  try {
    const browser = withBrowserEnv(() =>
      createCoreClient({ gatewayTransport: mockTransport() })
    );
    const firstPage: unknown = await browser.storage.file.list({
      limit: 2,
    } as never);
    const first = asNucleusListPage(firstPage);
    assert.equal(first.truncated, true);
    assert.deepEqual(
      first.objects.map((entry) => entry.key),
      ["a.bin", "b.bin"]
    );
    const secondPage: unknown = await browser.storage.file.list({
      cursor: first.cursor,
      limit: 2,
    } as never);
    const second = asNucleusListPage(secondPage);
    assert.deepEqual(
      second.objects.map((entry) => entry.key),
      ["c.bin", "d.bin"]
    );
    assert.equal(second.truncated, false);
    const listCalls = provider.calls.filter((call) => call.op === "list");
    assert.equal(listCalls[0]?.limit, 2);
    assert.equal(listCalls[1]?.cursor, first.cursor);
    assert.equal(listCalls[1]?.limit, 2);
  } finally {
    restore();
  }
});

const PROTOCOL_12_STORAGE_ON = {
  athena: true,
  capabilities: {
    auth: { available: true, transport: "same-origin" as const },
    data: true,
    delete: true,
    fetch: true,
    insert: true,
    models: "off" as const,
    nestedRelations: false,
    policy: false,
    rawSql: false,
    rpc: false,
    storage: true,
    update: true,
  },
  endpoints: {
    auth: "/api/auth",
    data: "/api/athena",
    storage: DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT,
  },
  protocol: { major: 1, minor: 2 },
  runtime: "next-local",
  runtimeImplementation: "athena-js",
  transports: {
    data: {
      credentials: "same-origin",
      kind: "http",
      origin: "same-origin",
      path: "/api/athena",
    },
    storage: {
      credentials: "same-origin",
      kind: "http",
      origin: "same-origin",
      path: DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT,
    },
  },
};

const PROTOCOL_12_STORAGE_OFF = {
  ...PROTOCOL_12_STORAGE_ON,
  capabilities: { ...PROTOCOL_12_STORAGE_ON.capabilities, storage: false },
  endpoints: {
    auth: "/api/auth",
    data: "/api/athena",
  },
  transports: {
    data: PROTOCOL_12_STORAGE_ON.transports.data,
  },
};

test("T-BR-NEXT-DISCOVER-SSR: P?: Next discovery attaches Embedded Storage without window (not gateway/fetch)", async () => {
  assert.equal(typeof globalThis.window, "undefined");
  resetAthenaDiscoverySessionCache();
  const posts: string[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const path = new URL(url, "http://localhost").pathname;
    if (method === "GET") {
      return Response.json(PROTOCOL_12_STORAGE_ON, { status: 200 });
    }
    posts.push(path);
    if (path.includes("/gateway/fetch")) {
      return Response.json(
        { error: { code: "forbidden" }, ok: false },
        { status: 403 }
      );
    }
    if (path === DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT) {
      return Response.json(
        { data: { objects: [], truncated: false }, ok: true, status: 200 },
        { status: 200 }
      );
    }
    return Response.json({ ok: false }, { status: 404 });
  }) as typeof fetch;
  try {
    const client = createNextBrowserClient({
      topology: { discover: "next", fallback: "error" },
    });
    await client.storage.file.list({} as never);
    assert.ok(
      posts.includes(DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT),
      `expected POST ${DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT}, got ${posts.join(",")}`
    );
    assert.equal(
      posts.some((path) => path.includes("/gateway/fetch")),
      false,
      `storage.file.list must not use /gateway/fetch, got ${posts.join(",")}`
    );
  } finally {
    globalThis.fetch = previous;
    resetAthenaDiscoverySessionCache();
  }
});

test("T-BR-NEXT-DISCOVER-NO-STORAGE: P?: discovery without Storage fail-closes instead of gateway list", async () => {
  resetAthenaDiscoverySessionCache();
  const posts: string[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const path = new URL(url, "http://localhost").pathname;
    if (method === "GET") {
      return Response.json(PROTOCOL_12_STORAGE_OFF, { status: 200 });
    }
    posts.push(path);
    return Response.json({ ok: false }, { status: 403 });
  }) as typeof fetch;
  try {
    const client = createNextBrowserClient({
      topology: { discover: "next", fallback: "error" },
    });
    await assert.rejects(() => client.storage.file.list({} as never));
    assert.equal(
      posts.some((path) => path.includes("/gateway/fetch")),
      false
    );
    assert.equal(posts.includes(DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT), false);
  } finally {
    globalThis.fetch = previous;
    resetAthenaDiscoverySessionCache();
  }
});

test("T-BR-NEXT-MINIMAL: P?: next-minimal browser client discovers Next and mounts Embedded Storage HTTP", () => {
  const exampleRoot = join(
    here,
    "..",
    "..",
    "..",
    "athena-auth-ui",
    "examples",
    "next-minimal"
  );
  const browser = readFileSync(
    join(exampleRoot, "src", "lib", "athena-browser.ts"),
    "utf8"
  );
  const storageRoute = readFileSync(
    join(exampleRoot, "src", "app", "api", "athena", "storage", "[[...path]]", "route.ts"),
    "utf8"
  );
  assert.match(browser, /discover:\s*"next"/);
  assert.match(browser, /@xylex-group\/athena\/next\/client/);
  assert.match(storageRoute, /from "@\/lib\/athena\/handlers"/);
  const core = readSrc("v3-client-assembly.ts");
  assert.match(core, /hasDiscoveredRuntimeTopology/);
  assert.match(core, /hasDiscoveredRuntimeTopology\(core\.config\)/);
  assert.match(
    readSrc("storage/runtime/browser-transport.ts"),
    /fail-closed/
  );
});
