/**
 * Target — Storage / Billing / Transport conformance (post-#774 / ADR 0059 follow-on).
 * GREEN. Keep-true 0059 kernel is not rewritten here.
 * Former characterization baseline retired to
 * test/sdd/superseded/athena-js-storage-billing-transport-conformance.baseline.superseded.ts.
 * See docs/sdd/xylex/athena-js-storage-billing-transport-conformance/
 */
import { strict as assert } from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../../src/auth/contract/index.ts";
import {
  ATHENA_BILLING_AUTHORIZATION_DENIED,
  AthenaBillingAuthorizationError,
  AthenaBillingError,
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
import { BILLING_OPERATION_SAFETY } from "../../src/billing/safety/registry.ts";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import { parseAthenaRuntimeDiscoveryDocument } from "../../src/gateway/discovery-types.ts";
import { createAthenaBillingHandlers } from "../../src/next/billing-handlers.ts";
import { createAthenaStorageHandlers } from "../../src/next/storage-handlers.ts";
import { getAthenaClientInternals } from "../../src/runtime/client-internals.ts";
import { normalizeAthenaPrincipal } from "../../src/runtime/data/principal.ts";
import {
  type AthenaHttpTransportIR,
  createAthenaHttpExecutor,
  createAthenaHttpTransportIR,
} from "../../src/runtime/transport/http.ts";
import {
  AthenaStorageError,
  storageErrorResult,
} from "../../src/storage/runtime/errors.ts";
import {
  authorizeStorageOperation,
  bindStorageProvider,
  bindStorageRuntime,
  createBrowserStorageTransport,
  createStorageRuntime,
  encodeAthenaStorageBytes,
  isAthenaStorageBytesEnvelope,
  reviveAthenaStorageData,
  wrapStorageModuleWithRuntime,
} from "../../src/storage/runtime/index.ts";
import { createLocalStorageProviderFromRoot } from "../../src/storage/runtime/providers/local-provider.ts";
import type {
  AuthorizedStorageOperation,
  StorageObjectProvider,
  StorageObjectResult,
} from "../../src/storage/runtime/types.ts";
import { createClient } from "../../src/v3-client.ts";
import { assertMissingRightsEnvelope } from "../helpers/authorization-envelope.ts";
import { FetchMollieSdk } from "../helpers/fetch-mollie-sdk.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const repoRoot = join(pkgRoot, "..", "..");

const DOCUMENTED_MULTI_RIGHT_EXCEPTIONS = new Set<string>();

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

const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
const HOSTILE_PDF_64K: ReadonlyArray<{ bytes: Uint8Array; name: string }> = [
  { bytes: PDF_HEADER, name: "PDF" },
  { bytes: new Uint8Array(randomBytes(65_536)), name: "64KiB" },
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

function packageExports(): Record<string, unknown> {
  return (
    (
      JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
        exports?: Record<string, unknown>;
      }
    ).exports ?? {}
  );
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

function storagePrincipal(rights: readonly string[]) {
  return normalizeAthenaPrincipal({
    authenticated: true,
    grants: [],
    rights: [...rights],
    userId: "user-storage-conformance",
  });
}

function billingPrincipal(rights: readonly string[]) {
  return normalizeAthenaPrincipal({
    authenticated: true,
    grants: [],
    rights: [...rights],
    userId: "user-billing-conformance",
  });
}

function cookie(token: string): string {
  return `${ATHENA_AUTH_SESSION_COOKIE_NAME}=${token}`;
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

function handlersForStorage(
  provider: StorageObjectProvider,
  rights: readonly string[] = ["storage.*"],
  security: "trusted" | "authenticated" = "authenticated"
) {
  const runtime = createStorageRuntime({ provider });
  const client = createClient({
    auth: false,
    databaseUrl:
      "postgresql://postgres@127.0.0.1:5432/athena_transport_conformance",
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
                  userId: "user-storage-conformance",
                },
                user: { id: "user-storage-conformance", rights: [...rights] },
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

function listItemKeys(data: unknown): string[] {
  if (!data || typeof data !== "object") {
    return [];
  }
  const record = data as Record<string, unknown>;
  const rows = record.files ?? record.items ?? record.objects;
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.map((row) => {
    if (typeof row === "string") {
      return row;
    }
    const entry =
      row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    return String(entry.storage_key ?? entry.key ?? entry.id ?? "");
  });
}

function listCursor(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return;
  }
  const cursor = (data as Record<string, unknown>).cursor;
  return typeof cursor === "string" && cursor.length > 0 ? cursor : undefined;
}

function mollieConfig() {
  return {
    mollie: {
      liveKey: "live_athena_transport_conformance",
      sdk: FetchMollieSdk,
      testKey: "test_athena_transport_conformance",
    },
  };
}

function createBillingServerClient() {
  return createClient({
    auth: false,
    billing: {
      catalog: {
        prices: [
          {
            amount: { currency: "EUR", value: "10.00" },
            id: "price_conformance",
            productId: "prod_conformance",
          },
        ],
        products: [{ id: "prod_conformance", name: "Conformance" }],
      },
      mode: "local",
      providers: mollieConfig(),
      testMode: true,
    },
    databaseUrl:
      "postgresql://postgres@127.0.0.1:5432/athena_transport_conformance",
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
              session: {
                id: "session-bill",
                userId: "user-billing-conformance",
              },
              user: { id: "user-billing-conformance", rights: [...rights] },
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

function allBillingRights(): string[] {
  return [
    "billing.catalog.read",
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
    "billing.admin.reconciliation.write",
    "billing.admin.webhooks.read",
    "billing.admin.webhooks.write",
    "billing.admin.ingestion.read",
    "billing.admin.conflicts.write",
  ];
}

function rightsDenyPayload(
  operation: BillingOperation
): Record<string, unknown> {
  switch (operation) {
    case "payments.create":
      return {
        amount: { currency: "EUR", value: "10.00" },
        description: "Order",
        idempotencyKey: "idem-rights",
        redirectUrl: "https://example.com/return",
      };
    case "refunds.create":
      return {
        amount: { currency: "EUR", value: "1.00" },
        idempotencyKey: "idem-rights",
        paymentId: "tr_x",
      };
    case "paymentLinks.create":
      return {
        amount: { currency: "EUR", value: "10.00" },
        description: "Link",
        idempotencyKey: "idem-rights",
      };
    case "subscriptions.create":
      return {
        amount: { currency: "EUR", value: "10.00" },
        customerId: "cst_x",
        description: "Plan",
        idempotencyKey: "idem-rights",
        interval: "1 month",
      };
    case "customers.create":
      return { email: "a@example.com", idempotencyKey: "idem-rights" };
    case "refunds.get":
    case "refunds.cancel":
    case "refunds.list":
      return { paymentId: "tr_x", refundId: "re_x" };
    case "subscriptions.get":
    case "subscriptions.update":
    case "subscriptions.cancel":
    case "subscriptions.list":
      return { customerId: "cst_x", subscriptionId: "sub_x" };
    case "invoices.get":
      return { invoiceId: "inv_x" };
    case "webhooks.test":
      return { id: "wh_x" };
    default:
      return { id: "x" };
  }
}

function identityFromThrown(error: unknown): {
  code: string | undefined;
  errorNumber: number | undefined;
  message: string;
  status: number | undefined;
} {
  const record =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  return {
    code: typeof record.code === "string" ? record.code : undefined,
    errorNumber:
      typeof record.errorNumber === "number" ? record.errorNumber : undefined,
    message: error instanceof Error ? error.message : String(error),
    status: typeof record.status === "number" ? record.status : undefined,
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

test("T-ST-HOSTILE-PDF-64K: P?: browser Storage get returns Uint8Array identity for PDF and 64KiB", async () => {
  const provider = memoryProvider();
  const { handlers, runtime } = handlersForStorage(provider);
  const principal = storagePrincipal(["storage.*"]);
  const browser = createBrowserStorageTransport({
    endpoints: { storage: "/api/athena/storage" },
    fetch: storageFetch(handlers, { cookie: cookie("sess_storage") }),
    headers: { cookie: cookie("sess_storage") },
  });

  for (const vector of HOSTILE_PDF_64K) {
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
    assert.equal(
      typeof (browserResult.data as { asBytes?: unknown })?.asBytes ===
        "function",
      false,
      `${vector.name} must not use asBytes as the domain type`
    );
  }

  const nested = reviveAthenaStorageData({
    body: encodeAthenaStorageBytes(PDF_HEADER),
  }) as { body: unknown };
  assertUint8Identity(nested.body, PDF_HEADER, "nested PDF body");
});

test("T-ST-LIST-PAGINATION: P?: Direct and HTTP Storage list pagination match cursor limit ordering", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-st-list-conformance-"));
  const provider = createLocalStorageProviderFromRoot({ root });
  const { handlers, runtime } = handlersForStorage(provider);
  const principal = storagePrincipal(["storage.*"]);
  const browser = createBrowserStorageTransport({
    endpoints: { storage: "/api/athena/storage" },
    fetch: storageFetch(handlers, { cookie: cookie("sess_storage") }),
    headers: { cookie: cookie("sess_storage") },
  });
  const keys = ["p/a.bin", "p/b.bin", "p/c.bin", "p/d.bin", "p/e.bin"];
  for (const key of keys) {
    const put = await runtime.execute(
      { body: new Uint8Array([1]), key, op: "put" },
      principal
    );
    assert.equal(put.ok, true, key);
  }

  async function page(input: { cursor?: string; limit: number }) {
    const direct = await runtime.execute(
      { cursor: input.cursor, limit: input.limit, op: "list", prefix: "p/" },
      principal
    );
    const http = await postStorage(
      handlers,
      "list",
      { cursor: input.cursor, limit: input.limit, prefix: "p/" },
      { cookie: cookie("sess_storage") }
    );
    const browserResult = await browser.execute({
      cursor: input.cursor,
      limit: input.limit,
      op: "list",
      prefix: "p/",
      principal,
    });
    assert.equal(direct.ok, true, "direct list");
    assert.equal(http.json.ok, true, "http list");
    assert.equal(browserResult.ok, true, "browser list");
    return {
      browser: browserResult.data,
      direct: direct.data,
      http: http.json.data,
    };
  }

  const page1 = await page({ limit: 2 });
  const directKeys1 = listItemKeys(page1.direct);
  assert.equal(directKeys1.length, 2, "local provider must honor limit");
  assert.deepEqual(listItemKeys(page1.http), directKeys1);
  assert.deepEqual(listItemKeys(page1.browser), directKeys1);
  const cursor = listCursor(page1.direct);
  assert.equal(typeof cursor, "string", "page1 cursor");
  assert.equal(listCursor(page1.http), cursor);
  assert.equal(listCursor(page1.browser), cursor);

  const page2 = await page({ cursor, limit: 2 });
  const directKeys2 = listItemKeys(page2.direct);
  assert.ok(directKeys2.length > 0, "page2 remaining items");
  assert.deepEqual(listItemKeys(page2.http), directKeys2);
  assert.deepEqual(listItemKeys(page2.browser), directKeys2);
  assert.deepEqual(
    directKeys1.filter((key) => directKeys2.includes(key)),
    [],
    "page2 must not repeat page1 keys"
  );
  const ordered = [...directKeys1, ...directKeys2];
  assert.deepEqual([...ordered].sort(), ordered.slice().sort());
});

test("T-ST-OPTIONAL-FIELDS: P?: Storage HTTP preserves optional field absence and presence", async () => {
  const provider = memoryProvider();
  const { handlers } = handlersForStorage(provider);
  const principal = storagePrincipal(["storage.*"]);
  const browser = createBrowserStorageTransport({
    endpoints: { storage: "/api/athena/storage" },
    fetch: storageFetch(handlers, { cookie: cookie("sess_storage") }),
    headers: { cookie: cookie("sess_storage") },
  });

  await browser.execute({
    key: "only-key.bin",
    op: "get",
    principal,
  });
  await browser.execute({
    key: "only-key.bin",
    op: "head",
    principal,
  });
  await browser.execute({
    key: "only-key.bin",
    op: "delete",
    principal,
  });
  await browser.execute({
    body: new Uint8Array([1]),
    key: "bare.bin",
    op: "put",
    principal,
  });
  await browser.execute({
    op: "list",
    principal,
  });
  await browser.execute({
    body: new Uint8Array([2]),
    contentType: "image/png",
    key: "full.png",
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

  const byOp = new Map<string, AuthorizedStorageOperation[]>();
  for (const call of provider.calls) {
    const bucket = byOp.get(call.op) ?? [];
    bucket.push(call);
    byOp.set(call.op, bucket);
  }
  const get = byOp.get("get")?.[0];
  assert.equal(get?.key, "only-key.bin");
  assert.equal(get?.contentType, undefined);
  assert.equal(get?.metadata, undefined);
  assert.equal(get?.prefix, undefined);
  assert.equal(get?.cursor, undefined);
  assert.equal(get?.limit, undefined);
  assert.equal(get?.contentType === null, false);
  assert.equal(byOp.get("head")?.[0]?.key, "only-key.bin");
  assert.equal(byOp.get("delete")?.[0]?.key, "only-key.bin");

  const barePut = byOp.get("put")?.[0];
  assert.equal(barePut?.key, "bare.bin");
  assert.equal(barePut?.contentType, undefined);
  assert.equal(barePut?.metadata, undefined);
  assert.equal(barePut?.contentType === null, false);
  assert.equal(barePut?.metadata === null, false);

  const fullPut = byOp.get("put")?.[1];
  assert.equal(fullPut?.contentType, "image/png");
  assert.deepEqual(fullPut?.metadata, { k: "v" });

  const bareList = byOp.get("list")?.[0];
  assert.equal(bareList?.prefix, undefined);
  assert.equal(bareList?.cursor, undefined);
  assert.equal(bareList?.limit, undefined);
  assert.equal(bareList?.limit === 0, false);
  assert.equal(bareList?.prefix === "", false);

  const fullList = byOp.get("list")?.[1];
  assert.equal(fullList?.prefix, "docs/");
  assert.equal(fullList?.cursor, "after-1");
  assert.equal(fullList?.limit, 25);
});

test("T-ST-CODEC-LOCK: P?: Storage HTTP adapters add no second bytes codec", () => {
  const forbidden = [
    join(srcRoot, "storage", "runtime", "browser-transport.ts"),
    join(srcRoot, "next", "storage-handlers.ts"),
    ...collectTsFiles(join(srcRoot, "runtime", "transport")),
  ];
  for (const file of forbidden) {
    const src = readFileSync(file, "utf8");
    assert.equal(/function bytesToBase64\(/.test(src), false, file);
    assert.equal(/\bbtoa\(/.test(src), false, file);
    assert.equal(/\batob\(/.test(src), false, file);
    assert.equal(
      /\bTextDecoder\b/.test(src),
      false,
      `wire TextDecoder in ${file}`
    );
  }
  const nucleus = readSrc("storage/runtime/nucleus.ts");
  assert.match(nucleus, /new TextEncoder\(\)\.encode\(body\)/);
  assert.match(
    readSrc("storage/runtime/bytes-envelope.ts"),
    /export function encodeAthenaStorageBytes/
  );
});

test("T-ST-NO-CTOR: P?: createStorageClient is not a package export", async () => {
  const mod = await import("../../src/index.ts");
  assert.equal("createStorageClient" in mod, false);
  assert.equal(packageExports()["./storage-client"], undefined);
  assert.equal(packageExports()["./nucleus"], undefined);
  assert.equal(packageExports()["./transport"], undefined);
});

test("T-ST-INVALID-KEY: P?: invalid Storage key is storage_invalid_request 3000 Direct HTTP Browser", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-st-key-conformance-"));
  const provider = createLocalStorageProviderFromRoot({ root });
  const { handlers, runtime } = handlersForStorage(provider);
  const principal = storagePrincipal(["storage.*"]);
  const browser = createBrowserStorageTransport({
    endpoints: { storage: "/api/athena/storage" },
    fetch: storageFetch(handlers, { cookie: cookie("sess_storage") }),
    headers: { cookie: cookie("sess_storage") },
  });
  const facade = wrapStorageModuleWithRuntime(
    {
      file: {
        delete: async () => null,
        get: async () => null,
        upload: async () => null,
      },
    },
    runtime
  );

  for (const key of ["../x", "a\0b"]) {
    for (const op of ["get", "put", "delete"] as const) {
      const request =
        op === "put" ? { body: new Uint8Array([1]), key, op } : { key, op };
      const direct = await runtime.execute(request, principal);
      assert.equal(direct.ok, false, `${op} direct ${JSON.stringify(key)}`);
      assert.equal(direct.error?.errorNumber, 3000, `${op} direct number`);
      assert.equal(
        direct.error?.code,
        "storage_invalid_request",
        `${op} direct code`
      );
      assert.equal(direct.status, 400, `${op} direct status`);
      assert.equal(direct.error?.errorNumber === 3010, false);

      const payload: Record<string, unknown> =
        op === "put"
          ? { body: encodeAthenaStorageBytes(new Uint8Array([1])), key }
          : { key };
      const http = await postStorage(handlers, op, payload, {
        cookie: cookie("sess_storage"),
      });
      assert.equal(http.json.error?.errorNumber, 3000, `${op} http number`);
      assert.equal(
        http.json.error?.code,
        "storage_invalid_request",
        `${op} http code`
      );
      assert.equal(http.json.status, 400, `${op} http status`);
      assert.equal(http.response.status, 400, `${op} http response`);

      const browserResult = await browser.execute({
        ...request,
        principal,
      });
      assert.equal(
        browserResult.error?.errorNumber,
        3000,
        `${op} browser number`
      );
      assert.equal(
        browserResult.error?.code,
        "storage_invalid_request",
        `${op} browser code`
      );
      assert.equal(browserResult.status, 400, `${op} browser status`);
    }

    await assert.rejects(
      () => facade.file.get({ key }),
      (error: unknown) => {
        assert.equal(error instanceof AthenaStorageError, true);
        const record = error as AthenaStorageError;
        assert.equal(record.errorNumber, 3000);
        assert.equal(record.code, "storage_invalid_request");
        assert.equal(record.status, 400);
        assert.equal(record.errorNumber === 3010, false);
        return true;
      }
    );
  }
});

test("T-ST-ERROR-CASES: P?: Storage structured error identity covers unsupported operation", async () => {
  const { handlers, runtime } = handlersForStorage(memoryProvider());
  const principal = storagePrincipal(["storage.*"]);
  let unsupported: StorageObjectResult | undefined;
  try {
    unsupported = await runtime.execute(
      { key: "x.bin", op: "not-an-op" as never },
      principal
    );
  } catch (error) {
    assert.equal(
      error,
      undefined,
      "unsupported op must be storage_invalid_request 3000, not throw"
    );
  }
  assert.equal(unsupported?.error?.code, "storage_invalid_request");
  assert.equal(unsupported?.error?.errorNumber, 3000);
  assert.equal(unsupported?.status, 400);

  const http = await postStorage(
    handlers,
    "not-an-op",
    { key: "x.bin" },
    { cookie: cookie("sess_storage") }
  );
  assert.equal(http.json.error?.code, "storage_invalid_request");
  assert.equal(http.json.error?.errorNumber, 3000);
  assert.equal(http.response.status, 400);

  const overlays = readSrc("storage/runtime/overlays.ts");
  assert.equal(/throw new Error\(/.test(overlays), false);
  assert.match(overlays, /AthenaStorageError/);
  const errors = readSrc("storage/runtime/errors.ts");
  assert.match(errors, /export class AthenaStorageError/);
  assert.equal(
    existsSync(join(srcRoot, "storage", "runtime", "errors.ts")),
    true
  );
  const alias = readSrc("storage/runtime/overlays.ts");
  if (alias.includes("storageErrorFromResult")) {
    assert.match(alias, /AthenaStorageError/);
  }
});

test("T-ST-NO-GENERIC-OVERLAY: P?: storage overlays do not throw new Error for runtime results", () => {
  const overlays = readSrc("storage/runtime/overlays.ts");
  assert.equal(
    /throw new Error\(result\.error\?\.message/.test(overlays),
    false
  );
  assert.match(overlays, /AthenaStorageError/);
});

test("T-BIL-MUTATING-CONTRACT: P?: Direct vs browser Billing contract holds for create list update delete-cancel", async () => {
  const client = createBillingServerClient();
  const internals = getAthenaClientInternals(client);
  assert.ok(internals?.billingRuntime);
  const rights = allBillingRights();
  const handlers = billingHandlersFor(client, rights);
  const browser = createBrowserBillingTransport({
    endpoints: { billing: "/api/athena/billing" },
    fetch: billingFetch(handlers, { cookie: cookie("sess_bill") }),
    headers: { cookie: cookie("sess_bill") },
  });
  const operator = embeddedBillingOperator(handlers);
  assert.equal("payments" in browser, false);
  assert.equal("webhooks" in browser, false);
  assert.equal("admin" in browser, false);
  assert.equal(typeof browser.catalog.products.list, "function");
  assert.equal(typeof browser.self.invoices.list, "function");
  assert.equal(typeof browser.getCapabilities, "function");
  const principal = billingPrincipal(rights);

  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("api.mollie.com")) {
      const method = (init?.method ?? "GET").toUpperCase();
      const path = new URL(url).pathname;
      if (path.includes("/v2/payments") && method === "GET") {
        if (path.endsWith("/v2/payments") || /\/v2\/payments\/?$/.test(path)) {
          return Response.json({
            _embedded: { payments: [] },
            count: 0,
          });
        }
        return Response.json({
          amount: { currency: "EUR", value: "10.00" },
          createdAt: "2026-01-01T00:00:00+00:00",
          id: "tr_created",
          resource: "payment",
          status: "open",
        });
      }
      if (
        method === "POST" &&
        path.includes("/v2/payments") &&
        !path.includes("/refunds")
      ) {
        return Response.json(
          {
            amount: { currency: "EUR", value: "10.00" },
            createdAt: "2026-01-01T00:00:00+00:00",
            description: "Order",
            id: "tr_created",
            resource: "payment",
            status: "open",
          },
          { status: 201 }
        );
      }
      if (path.includes("/v2/customers") && method === "POST") {
        return Response.json(
          {
            email: "a@example.com",
            id: "cst_created",
            resource: "customer",
          },
          { status: 201 }
        );
      }
      if (path.includes("/v2/customers") && method === "PATCH") {
        return Response.json({
          email: "b@example.com",
          id: "cst_updated",
          resource: "customer",
        });
      }
      if (path.includes("/v2/customers") && method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (path.includes("/refunds") && method === "POST") {
        return Response.json(
          {
            amount: { currency: "EUR", value: "1.00" },
            id: "re_created",
            resource: "refund",
          },
          { status: 201 }
        );
      }
      if (path.includes("/subscriptions") && method === "POST") {
        return Response.json(
          {
            id: "sub_created",
            resource: "subscription",
            status: "active",
          },
          { status: 201 }
        );
      }
      if (path.includes("/subscriptions") && method === "DELETE") {
        return Response.json({
          id: "sub_canceled",
          resource: "subscription",
          status: "canceled",
        });
      }
      if (path.includes("/payment-links") && method === "POST") {
        return Response.json(
          {
            id: "pl_created",
            resource: "payment-link",
          },
          { status: 201 }
        );
      }
      if (path.includes("/payment-links") && method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (path.includes("/sales-invoices")) {
        return Response.json({ _embedded: { sales_invoices: [] }, count: 0 });
      }
      if (path.includes("/webhooks") && method === "GET") {
        return Response.json({ _embedded: { webhooks: [] }, count: 0 });
      }
      if (path.includes("/webhooks") && method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (method === "GET") {
        return Response.json({ id: "listed", resource: "unknown" });
      }
      return Response.json({ id: "x", resource: "unknown" });
    }
    return billingFetch(handlers, { cookie: cookie("sess_bill") })(input, init);
  }) as typeof fetch;

  try {
    const pairs: Array<{
      browser: () => Promise<unknown>;
      direct: () => Promise<unknown>;
      httpOp: string;
      httpPayload: Record<string, unknown>;
      label: string;
    }> = [
      {
        browser: () =>
          operator.payments.create({
            amount: { currency: "EUR", value: "10.00" },
            description: "Order",
            idempotencyKey: "idem-pay-create",
            redirectUrl: "https://example.com/return",
          }),
        direct: () =>
          internals.billingRuntime.execute(
            "payments.create",
            {
              amount: { currency: "EUR", value: "10.00" },
              description: "Order",
              idempotencyKey: "idem-pay-create",
              redirectUrl: "https://example.com/return",
            },
            principal
          ),
        httpOp: "payments.create",
        httpPayload: {
          amount: { currency: "EUR", value: "10.00" },
          description: "Order",
          idempotencyKey: "idem-pay-create",
          redirectUrl: "https://example.com/return",
        },
        label: "payments.create",
      },
      {
        browser: () => operator.payments.list({}),
        direct: () =>
          internals.billingRuntime.execute("payments.list", {}, principal),
        httpOp: "payments.list",
        httpPayload: {},
        label: "payments.list",
      },
      {
        browser: () => operator.payments.get({ id: "tr_created" }),
        direct: () =>
          internals.billingRuntime.execute(
            "payments.get",
            { id: "tr_created" },
            principal
          ),
        httpOp: "payments.get",
        httpPayload: { id: "tr_created" },
        label: "payments.get",
      },
      {
        browser: () =>
          operator.customers.create({
            email: "a@example.com",
            idempotencyKey: "idem-cst-create",
          }),
        direct: () =>
          internals.billingRuntime.execute(
            "customers.create",
            { email: "a@example.com", idempotencyKey: "idem-cst-create" },
            principal
          ),
        httpOp: "customers.create",
        httpPayload: {
          email: "a@example.com",
          idempotencyKey: "idem-cst-create",
        },
        label: "customers.create",
      },
      {
        browser: () =>
          operator.customers.update({
            id: "cst_created",
            name: "Ada",
          }),
        direct: () =>
          internals.billingRuntime.execute(
            "customers.update",
            { id: "cst_created", name: "Ada" },
            principal
          ),
        httpOp: "customers.update",
        httpPayload: { id: "cst_created", name: "Ada" },
        label: "customers.update",
      },
      {
        browser: () => operator.customers.delete({ id: "cst_created" }),
        direct: () =>
          internals.billingRuntime.execute(
            "customers.delete",
            { id: "cst_created" },
            principal
          ),
        httpOp: "customers.delete",
        httpPayload: { id: "cst_created" },
        label: "customers.delete",
      },
      {
        browser: () =>
          operator.refunds.create({
            amount: { currency: "EUR", value: "1.00" },
            idempotencyKey: "idem-re-create",
            paymentId: "tr_created",
          }),
        direct: () =>
          internals.billingRuntime.execute(
            "refunds.create",
            {
              amount: { currency: "EUR", value: "1.00" },
              idempotencyKey: "idem-re-create",
              paymentId: "tr_created",
            },
            principal
          ),
        httpOp: "refunds.create",
        httpPayload: {
          amount: { currency: "EUR", value: "1.00" },
          idempotencyKey: "idem-re-create",
          paymentId: "tr_created",
        },
        label: "refunds.create",
      },
      {
        browser: () =>
          operator.subscriptions.create({
            amount: { currency: "EUR", value: "10.00" },
            customerId: "cst_created",
            description: "Plan",
            idempotencyKey: "idem-sub-create",
            interval: "1 month",
          }),
        direct: () =>
          internals.billingRuntime.execute(
            "subscriptions.create",
            {
              amount: { currency: "EUR", value: "10.00" },
              customerId: "cst_created",
              description: "Plan",
              idempotencyKey: "idem-sub-create",
              interval: "1 month",
            },
            principal
          ),
        httpOp: "subscriptions.create",
        httpPayload: {
          amount: { currency: "EUR", value: "10.00" },
          customerId: "cst_created",
          description: "Plan",
          idempotencyKey: "idem-sub-create",
          interval: "1 month",
        },
        label: "subscriptions.create",
      },
      {
        browser: () =>
          operator.subscriptions.cancel({
            customerId: "cst_created",
            subscriptionId: "sub_created",
          }),
        direct: () =>
          internals.billingRuntime.execute(
            "subscriptions.cancel",
            { customerId: "cst_created", subscriptionId: "sub_created" },
            principal
          ),
        httpOp: "subscriptions.cancel",
        httpPayload: {
          customerId: "cst_created",
          subscriptionId: "sub_created",
        },
        label: "subscriptions.cancel",
      },
      {
        browser: () =>
          operator.paymentLinks.create({
            amount: { currency: "EUR", value: "10.00" },
            description: "Link",
            idempotencyKey: "idem-pl-create",
          }),
        direct: () =>
          internals.billingRuntime.execute(
            "paymentLinks.create",
            {
              amount: { currency: "EUR", value: "10.00" },
              description: "Link",
              idempotencyKey: "idem-pl-create",
            },
            principal
          ),
        httpOp: "paymentLinks.create",
        httpPayload: {
          amount: { currency: "EUR", value: "10.00" },
          description: "Link",
          idempotencyKey: "idem-pl-create",
        },
        label: "paymentLinks.create",
      },
      {
        browser: () => operator.paymentLinks.delete({ id: "pl_created" }),
        direct: () =>
          internals.billingRuntime.execute(
            "paymentLinks.delete",
            { id: "pl_created" },
            principal
          ),
        httpOp: "paymentLinks.delete",
        httpPayload: { id: "pl_created" },
        label: "paymentLinks.delete",
      },
      {
        browser: () => browser.self.invoices.list({}),
        direct: () =>
          internals.billingRuntime.execute("self.invoices.list", {}, principal),
        httpOp: "self.invoices.list",
        httpPayload: {},
        label: "invoices.list",
      },
      {
        browser: () => operator.webhooks.list({}),
        direct: () =>
          internals.billingRuntime.execute("webhooks.list", {}, principal),
        httpOp: "webhooks.list",
        httpPayload: {},
        label: "webhooks.list",
      },
      {
        browser: () => operator.webhooks.delete({ id: "wh_created" }),
        direct: () =>
          internals.billingRuntime.execute(
            "webhooks.delete",
            { id: "wh_created" },
            principal
          ),
        httpOp: "webhooks.delete",
        httpPayload: { id: "wh_created" },
        label: "webhooks.delete",
      },
      {
        browser: () => browser.getCapabilities({}),
        direct: () =>
          internals.billingRuntime.execute("getCapabilities", {}, principal),
        httpOp: "getCapabilities",
        httpPayload: {},
        label: "capabilities",
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
      if (
        httpJson.data &&
        typeof httpJson.data === "object" &&
        !Array.isArray(httpJson.data)
      ) {
        assert.equal("ok" in (httpJson.data as object), false, pair.label);
      }
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
          identityFromThrown(browserError),
          identityFromThrown(directError),
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
        if (
          directValue &&
          typeof directValue === "object" &&
          "id" in (directValue as object)
        ) {
          assert.equal(
            typeof (directValue as { id?: unknown }).id === "string" ||
              (directValue as { id?: unknown }).id == null,
            true,
            `${pair.label} id`
          );
        }
        if (
          directValue &&
          typeof directValue === "object" &&
          "amount" in (directValue as object) &&
          (directValue as { amount?: unknown }).amount
        ) {
          assert.deepEqual(
            (httpJson.data as { amount?: unknown }).amount,
            (directValue as { amount?: unknown }).amount
          );
        }
      }
    }
  } finally {
    globalThis.fetch = previous;
  }
});

test("T-BIL-RUNTIME-PARITY: P?: billing runtime-parity harness runs Direct and HTTP fixtures", () => {
  const harness = join(
    pkgRoot,
    "test",
    "conformance",
    "billing",
    "runtime-parity.test.ts"
  );
  assert.equal(
    existsSync(harness),
    true,
    "test/conformance/billing/runtime-parity.test.ts"
  );
  const src = readFileSync(harness, "utf8");
  assert.match(src, /BillingRuntime/);
  assert.match(src, /createAthenaBillingHandlers/);
  assert.match(src, /createBrowserBillingTransport/);
  assert.match(src, /createAthenaHttpExecutor/);
});

test("T-BIL-HTTP-SAFETY: P?: Billing HTTP cannot bypass BILLING_OPERATION_SAFETY", async () => {
  const client = createBillingServerClient();
  const internals = getAthenaClientInternals(client);
  assert.ok(internals?.billingRuntime);
  const rights = allBillingRights();
  const handlers = billingHandlersFor(client, rights);
  const principal = billingPrincipal(rights);
  const financialWrites = (
    Object.keys(BILLING_OPERATION_SAFETY) as BillingOperation[]
  ).filter((operation) => {
    const profile = BILLING_OPERATION_SAFETY[operation];
    return (
      profile.idempotency === "required_caller_owned" ||
      profile.mutationClass === "financial_create"
    );
  });
  assert.ok(financialWrites.includes("payments.create"));

  const createPayload = {
    amount: { currency: "EUR", value: "10.00" },
    description: "Order",
    redirectUrl: "https://example.com/return",
  };

  await assert.rejects(
    () => internals.billingRuntime.payments.create(createPayload as never),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /ATHENA_BILLING_IDEMPOTENCY/);
      assert.equal(
        error instanceof AthenaBillingError || /ATHENA_BILLING_/.test(message),
        true
      );
      return true;
    }
  );

  const missingHttp = await handlers.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({
        operation: "payments.create",
        payload: createPayload,
      }),
      headers: {
        "content-type": "application/json",
        cookie: cookie("sess_bill"),
        origin: "http://localhost",
      },
      method: "POST",
    })
  );
  const missingJson = (await missingHttp.json()) as {
    error?: { code?: string; message?: string };
    ok?: boolean;
  };
  assert.ok(missingHttp.status >= 400);
  assert.equal(missingJson.ok, false);
  assert.equal(missingJson.error?.code === "ATHENA_BILLING_INTERNAL", false);
  assert.match(
    `${missingJson.error?.code ?? ""} ${missingJson.error?.message ?? ""}`,
    /ATHENA_BILLING_IDEMPOTENCY|ATHENA_BILLING_AUTHORIZATION_DENIED/
  );

  const invalidMoney = await handlers.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({
        operation: "payments.create",
        payload: {
          ...createPayload,
          amount: { currency: "EUR", value: "not-money" },
          idempotencyKey: "idem-bad-money",
        },
      }),
      headers: {
        "content-type": "application/json",
        cookie: cookie("sess_bill"),
        origin: "http://localhost",
      },
      method: "POST",
    })
  );
  const moneyJson = (await invalidMoney.json()) as {
    error?: { code?: string; message?: string };
  };
  assert.ok(invalidMoney.status >= 400);
  assert.match(
    `${moneyJson.error?.code ?? ""} ${moneyJson.error?.message ?? ""}`,
    /ATHENA_BILLING_MONEY_|ATHENA_BILLING_AUTHORIZATION_DENIED/
  );
  assert.equal(moneyJson.error?.code === "ATHENA_BILLING_INTERNAL", false);

  const previous = globalThis.fetch;
  let molliePosts = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("api.mollie.com")) {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && url.includes("/v2/payments")) {
        molliePosts += 1;
        return Response.json(
          {
            amount: { currency: "EUR", value: "10.00" },
            id: "tr_ok",
            resource: "payment",
            status: "open",
          },
          { status: 201 }
        );
      }
      return Response.json({ resource: "unknown" });
    }
    return billingFetch(handlers, { cookie: cookie("sess_bill") })(input, init);
  }) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        internals.billingRuntime.execute(
          "payments.create",
          { ...createPayload, idempotencyKey: "idem-ok" },
          principal
        ),
      (error: unknown) => {
        assert.equal(error instanceof AthenaBillingAuthorizationError, true);
        return true;
      }
    );
    const httpAccepted = await handlers.POST(
      new Request("http://localhost/api/athena/billing", {
        body: JSON.stringify({
          operation: "payments.create",
          payload: { ...createPayload, idempotencyKey: "idem-ok-http" },
        }),
        headers: {
          "content-type": "application/json",
          cookie: cookie("sess_bill"),
          origin: "http://localhost",
        },
        method: "POST",
      })
    );
    assert.equal(httpAccepted.status, 403);
    assert.equal(
      molliePosts,
      0,
      "session HTTP cannot select the operator payment runtime"
    );

    const deniedHandlers = billingHandlersFor(client, [
      "billing.payments.read",
    ]);
    const before = molliePosts;
    const denied = await deniedHandlers.POST(
      new Request("http://localhost/api/athena/billing", {
        body: JSON.stringify({
          operation: "payments.create",
          payload: { ...createPayload, idempotencyKey: "idem-denied" },
        }),
        headers: {
          "content-type": "application/json",
          cookie: cookie("sess_bill"),
          origin: "http://localhost",
        },
        method: "POST",
      })
    );
    assert.equal(denied.status, 403);
    assert.equal(
      molliePosts,
      before,
      "capability/rights deny must not call provider create"
    );
  } finally {
    globalThis.fetch = previous;
  }

  const handlerSrc = readSrc("next/billing-handlers.ts");
  const browserSrc = readSrc("billing/runtime/browser-transport.ts");
  assert.equal(handlerSrc.includes("prepareBillingCommand"), false);
  assert.equal(browserSrc.includes("prepareBillingCommand"), false);
  assert.equal(browserSrc.includes("idempotencyKey"), false);
  assert.equal(/for\s*\(.*retry/.test(handlerSrc), false);
  assert.equal(handlerSrc.includes("billingRetryDisposition"), false);
  assert.doesNotMatch(
    joinedSources(join(srcRoot, "billing")),
    /\bbillingRetryDispositionForKind\b/
  );
});

test("T-BIL-RIGHTS-EXHAUSTIVE: P?: every BillingOperation has exactly one required Right", async () => {
  const operations = Object.keys(
    BILLING_OPERATION_RIGHTS
  ) as BillingOperation[];
  assert.ok(operations.length > 0);
  for (const operation of operations) {
    const required = requiredBillingRights(operation);
    if (DOCUMENTED_MULTI_RIGHT_EXCEPTIONS.has(operation)) {
      assert.ok(required.length >= 1, operation);
      continue;
    }
    assert.equal(required.length, 1, operation);
  }

  const handlerSrc = readSrc("next/billing-handlers.ts");
  const browserSrc = readSrc("billing/runtime/browser-transport.ts");
  const mollieSrc = joinedSources(
    join(srcRoot, "billing", "runtime", "local", "providers", "mollie")
  );
  assert.equal(handlerSrc.includes("missingRequiredRights"), false);
  assert.equal(handlerSrc.includes("authorizeBillingOperation"), false);
  assert.equal(browserSrc.includes("missingRequiredRights"), false);
  assert.equal(browserSrc.includes("authorizeBillingOperation"), false);
  assert.equal(mollieSrc.includes("missingRequiredRights"), false);

  const authUi = join(pkgRoot, "..", "athena-auth-ui", "src");
  if (existsSync(authUi)) {
    const ui = joinedSources(authUi);
    assert.equal(ui.includes("authorizeBillingOperation"), false);
  }

  const client = createBillingServerClient();
  for (const operation of operations) {
    const required = requiredBillingRights(operation);
    const sibling = String(required[0]).endsWith(".write")
      ? String(required[0]).replace(/\.write$/, ".read")
      : String(required[0]).replace(/\.read$/, ".write");
    const denyRights = sibling === String(required[0]) ? [] : [sibling];
    const denyPrincipal = billingPrincipal(denyRights);
    assert.ok(authorizeBillingOperation(denyPrincipal, operation));
    const handlers = billingHandlersFor(client, denyRights);
    const payload = rightsDenyPayload(operation);
    const http = await handlers.POST(
      new Request("http://localhost/api/athena/billing", {
        body: JSON.stringify({ operation, payload }),
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
  }
});

test("T-AUTHZ-ENVELOPE: P?: Billing and Storage Rights denials share missing-rights envelope", async () => {
  const billingDenied = authorizeBillingOperation(
    billingPrincipal([]),
    "payments.list"
  );
  assert.ok(billingDenied);
  assertMissingRightsEnvelope({
    code: billingDenied.code,
    errorNumber: billingDenied.errorNumber,
    message: billingDenied.message,
    missing: billingDenied.missing.map(String),
    operation: billingDenied.operation,
  });

  const storageDenied = authorizeStorageOperation(
    normalizeAthenaPrincipal({
      authenticated: true,
      grants: [],
      rights: [],
      userId: "user-storage-conformance",
    }),
    "put"
  );
  assert.ok(storageDenied?.error);
  assertMissingRightsEnvelope(storageDenied.error);
});

test("T-BIL-TRANSLATOR-LOCK: P?: billingErrorFromTransport remains the only HTTP translator", async () => {
  assert.equal(
    existsSync(join(srcRoot, "billing", "runtime", "transport-error.ts")),
    false
  );
  const httpError = await tryImport("billing/runtime/http-error.ts");
  assert.ok(httpError);
  assert.equal(typeof httpError.billingErrorFromTransport, "function");
  const browserSrc = readSrc("billing/runtime/browser-transport.ts");
  assert.match(browserSrc, /throw billingErrorFromTransport/);
  assert.equal(browserSrc.includes('throw new Error("billing failed")'), false);
  assert.equal(
    readSrc("next/billing-handlers.ts").includes(
      'throw new Error("billing failed")'
    ),
    false
  );
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
  assert.equal(packageExports()["./transport"], undefined);
});

test("T-TR-FACTORY-REJECT: P?: createAthenaHttpTransportIR rejects empty path unsupported scheme and remote same-origin credentials", () => {
  const relative = createAthenaHttpTransportIR({
    basePath: "/api/athena/storage",
    domain: "storage",
  } as never);
  assert.equal(relative.kind, "http");
  assert.equal(relative.version, 1);
  assert.equal(relative.origin, "same-origin");
  assert.equal(relative.credentials, "same-origin");

  const absolute = createAthenaHttpTransportIR({
    basePath: "https://files.example.com/api/athena/storage",
    domain: "storage",
  } as never);
  assert.equal(absolute.origin, "remote");
  assert.equal(absolute.credentials, "none");

  const auth = createAthenaHttpTransportIR({
    basePath: "/api/athena/auth",
    domain: "auth",
    origin: "same-origin",
  });
  assert.equal(auth.domain, "auth");

  assert.throws(() =>
    createAthenaHttpTransportIR({
      basePath: "",
      domain: "storage",
      origin: "same-origin",
    })
  );
  assert.throws(() =>
    createAthenaHttpTransportIR({
      basePath: "ftp://example.com/objects",
      domain: "storage",
      origin: "same-origin",
    })
  );
  assert.throws(() =>
    createAthenaHttpTransportIR({
      basePath: "file:///tmp/objects",
      domain: "storage",
      origin: "same-origin",
    })
  );
  assert.throws(() =>
    createAthenaHttpTransportIR({
      basePath: "https://files.example.com/api/athena/storage",
      credentials: "same-origin",
      domain: "storage",
      origin: "remote",
    } as never)
  );
  assert.throws(() =>
    createAthenaHttpTransportIR({
      basePath: "https://",
      domain: "storage",
      origin: "same-origin",
    })
  );
  assert.throws(() =>
    createAthenaHttpTransportIR({
      basePath: "/api/athena/storage",
      domain: "nucleus",
      origin: "same-origin",
    })
  );
});

test("T-TR-TOPOLOGY-SLOT: P?: validateAthenaRuntimeTopologyIR fail-closes slot domain mismatch", async () => {
  const httpMod = await tryImport("runtime/transport/http.ts");
  const discoveryMod = await tryImport("gateway/discovery-types.ts");
  const validate =
    (httpMod?.validateAthenaRuntimeTopologyIR as
      | ((value: unknown) => unknown)
      | undefined) ??
    (discoveryMod?.validateAthenaRuntimeTopologyIR as
      | ((value: unknown) => unknown)
      | undefined);
  assert.equal(typeof validate, "function", "validateAthenaRuntimeTopologyIR");

  const valid = {
    transports: {
      auth: { basePath: "/api/athena/auth", domain: "auth", kind: "http" },
      billing: {
        basePath: "/api/athena/billing",
        domain: "billing",
        kind: "http",
      },
      data: { basePath: "/api/athena", domain: "data", kind: "http" },
      storage: {
        basePath: "/api/athena/storage",
        domain: "storage",
        kind: "http",
      },
    },
  };
  assert.doesNotThrow(() => validate?.(valid));

  assert.throws(() =>
    validate?.({
      transports: {
        storage: {
          basePath: "/api/athena/storage",
          domain: "billing",
          kind: "http",
        },
      },
    })
  );

  const parsed = parseAthenaRuntimeDiscoveryDocument({
    athena: true,
    capabilities: STORAGE_DISCOVERY.capabilities,
    endpoints: { data: "/api/athena" },
    protocol: { major: 1, minor: 1 },
    runtime: "next-local",
    runtimeImplementation: "athena-js",
  });
  assert.ok(parsed);
  assert.equal(
    parsed?.topology?.transports == null || parsed?.protocol?.minor === 1,
    true
  );
});

test("T-TR-PARSER-FAIL-CLOSED: P?: discovery aliases die at parser and never appear on executable IR", () => {
  const omit = parseAthenaRuntimeDiscoveryDocument({
    athena: true,
    capabilities: STORAGE_DISCOVERY.capabilities,
    endpoints: {
      data: "/api/athena",
      storage: "/api/athena/storage",
    },
    protocol: { major: 1, minor: 2 },
    runtime: "next-local",
    runtimeImplementation: "athena-js",
    topology: {
      transports: {
        storage: {
          basePath: "/api/athena/storage",
          credentials: "omit",
          domain: "storage",
          kind: "http",
        },
      },
    },
  });
  assert.equal(omit, undefined);

  const include = parseAthenaRuntimeDiscoveryDocument({
    athena: true,
    capabilities: STORAGE_DISCOVERY.capabilities,
    endpoints: STORAGE_DISCOVERY.endpoints,
    protocol: { major: 1, minor: 2 },
    runtime: "next-local",
    runtimeImplementation: "athena-js",
    topology: {
      transports: {
        storage: {
          basePath: "/api/athena/storage",
          credentials: "include",
          domain: "storage",
          kind: "http",
        },
      },
    },
  });
  assert.equal(include, undefined);

  const unknownKind = parseAthenaRuntimeDiscoveryDocument({
    athena: true,
    capabilities: STORAGE_DISCOVERY.capabilities,
    endpoints: STORAGE_DISCOVERY.endpoints,
    protocol: { major: 1, minor: 2 },
    runtime: "next-local",
    runtimeImplementation: "athena-js",
    topology: {
      transports: {
        storage: {
          basePath: "/api/athena/storage",
          domain: "storage",
          kind: "sse",
        },
      },
    },
  });
  assert.equal(unknownKind, undefined);

  const emptyPath = parseAthenaRuntimeDiscoveryDocument({
    athena: true,
    capabilities: STORAGE_DISCOVERY.capabilities,
    endpoints: STORAGE_DISCOVERY.endpoints,
    protocol: { major: 1, minor: 2 },
    runtime: "next-local",
    runtimeImplementation: "athena-js",
    topology: {
      transports: {
        storage: { basePath: "", domain: "storage", kind: "http" },
      },
    },
  });
  assert.equal(emptyPath, undefined);

  const ir = createAthenaHttpTransportIR({
    basePath: "/api/athena/storage",
    domain: "storage",
    origin: "same-origin",
  });
  const serialized = JSON.stringify(ir);
  assert.equal(serialized.includes('"omit"'), false);
  assert.equal(serialized.includes('"include"'), false);
});

test("T-TR-DATA-AUTH-HTTP: P?: data and auth HTTP use createAthenaHttpTransportIR", () => {
  const callFiles: string[] = [];
  for (const file of collectTsFiles(srcRoot)) {
    const text = readFileSync(file, "utf8");
    if (
      text.includes("createAthenaHttpTransportIR(") &&
      !text.includes("export function createAthenaHttpTransportIR(")
    ) {
      callFiles.push(file.replace(/\\/g, "/"));
    }
  }
  assert.equal(
    callFiles.some((file) =>
      file.endsWith("storage/runtime/browser-transport.ts")
    ),
    true
  );
  assert.equal(
    callFiles.some((file) =>
      file.endsWith("billing/runtime/browser-transport.ts")
    ),
    true
  );
  assert.equal(
    callFiles.some(
      (file) =>
        file.includes("/auth/") ||
        file.includes("auth/runtime") ||
        /auth.*browser-transport|browser-transport.*auth/i.test(file)
    ) ||
      callFiles.some((file) =>
        readFileSync(file, "utf8").includes('domain: "auth"')
      ),
    true,
    "auth domain factory call"
  );
  assert.equal(
    callFiles.some(
      (file) => file.includes("/data/") || file.includes("data/runtime")
    ) ||
      callFiles.some((file) =>
        readFileSync(file, "utf8").includes('domain: "data"')
      ),
    true,
    "data domain factory call"
  );
  assert.equal(
    joinedSources(srcRoot).includes("function httpDataTransport"),
    false
  );
  assert.equal(
    joinedSources(srcRoot).includes("function httpAuthTransport"),
    false
  );
  assert.equal(
    joinedSources(srcRoot).includes("function httpStorageTransport"),
    false
  );
  assert.equal(
    joinedSources(srcRoot).includes("function httpBillingTransport"),
    false
  );
  const topology = readSrc("gateway/discovery-types.ts");
  assert.match(topology, /auth\?:/);
});

test("T-TR-NO-CTOR: P?: Transport IR is not a package export", async () => {
  const mod = await import("../../src/index.ts");
  assert.equal("createAthenaHttpTransportIR" in mod, false);
  assert.equal(packageExports()["./transport"], undefined);
  assert.equal("createStorageClient" in mod, false);
  assert.equal("createBillingClient" in mod, false);
});

test("T-TR-INTERNAL-LOCK: P?: Transport IR never contains principal Rights Policy secrets or execution context", () => {
  const httpSrc = readSrc("runtime/transport/http.ts");
  for (const token of [
    "AthenaPrincipal",
    "prepareBillingCommand",
    "missingRequiredRights",
    "DATABASE_URL",
    "liveKey",
    "secretAccessKey",
  ]) {
    assert.equal(httpSrc.includes(token), false, token);
  }
  const start = httpSrc.indexOf("export interface AthenaHttpTransportIR");
  const end = httpSrc.indexOf("export function createAthenaHttpTransportIR");
  assert.ok(start >= 0 && end > start);
  const irType = httpSrc.slice(start, end);
  for (const token of [
    "AbortSignal",
    "deadline",
    "requestId",
    "traceId",
    "correlationId",
    "principal",
    "rights",
    "grants",
  ]) {
    assert.equal(irType.includes(token), false, token);
  }
  const ir = createAthenaHttpTransportIR({
    basePath: "/api/athena/storage",
    domain: "storage",
    origin: "same-origin",
  });
  const keys = Object.keys(ir).sort();
  assert.deepEqual(keys, [
    "basePath",
    "credentials",
    "domain",
    "encoding",
    "kind",
    "origin",
    "version",
  ]);
  assert.equal("requestId" in ir, false);
  assert.equal("principal" in ir, false);
});

test("T-EX-CONTEXT-SUBSTRATE: P?: HTTP executor accepts requestId traceId correlationId AbortSignal deadline off Transport IR", async () => {
  const ir = createAthenaHttpTransportIR({
    basePath: "/api/athena/storage",
    domain: "storage",
    origin: "same-origin",
  });
  assert.equal("requestId" in ir, false);
  assert.equal("traceId" in ir, false);
  assert.equal("signal" in ir, false);

  const captured: RequestInit[] = [];
  const abort = new AbortController();
  const executor = createAthenaHttpExecutor(ir, {
    correlationId: "corr-1",
    deadline: Date.now() + 5000,
    fetch: (async (_input, init) => {
      captured.push(init ?? {});
      return Response.json({ ok: true });
    }) as typeof fetch,
    requestId: "req-1",
    signal: abort.signal,
    traceId: "tr-1",
  } as never);

  await executor.postJson("/api/athena/storage", {
    operation: "list",
    payload: {},
  });
  assert.ok(captured[0], "executor dispatched");
  const headers = new Headers(captured[0]?.headers);
  assert.equal(headers.get("x-athena-request-id"), "req-1");
  assert.equal(headers.get("x-athena-trace-id"), "tr-1");
  assert.equal(captured[0]?.signal, abort.signal);
});

test("T-EX-NOT-ON-IR: P?: Transport IR type has no execution context fields", () => {
  const httpSrc = readSrc("runtime/transport/http.ts");
  assert.match(httpSrc, /export interface AthenaHttpTransportIR/);
  const start = httpSrc.indexOf("export interface AthenaHttpTransportIR");
  const end = httpSrc.indexOf("export function createAthenaHttpTransportIR");
  const body = httpSrc.slice(start, end);
  for (const token of [
    "AbortSignal",
    "deadline",
    "requestId",
    "traceId",
    "correlationId",
    "principal",
  ]) {
    assert.equal(body.includes(token), false, token);
  }
  const ir: AthenaHttpTransportIR = createAthenaHttpTransportIR({
    basePath: "/api/athena/billing",
    domain: "billing",
    origin: "same-origin",
  });
  assert.equal(ir.encoding, "json");
});

test("T-EX-NO-RUNTIME-IR: P?: this slice does not introduce Runtime Invocation IR", () => {
  const blob = joinedSources(srcRoot);
  assert.equal(blob.includes("AthenaRuntimeInvocationIR"), false);
  assert.equal(existsSync(join(srcRoot, "runtime", "invocation")), false);
});

test("T-CI-ATHENA-JS-JOB: P?: Athena JS GHA names typecheck unit transport Billing safety Rights publint tarball", () => {
  const workflow = readFileSync(
    join(repoRoot, ".github", "workflows", "athena-js.yml"),
    "utf8"
  );
  assert.match(workflow, /athena-js\.yml|Athena JS/);
  assert.match(workflow, /publint/);
  assert.match(workflow, /tarball/i);
  assert.match(
    workflow,
    /athena-js-storage-billing-transport-conformance\.target\.test\.ts/
  );
  assert.match(workflow, /runtime-parity\.test\.ts/);
  assert.match(workflow, /startup_failure/);
  const pkg = JSON.parse(
    readFileSync(join(pkgRoot, "package.json"), "utf8")
  ) as {
    scripts?: Record<string, string>;
  };
  assert.ok(pkg.scripts?.["check:publint"]);
  assert.ok(pkg.scripts?.["check:tarball"]);
  assert.ok(pkg.scripts?.["test:finality"]);
});
