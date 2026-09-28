/**
 * SUPERSEDED by test/sdd/athena-js-storage-billing-transport-finality.target.test.ts
 *
 * Former characterization of freeze-HEAD found cases (tagged Storage bytes,
 * duplicate codec, raw PUT, status-remapped codes, generic overlay/Billing
 * errors, no Transport IR). Target suite is the CI source of truth.
 *
 * See docs/sdd/xylex/athena-js-storage-billing-transport-finality/
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../../../src/auth/contract/index.ts";
import { AthenaBillingProviderRequestError } from "../../../src/billing/errors.ts";
import { createBrowserBillingTransport } from "../../../src/billing/runtime/browser-transport.ts";
import type { AthenaGatewayClient } from "../../../src/gateway/client.ts";
import {
  ATHENA_NEXT_RUNTIME_PROTOCOL,
  ATHENA_RUNTIME_PROTOCOL,
} from "../../../src/gateway/protocol.ts";
import { createAthenaBillingHandlers } from "../../../src/next/billing-handlers.ts";
import { getAthenaClientInternals } from "../../../src/runtime/client-internals.ts";
import {
  createBrowserStorageTransport,
  isAthenaStorageBytesEnvelope,
  wrapStorageModuleWithRuntime,
} from "../../../src/storage/runtime/index.ts";
import type {
  AuthorizedStorageOperation,
  StorageRuntime,
} from "../../../src/storage/runtime/types.ts";
import { createClient } from "../../../src/v3-client.ts";
import { FetchMollieSdk } from "../../helpers/fetch-mollie-sdk.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..", "..");
const srcRoot = join(pkgRoot, "src");

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

function storageOp(
  partial: Omit<AuthorizedStorageOperation, "principal">
): AuthorizedStorageOperation {
  return {
    ...partial,
    principal: {
      authenticated: true,
      grants: [],
      rights: [],
      userId: "baseline-storage",
    },
  };
}

function packageExports(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
    exports?: Record<string, unknown>;
  };
}

test("B-ST-TAGGED-OBJECT: P?: browser Storage success returns tagged bytes envelope not Uint8Array", async () => {
  const browserSrc = readSrc("storage/runtime/browser-transport.ts");
  assert.equal(browserSrc.includes("reviveAthenaStorageData"), false);
  assert.match(browserSrc, /storageOkResult\(json\?\.data \?\? json\)/);

  const tagged = {
    bytes: "AP8=",
    encoding: "base64",
    kind: "athena.storage.bytes",
  };
  const transport = createBrowserStorageTransport({
    endpoints: { storage: "/api/athena/storage" },
    fetch: async () => Response.json({ data: tagged, ok: true, status: 200 }),
  });
  const result = await transport.execute(
    storageOp({ key: "hostile.bin", op: "get" })
  );
  assert.equal(result.ok, true);
  assert.equal(result.data instanceof Uint8Array, false);
  assert.equal(isAthenaStorageBytesEnvelope(result.data), true);
  assert.deepEqual(result.data, tagged);
});

test("B-ST-DUP-B64: P?: browser Storage transport defines its own bytesToBase64", () => {
  const browserSrc = readSrc("storage/runtime/browser-transport.ts");
  assert.match(browserSrc, /function bytesToBase64\(/);
  assert.match(browserSrc, /btoa\(/);
  assert.equal(browserSrc.includes("encodeAthenaStorageBytes"), false);
  assert.equal(browserSrc.includes("bytes-envelope"), false);
  const ssot = readSrc("storage/runtime/bytes-envelope.ts");
  assert.match(ssot, /export function encodeAthenaStorageBytes/);
});

test("B-ST-PUT-RAW: P?: browser Storage put encodes body as raw base64 string", async () => {
  const posts: unknown[] = [];
  const transport = createBrowserStorageTransport({
    endpoints: { storage: "/api/athena/storage" },
    fetch: async (_input, init) => {
      posts.push(JSON.parse(String(init?.body ?? "{}")));
      return Response.json({ data: { key: "k" }, ok: true, status: 200 });
    },
  });
  await transport.execute(
    storageOp({
      body: new Uint8Array([1, 2, 3]),
      contentType: "application/octet-stream",
      key: "k.bin",
      metadata: { a: "1" },
      op: "put",
    })
  );
  const envelope = posts[0] as {
    operation?: string;
    payload?: { body?: unknown };
  };
  assert.equal(envelope.operation, "put");
  assert.equal(typeof envelope.payload?.body, "string");
  assert.equal(isAthenaStorageBytesEnvelope(envelope.payload?.body), false);
});

test("B-ST-STATUS-CODE: P?: browser Storage remaps error code from HTTP status not envelope code", async () => {
  async function remap(input: {
    code: string;
    errorNumber: number;
    status: number;
  }) {
    const transport = createBrowserStorageTransport({
      endpoints: { storage: "/api/athena/storage" },
      fetch: async () =>
        Response.json(
          {
            error: {
              code: input.code,
              errorNumber: input.errorNumber,
              message: "object missing",
            },
            ok: false,
            status: input.status,
          },
          { status: input.status }
        ),
    });
    return transport.execute(storageOp({ key: "missing.bin", op: "get" }));
  }

  const notFound = await remap({
    code: "storage_file_not_found",
    errorNumber: 3005,
    status: 404,
  });
  assert.equal(notFound.ok, false);
  assert.equal(notFound.status, 404);
  assert.equal(notFound.error?.errorNumber, 3005);
  assert.equal(notFound.error?.code, "storage_internal");

  const invalid = await remap({
    code: "storage_invalid_request",
    errorNumber: 3000,
    status: 400,
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.error?.errorNumber, 3000);
  assert.equal(invalid.error?.code, "storage_internal");

  const browserSrc = readSrc("storage/runtime/browser-transport.ts");
  assert.equal(browserSrc.includes("json?.error?.code"), false);
  assert.match(browserSrc, /status === 401/);
  assert.match(browserSrc, /"storage_internal"/);
});

test("B-ST-FIELD-FORWARD: P?: browser Storage payload still forwards key body contentType metadata prefix cursor limit", async () => {
  const posts: unknown[] = [];
  const transport = createBrowserStorageTransport({
    endpoints: { storage: "/api/athena/storage" },
    fetch: async (_input, init) => {
      posts.push(JSON.parse(String(init?.body ?? "{}")));
      return Response.json({ data: { objects: [] }, ok: true, status: 200 });
    },
  });
  await transport.execute(
    storageOp({
      cursor: "after-1",
      limit: 25,
      op: "list",
      prefix: "docs/",
    })
  );
  const list = posts[0] as { payload?: Record<string, unknown> };
  assert.equal(list.payload?.prefix, "docs/");
  assert.equal(list.payload?.cursor, "after-1");
  assert.equal(list.payload?.limit, 25);

  await transport.execute(
    storageOp({
      body: new Uint8Array([9]),
      contentType: "image/png",
      key: "a.png",
      metadata: { k: "v" },
      op: "put",
    })
  );
  const put = posts[1] as { payload?: Record<string, unknown> };
  assert.equal(put.payload?.key, "a.png");
  assert.equal(typeof put.payload?.body, "string");
  assert.equal(put.payload?.contentType, "image/png");
  assert.deepEqual(put.payload?.metadata, { k: "v" });
});

test("B-ST-ASBYTES: P?: keep-green T-BR-EQUIV-BYTES still proves bytes via asBytes helper", () => {
  const keepGreen = readFileSync(
    join(here, "..", "athena-js-browser-storage-convergence.target.test.ts"),
    "utf8"
  );
  assert.match(keepGreen, /function asBytes\(/);
  assert.match(keepGreen, /T-BR-EQUIV-BYTES/);
  assert.match(keepGreen, /asBytes\(/);
});

test("B-ST-NO-CTOR: P?: createStorageClient is not a package export", async () => {
  const mod = await import("../../../src/index.ts");
  assert.equal("createStorageClient" in mod, false);
  assert.equal(packageExports()["./storage-client"], undefined);
});

test("B-ST-OVERLAY-ERROR: P?: Storage overlay throws generic Error on runtime deny", async () => {
  const overlays = readSrc("storage/runtime/overlays.ts");
  assert.match(overlays, /throw new Error\(result\.error\?\.message/);

  const runtime: StorageRuntime = {
    async execute() {
      return {
        error: {
          code: "storage_file_not_found",
          errorNumber: 3005,
          message: "object missing",
        },
        ok: false,
        status: 404,
      };
    },
    provider: {
      async execute() {
        return { ok: true, status: 200 };
      },
    },
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
      assert.equal(error.name, "Error");
      assert.equal(error.message, "object missing");
      assert.equal("errorNumber" in error, false);
      assert.equal("code" in error, false);
      return true;
    }
  );
});

test("B-BIL-GENERIC: P?: browser Billing throws Error with message only", async () => {
  const src = readSrc("billing/runtime/browser-transport.ts");
  assert.match(src, /throw new Error\(/);
  assert.equal(src.includes("billingErrorFromTransport"), false);
  assert.equal(
    existsSync(join(srcRoot, "billing", "runtime", "http-error.ts")),
    false
  );

  const transport = createBrowserBillingTransport({
    endpoints: { billing: "/api/athena/billing" },
    fetch: async () =>
      Response.json(
        {
          error: {
            code: "ATHENA_BILLING_AUTHORIZATION_DENIED",
            errorNumber: 4014,
            message: "payment failed",
            missing: ["billing.payments.write"],
          },
          ok: false,
          status: 403,
        },
        { status: 403 }
      ),
  });
  await assert.rejects(
    () =>
      transport.payments.create({
        amount: { currency: "EUR", value: "10.00" },
        description: "Order",
        idempotencyKey: "idem-1",
        redirectUrl: "https://example.com/return",
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "Error");
      assert.equal(error.message, "payment failed");
      assert.equal("code" in error, false);
      assert.equal("errorNumber" in error, false);
      assert.equal("kind" in error, false);
      assert.equal("missing" in error, false);
      return true;
    }
  );
});

test("B-BIL-COLLAPSE: P?: Billing HTTP encodeBillingError collapses provider errors to INTERNAL", async () => {
  const handlerSrc = readSrc("next/billing-handlers.ts");
  assert.match(handlerSrc, /ATHENA_BILLING_INTERNAL/);
  assert.match(handlerSrc, /isAthenaBillingAuthorizationError/);
  assert.match(handlerSrc, /isAthenaBillingCapabilityError/);
  assert.equal(
    handlerSrc.includes("isAthenaBillingProviderRequestError"),
    false
  );

  const client = createClient({
    auth: false,
    billing: {
      mode: "local",
      providers: {
        mollie: {
          liveKey: "live_athena_finality_baseline",
          sdk: FetchMollieSdk,
          testKey: "test_athena_finality_baseline",
        },
      },
      testMode: true,
    },
    databaseUrl:
      "postgresql://postgres@127.0.0.1:5432/athena_finality_baseline",
    gatewayTransport: mockTransport(),
  });
  const internals = getAthenaClientInternals(client);
  assert.ok(internals?.billingRuntime);
  internals.billingRuntime.execute = async () => {
    throw new AthenaBillingProviderRequestError({
      kind: "not_found",
      message: "payment not found",
      provider: "mollie",
      retry: "never",
      status: 404,
    });
  };

  const handlers = createAthenaBillingHandlers({
    client,
    discoveryDocument: {
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
        billing: "/api/athena/billing",
        data: "/api/athena",
      },
      protocol: { major: 1, minor: 1 },
      runtime: "next-local",
      runtimeImplementation: "athena-js",
    },
    security: { mode: "trusted" },
  });
  const response = await handlers.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({
        operation: "payments.get",
        payload: { id: "tr_missing" },
      }),
      headers: {
        "content-type": "application/json",
        cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_bill`,
        origin: "http://localhost",
      },
      method: "POST",
    })
  );
  const json = (await response.json()) as {
    error?: { code?: string; kind?: string };
    ok?: boolean;
    status?: number;
  };
  assert.equal(response.status, 500);
  assert.equal(json.ok, false);
  assert.equal(json.error?.code, "ATHENA_BILLING_INTERNAL");
  assert.equal(json.error?.kind, undefined);
  assert.equal(json.status, 500);
});

test("B-BIL-NO-WEBHOOKS: P?: browser Billing transport has no webhooks port", () => {
  const transport = createBrowserBillingTransport({
    endpoints: { billing: "/api/athena/billing" },
    fetch: async () => new Response("{}", { status: 200 }),
  });
  assert.equal("webhooks" in transport, false);
  assert.equal("payments" in transport, true);
  assert.equal("customers" in transport, true);
  const handlers = readSrc("next/billing-handlers.ts");
  assert.match(handlers, /"webhooks\.list"/);
  assert.match(handlers, /"webhooks\.create"/);
});

test("B-BIL-NO-CTOR: P?: createBillingClient is not a package export", async () => {
  const mod = await import("../../../src/index.ts");
  assert.equal("createBillingClient" in mod, false);
  assert.equal(packageExports()["./billing-client"], undefined);
});

test("B-BIL-ENVELOPE-OMIT: P?: browser Billing success returns json.data (omitted data is undefined)", async () => {
  const transport = createBrowserBillingTransport({
    endpoints: { billing: "/api/athena/billing" },
    fetch: async () => Response.json({ ok: true, status: 200 }),
  });
  const data = await transport.payments.get({ id: "tr_1" });
  assert.equal(data, undefined);
});

test("B-TR-NO-IR: P?: AthenaHttpTransportIR factory does not exist", () => {
  assert.equal(existsSync(join(srcRoot, "runtime", "transport")), false);
  const blob = joinedSources(srcRoot);
  assert.equal(blob.includes("createAthenaHttpTransportIR"), false);
  assert.equal(blob.includes("validateAthenaTransportIR"), false);
  assert.equal(blob.includes("AthenaHttpTransportIR"), false);
});

test("B-TR-DUP-FETCH: P?: Storage and Billing browser transports each implement URL probe and fetch", () => {
  const storage = readSrc("storage/runtime/browser-transport.ts");
  const billing = readSrc("billing/runtime/browser-transport.ts");
  assert.match(storage, /function joinPath\(/);
  assert.match(billing, /function joinPath\(/);
  assert.match(storage, /method: "GET"/);
  assert.match(billing, /method: "GET"/);
  assert.match(storage, /const fetchImpl = options\?\.fetch \?\? fetch/);
  assert.match(billing, /const fetchImpl = options\?\.fetch \?\? fetch/);
  assert.match(storage, /credentials: "same-origin"/);
  assert.match(billing, /credentials: "same-origin"/);
});

test("B-TR-ABS-SAME-ORIGIN: P?: absolute Storage and Billing URLs still send credentials same-origin", async () => {
  const storageCreds: Array<RequestCredentials | undefined> = [];
  const storage = createBrowserStorageTransport({
    endpoints: { storage: "https://files.example.com/api/athena/storage" },
    fetch: async (_input, init) => {
      storageCreds.push(init?.credentials);
      return Response.json({ data: {}, ok: true, status: 200 });
    },
  });
  await storage.execute(storageOp({ key: "k", op: "head" }));
  assert.equal(storageCreds[0], "same-origin");

  const billingCreds: Array<RequestCredentials | undefined> = [];
  const billing = createBrowserBillingTransport({
    endpoints: { billing: "https://pay.example.com/api/athena/billing" },
    fetch: async (_input, init) => {
      billingCreds.push(init?.credentials);
      return Response.json({ data: { id: "tr_1" }, ok: true, status: 200 });
    },
  });
  await billing.payments.get({ id: "tr_1" });
  assert.equal(billingCreds[0], "same-origin");
});

test("B-TR-PROTOCOL: P?: discovery is protocol 1.0 / Next 1.1 with no 1.2 topology.transports", () => {
  assert.deepEqual(ATHENA_RUNTIME_PROTOCOL, { major: 1, minor: 0 });
  assert.deepEqual(ATHENA_NEXT_RUNTIME_PROTOCOL, { major: 1, minor: 1 });
  const protocolSrc = readSrc("gateway/protocol.ts");
  assert.equal(protocolSrc.includes("topology.transports"), false);
  assert.equal(protocolSrc.includes("minor: 2"), false);
});
