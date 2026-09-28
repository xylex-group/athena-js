/**
 * Target — Storage / Billing transport finality.
 * GREEN after bytes/codec/error identity, Billing translator, Transport IR.
 * Former characterization baseline retired to
 * test/sdd/superseded/athena-js-storage-billing-transport-finality.baseline.superseded.ts.
 * See docs/sdd/xylex/athena-js-storage-billing-transport-finality/
 */
import { strict as assert } from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../../src/auth/contract/index.ts";
import {
  ATHENA_BILLING_AUTHORIZATION_DENIED,
  AthenaBillingAuthorizationError,
  AthenaBillingCapabilityError,
  AthenaBillingProviderRequestError,
} from "../../src/billing/errors.ts";
import { createBrowserBillingTransport } from "../../src/billing/runtime/browser-transport.ts";
import type { BillingOperation } from "../../src/billing/runtime/capabilities.ts";
import { billingErrorFromTransport } from "../../src/billing/runtime/http-error.ts";
import {
  authorizeBillingOperation,
  BILLING_OPERATION_RIGHTS,
  requiredBillingRights,
} from "../../src/billing/runtime/rights.ts";
import { prepareBillingCommand } from "../../src/billing/safety/prepare.ts";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import { parseAthenaRuntimeDiscoveryDocument } from "../../src/gateway/discovery-types.ts";
import {
  ATHENA_NEXT_RUNTIME_PROTOCOL,
  isCompatibleAthenaRuntimeProtocol,
} from "../../src/gateway/protocol.ts";
import { createAthenaBillingHandlers } from "../../src/next/billing-handlers.ts";
import { createAthenaStorageHandlers } from "../../src/next/storage-handlers.ts";
import { getAthenaClientInternals } from "../../src/runtime/client-internals.ts";
import { normalizeAthenaPrincipal } from "../../src/runtime/data/principal.ts";
import { storageErrorResult } from "../../src/storage/runtime/errors.ts";
import {
  bindStorageProvider,
  bindStorageRuntime,
  createBrowserStorageTransport,
  createStorageRuntime,
  decodeAthenaStorageRequestBody,
  encodeAthenaStorageBytes,
  isAthenaStorageBytesEnvelope,
  reviveAthenaStorageData,
  wrapStorageModuleWithRuntime,
} from "../../src/storage/runtime/index.ts";
import type {
  AuthorizedStorageOperation,
  StorageObjectProvider,
  StorageObjectResult,
  StorageRuntime,
} from "../../src/storage/runtime/types.ts";
import { createClient } from "../../src/v3-client.ts";
import { FetchMollieSdk } from "../helpers/fetch-mollie-sdk.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

type ErrorIdentity = {
  code: string | undefined;
  errorNumber: number | undefined;
  messageClass: string;
  status: number | undefined;
};

const STORAGE_DISCOVERY = {
  athena: true as const,
  capabilities: {
    auth: { available: false },
    delete: true,
    fetch: true,
    insert: true,
    models: "off" as const,
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
  runtime: "next-local" as const,
  runtimeImplementation: "athena-js" as const,
};

const BILLING_DISCOVERY = {
  ...STORAGE_DISCOVERY,
  endpoints: {
    billing: "/api/athena/billing",
    data: "/api/athena",
  },
};

const HOSTILE_BYTES: ReadonlyArray<{ bytes: Uint8Array; name: string }> = [
  { bytes: new Uint8Array([0x00]), name: "00" },
  { bytes: new Uint8Array([0xff]), name: "FF" },
  { bytes: new Uint8Array([0xfe]), name: "FE" },
  { bytes: new Uint8Array([0x80]), name: "80" },
  { bytes: new Uint8Array([0xc0]), name: "C0" },
  { bytes: new Uint8Array([0xd8]), name: "D8" },
  { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), name: "PNG" },
  { bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]), name: "ZIP" },
  { bytes: new Uint8Array(randomBytes(4096)), name: "4KiB" },
];

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function joinedSources(dir: string): string {
  return collectTsFiles(dir)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

function mockTransport(): AthenaGatewayClient {
  const ok = async <T>() =>
    ({
      count: null,
      data: [],
      error: null,
      ok: true,
      raw: { data: [] },
      status: 200,
      statusText: "OK",
    }) as T;
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

function packageExports(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
    exports?: Record<string, unknown>;
  };
}

function storagePrincipal(rights: readonly string[]) {
  return normalizeAthenaPrincipal({
    authenticated: true,
    grants: [],
    rights: [...rights],
    userId: "user-storage-finality",
  });
}

function billingPrincipal(rights: readonly string[]) {
  return normalizeAthenaPrincipal({
    authenticated: true,
    grants: [],
    rights: [...rights],
    userId: "user-billing-finality",
  });
}

function cookie(token: string): string {
  return `${ATHENA_AUTH_SESSION_COOKIE_NAME}=${token}`;
}

function messageClass(
  code: string | undefined,
  message: string | undefined
): string {
  if (code && code.length > 0) {
    return code;
  }
  return (message ?? "").split(/[:\s]/)[0] ?? "";
}

function identityFromStorage(result: StorageObjectResult): ErrorIdentity {
  return {
    code: result.error?.code,
    errorNumber: result.error?.errorNumber,
    messageClass: messageClass(result.error?.code, result.error?.message),
    status: result.status,
  };
}

function identityFromThrown(error: unknown, status?: number): ErrorIdentity {
  const record =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const code = typeof record.code === "string" ? record.code : undefined;
  const errorNumber =
    typeof record.errorNumber === "number" ? record.errorNumber : undefined;
  const thrownStatus =
    typeof record.status === "number" ? record.status : status;
  const message = error instanceof Error ? error.message : String(error);
  return {
    code,
    errorNumber,
    messageClass: messageClass(code, message),
    status: thrownStatus,
  };
}

function identityFromHttpJson(
  json: {
    error?: { code?: string; errorNumber?: number; message?: string };
    status?: number;
  },
  responseStatus: number
): ErrorIdentity {
  return {
    code: json.error?.code,
    errorNumber: json.error?.errorNumber,
    messageClass: messageClass(json.error?.code, json.error?.message),
    status: json.status ?? responseStatus,
  };
}

function assertUint8Identity(
  actual: unknown,
  expected: Uint8Array,
  label: string
): void {
  assert.equal(
    actual instanceof Uint8Array,
    true,
    `${label} must be instanceof Uint8Array (got ${Object.prototype.toString.call(actual)})`
  );
  assert.deepEqual(
    actual,
    expected,
    `${label} bytes must deepEqual the original`
  );
}

function memoryProvider(): StorageObjectProvider & {
  calls: AuthorizedStorageOperation[];
} {
  const objects = new Map<
    string,
    {
      body: Uint8Array;
      contentType?: string;
      metadata?: Record<string, string>;
    }
  >();
  const calls: AuthorizedStorageOperation[] = [];
  return {
    calls,
    async execute(op) {
      calls.push(op);
      if (op.op === "put") {
        const key = op.key ?? "";
        objects.set(key, {
          body: op.body ? new Uint8Array(op.body) : new Uint8Array(),
          contentType: op.contentType,
          metadata: op.metadata,
        });
        return { data: { key }, ok: true, status: 200 };
      }
      if (op.op === "get" || op.op === "head") {
        const found = op.key ? objects.get(op.key) : undefined;
        if (!found) {
          return storageErrorResult(
            3005,
            "storage_file_not_found",
            "object missing",
            404
          );
        }
        if (op.op === "head") {
          return {
            data: {
              contentType: found.contentType,
              key: op.key,
              metadata: found.metadata,
            },
            ok: true,
            status: 200,
          };
        }
        return { data: new Uint8Array(found.body), ok: true, status: 200 };
      }
      if (op.op === "delete") {
        if (op.key) {
          objects.delete(op.key);
        }
        return { data: { key: op.key }, ok: true, status: 200 };
      }
      return {
        data: { cursor: op.cursor, objects: [], prefix: op.prefix },
        ok: true,
        status: 200,
      };
    },
  };
}

function failingProvider(result: StorageObjectResult): StorageObjectProvider {
  return {
    async execute() {
      return result;
    },
  };
}

function throwingProvider(message: string): StorageObjectProvider {
  return {
    async execute() {
      throw new Error(message);
    },
  };
}

function handlersForStorage(
  provider: StorageObjectProvider,
  rights: readonly string[] = ["storage.*"],
  security: "trusted" | "authenticated" = "authenticated"
) {
  const runtime = createStorageRuntime({ provider });
  const client = createClient({
    auth: false,
    databaseUrl:
      "postgresql://postgres@127.0.0.1:5432/athena_transport_finality",
    gatewayTransport: mockTransport(),
    storage: bindStorageRuntime(bindStorageProvider({}, provider), runtime),
  });
  return {
    client,
    handlers: createAthenaStorageHandlers({
      auth: {
        lookupSession: async (token) =>
          token === "sess_storage"
            ? {
                session: {
                  id: "session-storage",
                  userId: "user-storage-finality",
                },
                user: { id: "user-storage-finality", rights: [...rights] },
              }
            : null,
        mode: "athena-session",
      },
      client,
      discoveryDocument: STORAGE_DISCOVERY,
      security: { mode: security },
    }),
    runtime,
  };
}

function storageFetch(
  handlers: ReturnType<typeof createAthenaStorageHandlers>,
  headers: Record<string, string> = {}
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const merged = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    for (const [key, value] of Object.entries(headers)) {
      if (!merged.has(key)) {
        merged.set(key, value);
      }
    }
    if (!merged.has("origin")) {
      merged.set("origin", "http://localhost");
    }
    const request = new Request(url, {
      body: init?.body ?? (input instanceof Request ? input.body : undefined),
      headers: merged,
      method,
    });
    if (method === "GET") {
      return handlers.GET(request);
    }
    return handlers.POST(request);
  }) as typeof fetch;
}

async function postStorage(
  handlers: ReturnType<typeof createAthenaStorageHandlers>,
  operation: string,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<{ json: StorageObjectResult; response: Response }> {
  const response = await handlers.POST(
    new Request("http://localhost/api/athena/storage", {
      body: JSON.stringify({ operation, payload }),
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        ...headers,
      },
      method: "POST",
    })
  );
  const json = (await response.json()) as StorageObjectResult;
  return { json, response };
}

function mollieConfig() {
  return {
    mollie: {
      liveKey: "live_athena_transport_finality",
      sdk: FetchMollieSdk,
      testKey: "test_athena_transport_finality",
    },
  };
}

function createBillingServerClient() {
  return createClient({
    auth: false,
    billing: { mode: "local", providers: mollieConfig(), testMode: true },
    databaseUrl:
      "postgresql://postgres@127.0.0.1:5432/athena_transport_finality",
    gatewayTransport: mockTransport(),
  });
}

function billingHandlersFor(
  client: object,
  rights: readonly string[],
  token = "sess_bill"
) {
  return createAthenaBillingHandlers({
    auth: {
      lookupSession: async (sessionToken) =>
        sessionToken === token
          ? {
              session: { id: "session-bill", userId: "user-billing-finality" },
              user: { id: "user-billing-finality", rights: [...rights] },
            }
          : null,
      mode: "athena-session",
    },
    client,
    discoveryDocument: BILLING_DISCOVERY,
    security: { mode: "trusted" },
  });
}

function billingFetch(
  handlers: ReturnType<typeof createAthenaBillingHandlers>,
  headers: Record<string, string> = {}
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("api.mollie.com")) {
      return new Response("{}", { status: 404 });
    }
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const merged = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    for (const [key, value] of Object.entries(headers)) {
      if (!merged.has(key)) {
        merged.set(key, value);
      }
    }
    if (!merged.has("origin")) {
      merged.set("origin", "http://localhost");
    }
    const request = new Request(url, {
      body: init?.body ?? (input instanceof Request ? input.body : undefined),
      headers: merged,
      method,
    });
    if (method === "GET") {
      return handlers.GET(request);
    }
    return handlers.POST(request);
  }) as typeof fetch;
}

async function invokeEmbeddedBilling(
  handlers: ReturnType<typeof createAthenaBillingHandlers>,
  operation: string,
  payload: unknown
): Promise<unknown> {
  const http = await handlers.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({ operation, payload }),
      headers: {
        "content-type": "application/json",
        cookie: cookie("sess_bill"),
        origin: "http://localhost",
      },
      method: "POST",
    })
  );
  const json = (await http.json()) as {
    data?: unknown;
    error?: Record<string, unknown>;
    ok?: boolean;
    status?: number;
  };
  if (json.ok === false || http.status >= 400) {
    const nested = json.error ?? {};
    throw billingErrorFromTransport({
      ...nested,
      status:
        typeof json.status === "number"
          ? json.status
          : typeof nested.status === "number"
            ? nested.status
            : http.status,
    });
  }
  return json.data;
}

function embeddedBillingOperator(
  handlers: ReturnType<typeof createAthenaBillingHandlers>
) {
  const port = (prefix: string) =>
    new Proxy(
      {},
      {
        get(_target, method: string) {
          return (payload: unknown) =>
            invokeEmbeddedBilling(
              handlers,
              `${prefix}.${String(method)}`,
              payload
            );
        },
      }
    );
  return {
    customers: port("customers"),
    invoices: port("invoices"),
    paymentLinks: port("paymentLinks"),
    payments: port("payments"),
    refunds: port("refunds"),
    subscriptions: port("subscriptions"),
    webhooks: port("webhooks"),
  };
}

async function tryImport(
  relFromSrc: string
): Promise<Record<string, unknown> | null> {
  const absolute = join(srcRoot, relFromSrc);
  if (!existsSync(absolute)) {
    return null;
  }
  try {
    return (await import(
      new URL(`../../src/${relFromSrc.replace(/\\/g, "/")}`, import.meta.url)
        .href
    )) as Record<string, unknown>;
  } catch {
    return null;
  }
}

test("T-ST-UINT8: P?: browser Storage get returns Uint8Array identity for hostile bytes", async () => {
  const provider = memoryProvider();
  const { handlers, runtime } = handlersForStorage(provider);
  const principal = storagePrincipal(["storage.*"]);
  const browser = createBrowserStorageTransport({
    endpoints: { storage: "/api/athena/storage" },
    fetch: storageFetch(handlers, {
      cookie: cookie("sess_storage"),
    }),
    headers: { cookie: cookie("sess_storage") },
  });

  for (const vector of HOSTILE_BYTES) {
    const key = `hostile/${vector.name}.bin`;
    const put = await runtime.execute(
      {
        body: vector.bytes,
        contentType: "application/octet-stream",
        key,
        op: "put",
      },
      principal
    );
    assert.equal(put.ok, true, `${vector.name} direct put`);

    const direct = await runtime.execute({ key, op: "get" }, principal);
    assert.equal(direct.ok, true, `${vector.name} direct get ok`);
    assertUint8Identity(direct.data, vector.bytes, `direct ${vector.name}`);

    const browserResult = await browser.execute({
      key,
      op: "get",
      principal,
    });
    assert.equal(browserResult.ok, true, `${vector.name} browser get ok`);
    assertUint8Identity(
      browserResult.data,
      vector.bytes,
      `browser ${vector.name}`
    );
    assert.equal(
      isAthenaStorageBytesEnvelope(browserResult.data),
      false,
      `${vector.name} must not remain a tagged envelope`
    );
  }
});

test("T-ST-NESTED-REVIVE: P?: reviveAthenaStorageData recursively revives nested storage bytes", async () => {
  const inner = new Uint8Array([0x00, 0xff, 0x89, 0x50]);
  const envelope = encodeAthenaStorageBytes(inner);
  const nested = {
    body: envelope,
    items: [envelope, { payload: envelope }],
  };
  const revived = reviveAthenaStorageData(nested) as {
    body: unknown;
    items: [unknown, { payload: unknown }];
  };
  assertUint8Identity(revived.body, inner, "nested body");
  assertUint8Identity(revived.items[0], inner, "nested items[0]");
  assertUint8Identity(
    revived.items[1].payload,
    inner,
    "nested items[1].payload"
  );

  const browserSrc = readSrc("storage/runtime/browser-transport.ts");
  assert.match(browserSrc, /reviveAthenaStorageData/);
  assert.match(browserSrc, /storageOkResult\(\s*reviveAthenaStorageData\(/);

  const transport = createBrowserStorageTransport({
    endpoints: { storage: "/api/athena/storage" },
    fetch: async () =>
      Response.json({
        data: nested,
        ok: true,
        status: 200,
      }),
  });
  const result = await transport.execute({
    key: "nested.bin",
    op: "get",
    principal: storagePrincipal(["storage.get"]),
  });
  assert.equal(result.ok, true);
  const data = result.data as {
    body: unknown;
    items: [unknown, { payload: unknown }];
  };
  assertUint8Identity(data.body, inner, "browser nested body");
  assertUint8Identity(data.items[0], inner, "browser nested items[0]");
  assertUint8Identity(data.items[1].payload, inner, "browser nested payload");
});

test("T-ST-CODEC-SSOT: P?: Storage HTTP uses one bytes envelope codec", () => {
  const browserSrc = readSrc("storage/runtime/browser-transport.ts");
  assert.equal(/function bytesToBase64\(/.test(browserSrc), false);
  assert.equal(/\bbtoa\(/.test(browserSrc), false);
  assert.match(browserSrc, /encodeAthenaStorageBytes/);
  assert.match(browserSrc, /reviveAthenaStorageData/);
  assert.match(browserSrc, /bytes-envelope/);

  const ssot = readSrc("storage/runtime/bytes-envelope.ts");
  assert.match(ssot, /export function encodeAthenaStorageBytes/);
  assert.match(ssot, /export function decodeAthenaStorageBytes/);
  assert.match(ssot, /export function serializeAthenaStorageData/);
  assert.match(ssot, /export function reviveAthenaStorageData/);

  const runtimeDir = join(srcRoot, "storage", "runtime");
  for (const file of collectTsFiles(runtimeDir)) {
    if (
      file.endsWith(`${join("runtime", "bytes-envelope.ts")}`) ||
      file.endsWith("bytes-envelope.ts")
    ) {
      continue;
    }
    const src = readFileSync(file, "utf8");
    assert.equal(
      /function bytesToBase64\(/.test(src),
      false,
      `second Storage base64 dialect in ${file}`
    );
    assert.equal(/\bbtoa\(/.test(src), false, `btoa dialect in ${file}`);
  }
});

test("T-ST-PUT-ENVELOPE: P?: browser Storage put body is encodeAthenaStorageBytes envelope", async () => {
  const posts: unknown[] = [];
  const expected = new Uint8Array([1, 2, 3]);
  const transport = createBrowserStorageTransport({
    endpoints: { storage: "/api/athena/storage" },
    fetch: async (_input, init) => {
      posts.push(JSON.parse(String(init?.body ?? "{}")));
      return Response.json({ data: { key: "k.bin" }, ok: true, status: 200 });
    },
  });
  await transport.execute({
    body: expected,
    contentType: "application/octet-stream",
    key: "k.bin",
    op: "put",
    principal: storagePrincipal(["storage.put"]),
  });
  const envelope = posts[0] as {
    operation?: string;
    payload?: { body?: unknown };
  };
  assert.equal(envelope.operation, "put");
  assert.equal(isAthenaStorageBytesEnvelope(envelope.payload?.body), true);
  assert.deepEqual(envelope.payload?.body, encodeAthenaStorageBytes(expected));
  assert.equal(typeof envelope.payload?.body === "string", false);

  const legacy = decodeAthenaStorageRequestBody("AQID");
  assert.deepEqual(legacy, expected);
});

test("T-ST-FIELD-PARITY: P?: Storage HTTP forwards key body contentType metadata prefix cursor limit", async () => {
  const provider = memoryProvider();
  const { handlers } = handlersForStorage(provider);
  const principal = storagePrincipal(["storage.*"]);
  const browser = createBrowserStorageTransport({
    endpoints: { storage: "/api/athena/storage" },
    fetch: storageFetch(handlers, { cookie: cookie("sess_storage") }),
    headers: { cookie: cookie("sess_storage") },
  });

  await browser.execute({
    key: "doc.txt",
    op: "get",
    principal,
  });
  await browser.execute({
    key: "doc.txt",
    op: "head",
    principal,
  });
  await browser.execute({
    key: "doc.txt",
    op: "delete",
    principal,
  });
  const body = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  await browser.execute({
    body,
    contentType: "image/png",
    key: "a.png",
    metadata: { k: "v" },
    op: "put",
    principal,
  });
  await browser.execute({
    cursor: "after-1",
    limit: 25,
    op: "list",
    prefix: "docs/",
    principal,
  });

  const byOp = Object.fromEntries(
    provider.calls.map((call) => [call.op, call])
  );
  assert.equal(byOp.get?.key, "doc.txt");
  assert.equal(byOp.head?.key, "doc.txt");
  assert.equal(byOp.delete?.key, "doc.txt");
  assert.equal(byOp.put?.key, "a.png");
  assert.equal(byOp.put?.contentType, "image/png");
  assert.deepEqual(byOp.put?.metadata, { k: "v" });
  assert.equal(byOp.put?.body instanceof Uint8Array, true);
  assert.deepEqual(byOp.put?.body, body);
  assert.equal(byOp.list?.prefix, "docs/");
  assert.equal(byOp.list?.cursor, "after-1");
  assert.equal(byOp.list?.limit, 25);
});

test("T-ST-ERROR-IDENTITY: P?: Storage error identity is identical Direct HTTP Browser", async () => {
  const principal = storagePrincipal(["storage.*"]);

  async function compare(input: {
    browserHeaders?: Record<string, string>;
    browserOp?: AuthorizedStorageOperation;
    direct?: () => Promise<StorageObjectResult>;
    handlers: ReturnType<typeof createAthenaStorageHandlers>;
    http: () => Promise<{ json: StorageObjectResult; response: Response }>;
    label: string;
    runtime?: StorageRuntime;
  }) {
    const browserHeaders = input.browserHeaders ?? {
      cookie: cookie("sess_storage"),
    };
    const http = await input.http();
    const httpIdentity = identityFromHttpJson(http.json, http.response.status);
    const browser = createBrowserStorageTransport({
      endpoints: { storage: "/api/athena/storage" },
      fetch: storageFetch(input.handlers, browserHeaders),
      headers: browserHeaders,
    });
    const browserResult = await browser.execute(
      input.browserOp ?? {
        key: "missing.bin",
        op: "get",
        principal,
      }
    );
    const browserIdentity = identityFromStorage(browserResult);
    assert.deepEqual(
      browserIdentity,
      httpIdentity,
      `${input.label} Browser != HTTP`
    );
    if (input.direct) {
      const direct = await input.direct();
      assert.deepEqual(
        identityFromStorage(direct),
        httpIdentity,
        `${input.label} Direct != HTTP`
      );
    }
  }

  {
    const { handlers, runtime } = handlersForStorage(memoryProvider());
    await compare({
      browserOp: {
        key: "",
        op: "get",
        principal,
      },
      direct: () => runtime.execute({ key: "", op: "get" }, principal),
      handlers,
      http: () =>
        postStorage(
          handlers,
          "get",
          { key: "" },
          {
            cookie: cookie("sess_storage"),
          }
        ),
      label: "invalid request",
    });
    const invalidHttp = await postStorage(
      handlers,
      "not-an-op",
      { key: "x" },
      { cookie: cookie("sess_storage") }
    );
    assert.equal(invalidHttp.json.error?.code, "storage_invalid_request");
    assert.equal(invalidHttp.json.error?.errorNumber, 3000);
    assert.equal(invalidHttp.response.status, 400);
  }

  {
    const { handlers } = handlersForStorage(memoryProvider());
    const anonymous = normalizeAthenaPrincipal({
      authenticated: false,
      grants: [],
      rights: [],
      userId: "",
    });
    await compare({
      browserHeaders: {},
      browserOp: {
        key: "secret.bin",
        op: "get",
        principal: anonymous,
      },
      direct: () =>
        createStorageRuntime({ provider: memoryProvider() }).execute(
          { key: "secret.bin", op: "get" },
          anonymous
        ),
      handlers,
      http: () => postStorage(handlers, "get", { key: "secret.bin" }),
      label: "unauthenticated",
    });
  }

  {
    const deniedHandlers = handlersForStorage(memoryProvider(), [
      "storage.put",
    ]).handlers;
    await compare({
      browserOp: {
        key: "denied.bin",
        op: "get",
        principal: storagePrincipal(["storage.put"]),
      },
      direct: () =>
        createStorageRuntime({ provider: memoryProvider() }).execute(
          { key: "denied.bin", op: "get" },
          storagePrincipal(["storage.put"])
        ),
      handlers: deniedHandlers,
      http: () =>
        postStorage(
          deniedHandlers,
          "get",
          { key: "denied.bin" },
          {
            cookie: cookie("sess_storage"),
          }
        ),
      label: "authorization denied",
    });
    const denied = await postStorage(
      deniedHandlers,
      "get",
      { key: "denied.bin" },
      {
        cookie: cookie("sess_storage"),
      }
    );
    assert.equal(denied.json.error?.code, "storage_authorization_denied");
    assert.equal(denied.json.error?.errorNumber, 3003);
    assert.equal(denied.response.status, 403);
  }

  {
    const { handlers, runtime } = handlersForStorage(memoryProvider());
    await compare({
      direct: () =>
        runtime.execute({ key: "missing.bin", op: "get" }, principal),
      handlers,
      http: () =>
        postStorage(
          handlers,
          "get",
          { key: "missing.bin" },
          {
            cookie: cookie("sess_storage"),
          }
        ),
      label: "not found",
    });
    const missing = await postStorage(
      handlers,
      "get",
      { key: "missing.bin" },
      {
        cookie: cookie("sess_storage"),
      }
    );
    assert.equal(missing.json.error?.code, "storage_file_not_found");
    assert.equal(missing.json.error?.errorNumber, 3005);
    assert.equal(missing.response.status, 404);
  }

  {
    const client = createClient({
      auth: false,
      databaseUrl:
        "postgresql://postgres@127.0.0.1:5432/athena_transport_finality",
      gatewayTransport: mockTransport(),
    });
    const handlers = createAthenaStorageHandlers({
      auth: {
        lookupSession: async () => ({
          session: { id: "s", userId: "user-storage-finality" },
          user: { id: "user-storage-finality", rights: ["storage.*"] },
        }),
        mode: "athena-session",
      },
      client,
      discoveryDocument: STORAGE_DISCOVERY,
      security: { mode: "trusted" },
    });
    await compare({
      handlers,
      http: () =>
        postStorage(
          handlers,
          "get",
          { key: "x.bin" },
          {
            cookie: cookie("sess_storage"),
          }
        ),
      label: "provider unavailable",
    });
    const unavailable = await postStorage(
      handlers,
      "get",
      { key: "x.bin" },
      {
        cookie: cookie("sess_storage"),
      }
    );
    assert.equal(unavailable.json.error?.code, "storage_unavailable");
    assert.equal(unavailable.json.error?.errorNumber, 3007);
    assert.equal(unavailable.response.status, 503);
  }

  {
    const { handlers, runtime } = handlersForStorage(
      throwingProvider("disk exploded")
    );
    await compare({
      direct: () => runtime.execute({ key: "boom.bin", op: "get" }, principal),
      handlers,
      http: () =>
        postStorage(
          handlers,
          "get",
          { key: "boom.bin" },
          {
            cookie: cookie("sess_storage"),
          }
        ),
      label: "provider / internal failure",
    });
    const internal = await postStorage(
      handlers,
      "get",
      { key: "boom.bin" },
      {
        cookie: cookie("sess_storage"),
      }
    );
    assert.equal(internal.json.error?.code, "storage_internal");
    assert.equal(internal.json.error?.errorNumber, 3010);
    assert.equal(internal.response.status, 500);
  }

  const browserSrc = readSrc("storage/runtime/browser-transport.ts");
  assert.match(browserSrc, /json\?\.error\?\.code/);
});

test("T-ST-NO-CTOR: P?: createStorageClient is not a package export", async () => {
  const mod = await import("../../src/index.ts");
  assert.equal("createStorageClient" in mod, false);
  assert.equal(packageExports()["./storage-client"], undefined);
  assert.equal(packageExports()["./nucleus"], undefined);
});

test("T-ST-STRUCTURED-ERROR: P?: Storage facade throws AthenaStorageError with code errorNumber status", async () => {
  const runtime: StorageRuntime = {
    async execute() {
      return storageErrorResult(
        3005,
        "storage_file_not_found",
        "object missing",
        404
      );
    },
    provider: failingProvider(
      storageErrorResult(3005, "storage_file_not_found", "object missing", 404)
    ),
  };
  const wrapped = wrapStorageModuleWithRuntime(
    {
      file: {
        get: async () => null,
      },
    },
    runtime
  );
  await assert.rejects(
    () => wrapped.file.get({ key: "missing.bin" }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "AthenaStorageError");
      const record = error as Error & {
        code?: string;
        details?: unknown;
        errorNumber?: number;
        status?: number;
      };
      assert.equal(record.code, "storage_file_not_found");
      assert.equal(record.errorNumber, 3005);
      assert.equal(record.status, 404);
      assert.equal(record.code === "HTTP_ERROR", false);
      assert.equal(record.code === "INVALID_JSON", false);
      return true;
    }
  );
});

test("T-ST-NO-GENERIC-OVERLAY: P?: storage overlays do not throw new Error for runtime results", () => {
  const overlays = readSrc("storage/runtime/overlays.ts");
  assert.equal(
    /throw new Error\(result\.error\?\.message/.test(overlays),
    false
  );
  assert.match(overlays, /AthenaStorageError/);
});

test("T-BIL-TRANSLATOR: P?: billingErrorFromTransport preserves Mollie and domain error identity", async () => {
  const browserSrc = readSrc("billing/runtime/browser-transport.ts");
  assert.match(browserSrc, /billingErrorFromTransport/);
  assert.equal(/throw new Error\(/.test(browserSrc), false);

  const httpError = await tryImport("billing/runtime/http-error.ts");
  assert.ok(
    httpError,
    "src/billing/runtime/http-error.ts must export billingErrorFromTransport"
  );
  const billingErrorFromTransport = httpError.billingErrorFromTransport as (
    envelope: Record<string, unknown>
  ) => Error;
  assert.equal(typeof billingErrorFromTransport, "function");

  const denied = billingErrorFromTransport({
    code: ATHENA_BILLING_AUTHORIZATION_DENIED,
    errorNumber: 4014,
    message: "payment failed",
    missing: ["billing.payments.write"],
    status: 403,
  });
  assert.equal(denied instanceof AthenaBillingAuthorizationError, true);
  assert.equal(
    (denied as AthenaBillingAuthorizationError).code,
    ATHENA_BILLING_AUTHORIZATION_DENIED
  );
  assert.equal((denied as AthenaBillingAuthorizationError).errorNumber, 4014);
  assert.equal((denied as AthenaBillingAuthorizationError).status, 403);

  const capability = billingErrorFromTransport({
    code: "ATHENA_BILLING_OPERATION_UNAVAILABLE",
    message: "unsupported",
    reason: "unsupported_operation",
    status: 400,
  });
  assert.equal(capability instanceof AthenaBillingCapabilityError, true);

  const mollieKinds = [
    "authentication",
    "invalid_request",
    "not_found",
    "conflict",
    "rate_limited",
    "provider_unavailable",
  ] as const;
  for (const kind of mollieKinds) {
    const mapped = billingErrorFromTransport({
      code: "ATHENA_BILLING_PROVIDER_REQUEST",
      kind,
      message: `mollie ${kind}`,
      provider: "mollie",
      retry: kind === "not_found" || kind === "conflict" ? "never" : "safe",
      status: kind === "not_found" ? 404 : 400,
    });
    assert.equal(
      mapped instanceof AthenaBillingProviderRequestError,
      true,
      `kind ${kind}`
    );
    assert.equal((mapped as AthenaBillingProviderRequestError).kind, kind);
  }

  const webhook = billingErrorFromTransport({
    code: "ATHENA_BILLING_WEBHOOK_SIGNATURE_INVALID",
    kind: "signature_invalid",
    message: "webhook verification failed",
    provider: "mollie",
    status: 400,
  });
  assert.equal(webhook instanceof Error, true);
  assert.equal((webhook as { kind?: string }).kind, "signature_invalid");

  const client = createBillingServerClient();
  const handlers = billingHandlersFor(client, ["billing.payments.read"]);
  await assert.rejects(
    () =>
      invokeEmbeddedBilling(handlers, "payments.create", {
        amount: { currency: "EUR", value: "10.00" },
        description: "Order",
        idempotencyKey: "idem-1",
        redirectUrl: "https://example.com/return",
      }),
    (error: unknown) => {
      assert.equal(error instanceof AthenaBillingAuthorizationError, true);
      assert.equal(
        (error as AthenaBillingAuthorizationError).code,
        ATHENA_BILLING_AUTHORIZATION_DENIED
      );
      assert.equal(
        (error as AthenaBillingAuthorizationError).errorNumber,
        4014
      );
      assert.equal((error as Error).message === "payment failed", false);
      return true;
    }
  );
});

test("T-BIL-ENVELOPE: P?: Billing HTTP freezes omitted null object list data shapes", async () => {
  const transport = createBrowserBillingTransport({
    endpoints: { billing: "/api/athena/billing" },
    fetch: async () => Response.json({ ok: true, status: 200 }),
  });
  assert.equal(await transport.catalog.products.list({}), undefined);

  const nullTransport = createBrowserBillingTransport({
    endpoints: { billing: "/api/athena/billing" },
    fetch: async () => Response.json({ data: null, ok: true, status: 200 }),
  });
  assert.equal(await nullTransport.catalog.products.list({}), null);

  const objectTransport = createBrowserBillingTransport({
    endpoints: { billing: "/api/athena/billing" },
    fetch: async () => Response.json({ data: {}, ok: true, status: 200 }),
  });
  assert.deepEqual(await objectTransport.catalog.products.list({}), {});

  const listTransport = createBrowserBillingTransport({
    endpoints: { billing: "/api/athena/billing" },
    fetch: async () => Response.json({ data: [], ok: true, status: 200 }),
  });
  assert.deepEqual(await listTransport.catalog.products.list({}), []);

  const rawTransport = createBrowserBillingTransport({
    endpoints: { billing: "/api/athena/billing" },
    fetch: async () => Response.json({ id: "tr_raw" }),
  });
  const raw = await rawTransport.catalog.products.list({});
  assert.equal(raw, undefined);

  const remoteSrc = readSrc("billing/runtime/remote/transport.ts");
  assert.match(remoteSrc, /parseEnvelopeData/);
  assert.match(remoteSrc, /"data" in body/);
  const browserSrc = readSrc("billing/runtime/browser-transport.ts");
  assert.equal(browserSrc.includes("parseEnvelopeData"), false);
});

test("T-BIL-RIGHTS: P?: requiredBillingRight allow deny is identical Direct and HTTP", async () => {
  const operations = Object.keys(
    BILLING_OPERATION_RIGHTS
  ) as BillingOperation[];
  const client = createBillingServerClient();
  const internals = getAthenaClientInternals(client);
  assert.ok(internals?.billingRuntime);

  const handlerSrc = readSrc("next/billing-handlers.ts");
  assert.equal(handlerSrc.includes("missingRequiredRights"), false);
  assert.equal(handlerSrc.includes("authorizeBillingOperation"), false);

  for (const operation of operations) {
    const required = requiredBillingRights(operation);
    assert.ok(required.length >= 1, operation);
    const allowRights = required.map((key) => String(key));
    const sibling = String(required[0]).endsWith(".write")
      ? String(required[0]).replace(/\.write$/, ".read")
      : String(required[0]).replace(/\.read$/, ".write");
    const denyRights = sibling === String(required[0]) ? [] : [sibling];

    const allowPrincipal = billingPrincipal(allowRights);
    const denyPrincipal = billingPrincipal(denyRights);

    const allowDirect = authorizeBillingOperation(allowPrincipal, operation);
    const denyDirect = authorizeBillingOperation(denyPrincipal, operation);
    assert.equal(allowDirect, undefined, `${operation} allow`);
    assert.ok(denyDirect, `${operation} deny`);
    assert.equal(denyDirect?.code, ATHENA_BILLING_AUTHORIZATION_DENIED);
    assert.equal(denyDirect?.errorNumber, 4014);
    assert.equal(denyDirect?.status, 403);

    if (operation !== "payments.create" && operation !== "payments.get") {
      continue;
    }
    const handlers = billingHandlersFor(client, denyRights);
    const http = await handlers.POST(
      new Request("http://localhost/api/athena/billing", {
        body: JSON.stringify({
          operation,
          payload:
            operation === "payments.create"
              ? {
                  amount: { currency: "EUR", value: "10.00" },
                  description: "Order",
                  idempotencyKey: "idem-rights",
                  redirectUrl: "https://example.com/return",
                }
              : { id: "tr_1" },
        }),
        headers: {
          "content-type": "application/json",
          cookie: cookie("sess_bill"),
          origin: "http://localhost",
          "x-rights": "billing.payments.write",
        },
        method: "POST",
      })
    );
    const json = (await http.json()) as { error?: { code?: string } };
    assert.equal(http.status, 403, operation);
    assert.equal(
      json.error?.code,
      ATHENA_BILLING_AUTHORIZATION_DENIED,
      operation
    );

    await assert.rejects(
      () =>
        internals.billingRuntime?.execute(
          operation,
          operation === "payments.create"
            ? {
                amount: { currency: "EUR", value: "10.00" },
                description: "Order",
                idempotencyKey: "idem-rights",
                redirectUrl: "https://example.com/return",
              }
            : { id: "tr_1" },
          denyPrincipal
        ),
      AthenaBillingAuthorizationError
    );
  }
});

test("T-BIL-CONTRACT: P?: Direct vs browser Billing contract holds for customers payments refunds subscriptions payment links sales invoices webhooks", async () => {
  const client = createBillingServerClient();
  const internals = getAthenaClientInternals(client);
  assert.ok(internals?.billingRuntime);
  const rights = [
    "billing.customers.read",
    "billing.customers.write",
    "billing.payments.read",
    "billing.payments.write",
    "billing.refunds.read",
    "billing.refunds.write",
    "billing.subscriptions.read",
    "billing.subscriptions.write",
    "billing.payment-links.read",
    "billing.payment-links.write",
    "billing.sales-invoices.read",
    "billing.webhooks.read",
    "billing.webhooks.write",
  ];
  const handlers = billingHandlersFor(client, rights);
  const browser = createBrowserBillingTransport({
    endpoints: { billing: "/api/athena/billing" },
    fetch: billingFetch(handlers, { cookie: cookie("sess_bill") }),
    headers: { cookie: cookie("sess_bill") },
  });
  const operator = embeddedBillingOperator(handlers);
  assert.equal("webhooks" in browser, false);
  assert.equal("payments" in browser, false);
  assert.equal(typeof browser.catalog.products.list, "function");
  assert.equal(typeof operator.webhooks.list, "function");

  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("api.mollie.com")) {
      const path = new URL(url).pathname;
      const idFrom = (prefix: string) =>
        path.split(prefix)[1]?.split("/")[0] ?? "id";
      if (path.includes("/v2/payments") && (init?.method ?? "GET") === "GET") {
        return Response.json({
          amount: { currency: "EUR", value: "10.00" },
          id: "tr_contract",
          resource: "payment",
          status: "open",
        });
      }
      if (path.includes("/v2/customers")) {
        return Response.json({
          email: "a@example.com",
          id: "cst_contract",
          resource: "customer",
        });
      }
      if (path.includes("/refunds")) {
        return Response.json({
          amount: { currency: "EUR", value: "1.00" },
          id: "re_contract",
          resource: "refund",
        });
      }
      if (path.includes("/subscriptions")) {
        return Response.json({
          id: "sub_contract",
          resource: "subscription",
          status: "active",
        });
      }
      if (path.includes("/payment-links")) {
        return Response.json({
          id: "pl_contract",
          resource: "payment-link",
        });
      }
      if (path.includes("/sales-invoices")) {
        return Response.json({
          id: "inv_contract",
          resource: "sales-invoice",
        });
      }
      if (path.includes("/wallets") || path.includes("/webhooks")) {
        return Response.json({
          id: "wh_contract",
          resource: "webhook",
          url: "https://example.com/hook",
        });
      }
      if ((init?.method ?? "GET").toUpperCase() === "POST") {
        return Response.json(
          {
            amount: { currency: "EUR", value: "10.00" },
            description: "Order",
            id: `created_${idFrom("/v2/")}`,
            resource: "payment",
            status: "open",
          },
          { status: 201 }
        );
      }
      return Response.json({ id: "x", resource: "unknown" });
    }
    return billingFetch(handlers, { cookie: cookie("sess_bill") })(input, init);
  }) as typeof fetch;

  try {
    const principal = billingPrincipal(rights);
    const pairs: Array<{
      direct: () => Promise<unknown>;
      httpOp: string;
      httpPayload: Record<string, unknown>;
      browser: () => Promise<unknown>;
      label: string;
    }> = [
      {
        browser: () => operator.customers.get({ id: "cst_contract" }),
        direct: () =>
          internals.billingRuntime.execute(
            "customers.get",
            { id: "cst_contract" },
            principal
          ),
        httpOp: "customers.get",
        httpPayload: { id: "cst_contract" },
        label: "customers",
      },
      {
        browser: () => operator.payments.get({ id: "tr_contract" }),
        direct: () =>
          internals.billingRuntime.execute(
            "payments.get",
            { id: "tr_contract" },
            principal
          ),
        httpOp: "payments.get",
        httpPayload: { id: "tr_contract" },
        label: "payments",
      },
      {
        browser: () =>
          operator.refunds.get({
            paymentId: "tr_contract",
            refundId: "re_contract",
          }),
        direct: () =>
          internals.billingRuntime.execute(
            "refunds.get",
            { paymentId: "tr_contract", refundId: "re_contract" },
            principal
          ),
        httpOp: "refunds.get",
        httpPayload: { paymentId: "tr_contract", refundId: "re_contract" },
        label: "refunds",
      },
      {
        browser: () =>
          operator.subscriptions.get({
            customerId: "cst_contract",
            subscriptionId: "sub_contract",
          }),
        direct: () =>
          internals.billingRuntime.execute(
            "subscriptions.get",
            {
              customerId: "cst_contract",
              subscriptionId: "sub_contract",
            },
            principal
          ),
        httpOp: "subscriptions.get",
        httpPayload: {
          customerId: "cst_contract",
          subscriptionId: "sub_contract",
        },
        label: "subscriptions",
      },
      {
        browser: () => operator.paymentLinks.get({ id: "pl_contract" }),
        direct: () =>
          internals.billingRuntime.execute(
            "paymentLinks.get",
            { id: "pl_contract" },
            principal
          ),
        httpOp: "paymentLinks.get",
        httpPayload: { id: "pl_contract" },
        label: "payment links",
      },
      {
        browser: () => operator.invoices.get({ invoiceId: "inv_contract" }),
        direct: () =>
          internals.billingRuntime.execute(
            "invoices.get",
            { invoiceId: "inv_contract" },
            principal
          ),
        httpOp: "invoices.get",
        httpPayload: { invoiceId: "inv_contract" },
        label: "sales invoices",
      },
      {
        browser: () => operator.webhooks.list({}),
        direct: () =>
          internals.billingRuntime.execute("webhooks.list", {}, principal),
        httpOp: "webhooks.list",
        httpPayload: {},
        label: "webhooks",
      },
    ];

    for (const pair of pairs) {
      const http = await handlers.POST(
        new Request("http://localhost/api/athena/billing", {
          body: JSON.stringify({
            operation: pair.httpOp,
            payload: pair.httpPayload,
          }),
          headers: {
            "content-type": "application/json",
            cookie: cookie("sess_bill"),
            origin: "http://localhost",
          },
          method: "POST",
        })
      );
      const httpJson = (await http.json()) as {
        data?: unknown;
        error?: unknown;
        ok?: boolean;
      };
      let directValue: unknown;
      let directError: unknown;
      try {
        directValue = await pair.direct();
      } catch (error) {
        directError = error;
      }
      let browserValue: unknown;
      let browserError: unknown;
      try {
        browserValue = await pair.browser();
      } catch (error) {
        browserError = error;
      }
      if (directError) {
        assert.ok(httpJson.ok === false || http.status >= 400, pair.label);
        assert.ok(
          browserError,
          `${pair.label} browser must throw when Direct throws`
        );
        assert.deepEqual(
          identityFromThrown(browserError, http.status),
          identityFromThrown(directError, http.status),
          `${pair.label} error identity`
        );
      } else {
        assert.equal(httpJson.ok, true, pair.label);
        assert.deepEqual(httpJson.data, directValue, `${pair.label} HTTP data`);
        assert.deepEqual(
          browserValue,
          directValue,
          `${pair.label} browser data`
        );
        assert.equal(browserError, undefined, pair.label);
      }
    }
  } finally {
    globalThis.fetch = previous;
  }
});

test("T-BIL-THIN-HTTP: P?: Billing HTTP does not own prepareBillingCommand Rights or Mollie SDK", () => {
  const handlerSrc = readSrc("next/billing-handlers.ts");
  const browserSrc = readSrc("billing/runtime/browser-transport.ts");
  assert.equal(handlerSrc.includes("prepareBillingCommand"), false);
  assert.equal(handlerSrc.includes("createOfficialMollieAdapter"), false);
  assert.equal(handlerSrc.includes("missingRequiredRights"), false);
  assert.equal(browserSrc.includes("prepareBillingCommand"), false);
  assert.equal(browserSrc.includes("createOfficialMollieAdapter"), false);
  assert.equal(browserSrc.includes("missingRequiredRights"), false);
});

test("T-BIL-NO-KIND-SAFE: P?: B-MOLLIE-KIND-SAFE remains uninverted", () => {
  const mollieBaseline = readFileSync(
    join(here, "athena-js-mollie.baseline.test.ts"),
    "utf8"
  );
  assert.match(mollieBaseline, /B-MOLLIE-FETCH-HELPER/);
  assert.equal(
    mollieBaseline.includes("billingRetryDispositionForKind"),
    false
  );
  const financial = readFileSync(
    join(here, "athena-js-billing-financial-safety.target.test.ts"),
    "utf8"
  );
  assert.match(
    financial,
    /billingRetryDispositionForKind cannot be reintroduced/
  );
  assert.doesNotMatch(
    joinedSources(join(srcRoot, "billing")),
    /\bbillingRetryDispositionForKind\b/
  );
  assert.throws(() =>
    prepareBillingCommand({
      operation: "payments.create",
      payload: {
        amount: { currency: "EUR", value: "10.00" },
        description: "Order",
        redirectUrl: "https://example.com/return",
      },
      testMode: true,
    })
  );
});

test("T-BIL-NO-CTOR: P?: createBillingClient is not a package export", async () => {
  const mod = await import("../../src/index.ts");
  assert.equal("createBillingClient" in mod, false);
  assert.equal("createPrincipalClient" in mod, false);
  assert.equal(packageExports()["./billing-client"], undefined);
  assert.equal(packageExports()["./authority"], undefined);
  assert.equal(packageExports()["./transport"], undefined);
});

test("T-TR-FACTORY: P?: createAthenaHttpTransportIR sets credentials from origin class", async () => {
  const mod =
    (await tryImport("runtime/transport/http.ts")) ??
    (await tryImport("runtime/transport/index.ts"));
  assert.ok(
    mod,
    "createAthenaHttpTransportIR must exist under src/runtime/transport"
  );
  const createAthenaHttpTransportIR =
    mod.createAthenaHttpTransportIR as (input: {
      basePath: string;
      domain: string;
      origin: string;
    }) => {
      credentials: string;
      domain: string;
      kind: string;
      version: number;
    };
  assert.equal(typeof createAthenaHttpTransportIR, "function");
  const sameOrigin = createAthenaHttpTransportIR({
    basePath: "/api/athena/storage",
    domain: "storage",
    origin: "same-origin",
  });
  assert.equal(sameOrigin.kind, "http");
  assert.equal(sameOrigin.version, 1);
  assert.equal(sameOrigin.credentials, "same-origin");
  assert.equal(sameOrigin.domain, "storage");

  const remote = createAthenaHttpTransportIR({
    basePath: "https://files.example.com/api/athena/storage",
    domain: "storage",
    origin: "remote",
  });
  assert.equal(remote.credentials, "none");

  const absolute = createAthenaHttpTransportIR({
    basePath: "https://pay.example.com/api/athena/billing",
    domain: "billing",
    origin: "absolute",
  });
  assert.equal(absolute.credentials, "none");
});

test("T-TR-VALIDATE: P?: validateAthenaTransportIR rejects domain topology mismatch", async () => {
  const mod =
    (await tryImport("runtime/transport/http.ts")) ??
    (await tryImport("runtime/transport/index.ts"));
  assert.ok(mod, "validateAthenaTransportIR must exist");
  const validateAthenaTransportIR = mod.validateAthenaTransportIR as (
    ir: unknown
  ) => unknown;
  assert.equal(typeof validateAthenaTransportIR, "function");

  const valid = {
    basePath: "/api/athena/storage",
    credentials: "same-origin",
    domain: "storage",
    encoding: "json",
    kind: "http",
    origin: "same-origin",
    version: 1,
  };
  assert.doesNotThrow(() => validateAthenaTransportIR(valid));

  assert.throws(() =>
    validateAthenaTransportIR({
      ...valid,
      domain: "billing",
    })
  );

  const malformed = {
    ...parseAthenaRuntimeDiscoveryDocument({
      athena: true,
      capabilities: STORAGE_DISCOVERY.capabilities,
      endpoints: STORAGE_DISCOVERY.endpoints,
      protocol: { major: 1, minor: 2 },
      runtime: "next-local",
      runtimeImplementation: "athena-js",
      topology: {
        transports: {
          storage: { domain: "billing", kind: "http" },
        },
      },
    }),
  };
  assert.equal(
    malformed === null ||
      (malformed as { topology?: unknown }).topology == null,
    false
  );
  assert.throws(() =>
    validateAthenaTransportIR({
      basePath: "/api/athena/storage",
      credentials: "same-origin",
      domain: "billing",
      encoding: "json",
      kind: "http",
      origin: "same-origin",
      version: 1,
    })
  );
});

test("T-TR-PARSER-BOUNDARY: P?: discovery HTTP transport stays distinct from Transport IR", async () => {
  const blob = joinedSources(srcRoot);
  assert.match(blob, /AthenaRuntimeDiscoveryHttpTransport/);
  assert.match(blob, /AthenaHttpTransportIR/);
  assert.equal(
    blob.includes(
      "type AthenaHttpTransportIR = AthenaRuntimeDiscoveryHttpTransport"
    ),
    false
  );
  const irMod =
    (await tryImport("runtime/transport/http.ts")) ??
    (await tryImport("runtime/transport/index.ts"));
  assert.ok(irMod);
  const sample = JSON.stringify(irMod);
  assert.equal(sample.includes('"omit"'), false);
  assert.equal(sample.includes('"include"'), false);
});

test("T-TR-INTERNAL: P?: Transport IR never contains principal Rights Policy provider secrets or business rules", () => {
  const transportDir = join(srcRoot, "runtime", "transport");
  assert.equal(existsSync(transportDir), true);
  const blob = joinedSources(transportDir);
  assert.equal(blob.includes("AthenaPrincipal"), false);
  assert.equal(/\brights\b/.test(blob), false);
  assert.equal(/\bgrants\b/.test(blob), false);
  assert.equal(blob.includes("prepareBillingCommand"), false);
  assert.equal(blob.includes("missingRequiredRights"), false);
  assert.equal(blob.includes("liveKey"), false);
  assert.equal(blob.includes("secretAccessKey"), false);
  assert.equal(blob.includes("postgresql://"), false);
  assert.equal(packageExports()["./transport"], undefined);
});

test("T-TR-ONE-EXECUTOR: P?: Storage and Billing share one HTTP executor", () => {
  const storage = readSrc("storage/runtime/browser-transport.ts");
  const billing = readSrc("billing/runtime/browser-transport.ts");
  assert.match(storage, /runtime\/transport/);
  assert.match(billing, /runtime\/transport/);
  assert.equal(/function joinPath\(/.test(storage), false);
  assert.equal(/function joinPath\(/.test(billing), false);
  assert.equal(
    /const fetchImpl = options\?\.fetch \?\? fetch/.test(storage),
    false
  );
  assert.equal(
    /const fetchImpl = options\?\.fetch \?\? fetch/.test(billing),
    false
  );
  assert.equal(
    /method: "GET"/.test(storage) && /credentials: "same-origin"/.test(storage),
    false
  );
});

test("T-TR-PROTOCOL: P?: protocol 1.1 remains compatible and 1.2 topology is authoritative", () => {
  assert.equal(isCompatibleAthenaRuntimeProtocol({ major: 1, minor: 1 }), true);
  assert.deepEqual(ATHENA_NEXT_RUNTIME_PROTOCOL, { major: 1, minor: 2 });
  const parsed11 = parseAthenaRuntimeDiscoveryDocument({
    athena: true,
    capabilities: STORAGE_DISCOVERY.capabilities,
    endpoints: STORAGE_DISCOVERY.endpoints,
    protocol: { major: 1, minor: 1 },
    runtime: "next-local",
    runtimeImplementation: "athena-js",
  });
  assert.ok(parsed11);
  assert.equal(parsed11?.protocol.minor, 1);

  const parsed12 = parseAthenaRuntimeDiscoveryDocument({
    athena: true,
    capabilities: STORAGE_DISCOVERY.capabilities,
    endpoints: {
      billing: "/legacy/billing",
      data: "/api/athena",
      storage: "/legacy/storage",
    },
    protocol: { major: 1, minor: 2 },
    runtime: "next-local",
    runtimeImplementation: "athena-js",
    topology: {
      transports: {
        billing: {
          basePath: "/api/athena/billing",
          domain: "billing",
          kind: "http",
        },
        storage: {
          basePath: "/api/athena/storage",
          domain: "storage",
          kind: "http",
        },
      },
    },
  });
  assert.ok(parsed12);
  assert.equal(parsed12?.protocol.minor, 2);
  const topology = (
    parsed12 as {
      topology?: { transports?: { storage?: { domain?: string } } };
    }
  ).topology;
  assert.equal(topology?.transports?.storage?.domain, "storage");
});

test("T-TR-NO-RUNTIME-IR: P?: this slice does not introduce Runtime IR", () => {
  const blob = joinedSources(srcRoot);
  assert.equal(blob.includes("AthenaRuntimeInvocationIR"), false);
  assert.equal(packageExports()["./runtime-ir"], undefined);
  if (existsSync(join(srcRoot, "runtime", "transport"))) {
    const ir = joinedSources(join(srcRoot, "runtime", "transport"));
    assert.equal(ir.includes("AbortSignal"), false);
    assert.equal(/\bdeadline\b/.test(ir), false);
  }
});
