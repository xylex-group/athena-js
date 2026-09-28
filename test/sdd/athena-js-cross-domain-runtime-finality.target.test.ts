/**
 * Target: cross-domain runtime finality matrix + discovery + transport guardrails.
 * GREEN after joint matrix + discovery caps + transport guardrails.
 * Former characterization baseline retired to
 * test/sdd/superseded/athena-js-cross-domain-runtime-finality.baseline.superseded.ts.
 * See docs/sdd/xylex/athena-js-cross-domain-runtime-finality/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../../src/auth/contract/index.ts";
import {
  ATHENA_BILLING_AUTHORIZATION_DENIED,
  AthenaBillingAuthorizationError,
} from "../../src/billing/errors.ts";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import { parseAthenaRuntimeDiscoveryDocument } from "../../src/gateway/discovery-types.ts";
import { createAthenaNextHandlers } from "../../src/next/data-handlers.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";
import { missingRequiredRights } from "../../src/rights/matching.ts";
import { getAthenaClientInternals } from "../../src/runtime/client-internals.ts";
import { normalizeAthenaPrincipal } from "../../src/runtime/data/principal.ts";
import {
  ATHENA_CROSS_DOMAIN_RUNTIME_FINALITY,
  ATHENA_RUNTIME_FINALITY_DEFERRED,
  HTTP_HANDLER_RELATIVE_PATHS,
  TRANSPORT_RELATIVE_PATHS,
} from "../../src/runtime/finality/matrix.ts";
import {
  bindStorageProvider,
  bindStorageRuntime,
  createStorageRuntime,
} from "../../src/storage/runtime/index.ts";
import type {
  AuthorizedStorageOperation,
  StorageObjectProvider,
} from "../../src/storage/runtime/types.ts";
import { createClient } from "../../src/v3-client.ts";
import { FetchMollieSdk } from "../helpers/fetch-mollie-sdk.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

const REQUIRED_HTTP_HANDLER_PATHS = [
  "next/storage-handlers.ts",
  "next/billing-handlers.ts",
  "gateway/server/adapter.ts",
] as const;

const REQUIRED_TRANSPORT_PATHS = [
  "billing/runtime/browser-transport.ts",
  "storage/runtime/browser-transport.ts",
  "next/client.ts",
  "browser.ts",
  "react-native/client.ts",
] as const;

const TRANSPORT_FORBIDDEN = [
  "missingRequiredRights",
  "authorizeStorageOperation",
  "authorizeBillingOperation",
  "prepareBillingCommand",
  "createOfficialMollieAdapter",
  "s3-provider",
  "createS3StorageProvider",
] as const;

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

function recordingProvider(): StorageObjectProvider & {
  calls: AuthorizedStorageOperation[];
} {
  const calls: AuthorizedStorageOperation[] = [];
  return {
    calls,
    async execute(op: AuthorizedStorageOperation) {
      calls.push(op);
      return { data: { key: op.key, op: op.op }, ok: true, status: 200 };
    },
  };
}

function memoryS3() {
  return {
    async deleteObject() {
      return {};
    },
    async getObject() {
      throw new Error("The specified key does not exist.");
    },
    async headObject() {
      return {};
    },
    async listObjectsV2() {
      return { Contents: [] };
    },
    async putObject() {
      return {};
    },
  };
}

function createServerClient() {
  return createClient({
    auth: false,
    billing: {
      mode: "local",
      providers: {
        mollie: {
          liveKey: "live_athena_finality",
          sdk: FetchMollieSdk,
          testKey: "test_athena_finality",
        },
      },
      testMode: true,
    },
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_finality",
    gatewayTransport: mockTransport(),
  });
}

function createStorageClient(provider: StorageObjectProvider) {
  const runtime = createStorageRuntime({ provider });
  return {
    client: createClient({
      auth: false,
      databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_finality",
      gatewayTransport: mockTransport(),
      storage: bindStorageRuntime(bindStorageProvider({}, provider), runtime),
    }),
    runtime,
  };
}

test("T-FIN-MATRIX: P?: cross-domain finality matrix covers Data Auth Storage/R2 Storage/S3 Billing/Mollie", () => {
  const expected = [
    {
      browserSecrets: "none",
      browserTransport: "/api/athena",
      constructor: "createClient",
      domain: "data",
      httpAdapter: "createAthenaDataHandlers",
      principal: "AthenaPrincipal",
      rights: "AthenaRightKey",
      serverTransport: "postgres-direct",
    },
    {
      browserSecrets: "none",
      browserTransport: "/api/auth",
      constructor: "createClient",
      domain: "auth",
      httpAdapter: "createAthenaAuthHandlers",
      principal: "AthenaPrincipal",
      rights: "AthenaRightKey",
      serverTransport: "embedded-auth",
    },
    {
      browserSecrets: "none",
      browserTransport: "/api/athena/storage",
      constructor: "createClient",
      domain: "storage-r2",
      httpAdapter: "createAthenaStorageHandlers",
      principal: "AthenaPrincipal",
      rights: "AthenaRightKey",
      serverTransport: "r2",
    },
    {
      browserSecrets: "none",
      browserTransport: "/api/athena/storage",
      constructor: "createClient",
      domain: "storage-s3",
      httpAdapter: "createAthenaStorageHandlers",
      principal: "AthenaPrincipal",
      rights: "AthenaRightKey",
      serverTransport: "s3",
    },
    {
      browserSecrets: "none",
      browserTransport: "/api/athena/billing",
      constructor: "createClient",
      domain: "billing-mollie",
      httpAdapter: "createAthenaBillingHandlers",
      principal: "AthenaPrincipal",
      rights: "AthenaRightKey",
      serverTransport: "mollie",
    },
  ] as const;
  assert.equal(ATHENA_CROSS_DOMAIN_RUNTIME_FINALITY.length, expected.length);
  for (const [index, row] of expected.entries()) {
    const actual = ATHENA_CROSS_DOMAIN_RUNTIME_FINALITY[index];
    assert.ok(actual);
    assert.equal(actual.domain, row.domain);
    assert.equal(actual.constructor, row.constructor);
    assert.equal(actual.principal, row.principal);
    assert.equal(actual.rights, row.rights);
    assert.equal(actual.browserSecrets, row.browserSecrets);
    assert.equal(actual.browserTransport, row.browserTransport);
    assert.equal(actual.httpAdapter, row.httpAdapter);
    assert.equal(actual.serverTransport, row.serverTransport);
    assert.ok(actual.runtime.length > 0);
  }
  assert.deepEqual(
    [...HTTP_HANDLER_RELATIVE_PATHS],
    [...REQUIRED_HTTP_HANDLER_PATHS]
  );
  assert.deepEqual(
    ATHENA_RUNTIME_FINALITY_DEFERRED.map((row) => row.domain),
    ["chat"]
  );
  assert.equal(
    ATHENA_CROSS_DOMAIN_RUNTIME_FINALITY.some((row) => row.domain === "chat"),
    false
  );
});

test("T-FIN-ONE-CLIENT: P?: one createClient and no domain client constructors", async () => {
  const mod = await import("../../src/index.ts");
  assert.equal("createClient" in mod, true);
  assert.equal("createStorageClient" in mod, false);
  assert.equal("createBillingClient" in mod, false);
  assert.equal("createPrincipalClient" in mod, false);
  assert.equal("createRightsClient" in mod, false);
  const pkg = JSON.parse(
    readFileSync(join(pkgRoot, "package.json"), "utf8")
  ) as { exports?: Record<string, unknown> };
  assert.equal(pkg.exports?.["./authority"] == null, true);
  assert.equal(pkg.exports?.["./finality"] == null, true);
  assert.equal(pkg.exports?.["./runtime/finality"] == null, true);
});

test("T-FIN-ONE-PRINCIPAL: P?: AthenaPrincipal is the only principal model and rights are AthenaRightKey", () => {
  const blob = collectTsFiles(join(srcRoot, "runtime"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  assert.equal(blob.includes("AthenaHttpPrincipal"), false);
  assert.match(
    readSrc("runtime/data/principal.ts"),
    /rights:\s*readonly AthenaRightKey\[\]/
  );
  assert.match(
    readSrc("runtime/data/principal.ts"),
    /grants:\s*readonly string\[\]/
  );
  const parsed = parseAthenaRightKey("billing.payments.write");
  assert.equal(String(parsed), "billing.payments.write");
  const principal = normalizeAthenaPrincipal({
    authenticated: true,
    grants: ["billing.payments.write", "storage.put"],
    rights: ["billing.payments.read"],
    userId: "user_finality_grants",
  });
  assert.deepEqual(
    [...principal.grants],
    ["billing.payments.write", "storage.put"]
  );
  const write = parseAthenaRightKey("billing.payments.write");
  const put = parseAthenaRightKey("storage.put");
  assert.deepEqual(missingRequiredRights(principal.rights, [write]), [write]);
  assert.deepEqual(missingRequiredRights(principal.rights, [put]), [put]);
});

test("T-FIN-HTTP-NO-MINT: P?: HTTP handlers resolve principals and do not mint identity from headers", () => {
  for (const rel of REQUIRED_HTTP_HANDLER_PATHS) {
    const src = readSrc(rel);
    assert.match(src, /resolveAthenaRuntimePrincipal/, rel);
    assert.equal(src.includes("x-user-id"), false, rel);
    assert.equal(src.includes('"x-rights"'), false, rel);
    assert.equal(
      /principal:\s*\{\s*authenticated:\s*true/.test(src),
      false,
      rel
    );
    assert.equal(/userId\s*[:=][\s\S]{0,80}x-user-id/.test(src), false, rel);
    assert.equal(/rights\s*[:=][\s\S]{0,80}x-rights/.test(src), false, rel);
  }
  const dataHandlers = readSrc("next/data-handlers.ts");
  assert.equal(dataHandlers.includes("x-user-id"), false);
  assert.equal(dataHandlers.includes('"x-rights"'), false);
  assert.equal(
    /principal:\s*\{\s*authenticated:\s*true/.test(dataHandlers),
    false
  );
  const authHttp = collectTsFiles(join(srcRoot, "auth", "http"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  assert.equal(authHttp.includes("resolveAthenaRuntimePrincipal"), false);
  assert.equal(authHttp.includes("runtime/authority"), false);
  assert.equal(authHttp.includes("x-user-id"), false);
  assert.equal(authHttp.includes('"x-rights"'), false);
});

test("T-FIN-TRANSPORT-NO-AUTHZ: P?: transport layers do not own Rights safety or provider SDKs", () => {
  const listed = new Set<string>(TRANSPORT_RELATIVE_PATHS);
  for (const rel of REQUIRED_TRANSPORT_PATHS) {
    assert.equal(listed.has(rel), true, rel);
    assert.equal(existsSync(join(srcRoot, rel)), true, rel);
  }
  for (const rel of [
    ...REQUIRED_HTTP_HANDLER_PATHS,
    ...REQUIRED_TRANSPORT_PATHS,
  ]) {
    const src = readSrc(rel);
    for (const token of TRANSPORT_FORBIDDEN) {
      assert.equal(src.includes(token), false, `${rel} ${token}`);
    }
    assert.equal(src.includes('from "pg"'), false, rel);
    assert.equal(src.includes("createR2StorageProvider"), false, rel);
  }
});

test("T-FIN-DISCOVERY: P?: discovery advertises data auth storage billing from materialized runtimes including s3", async () => {
  const types = readSrc("gateway/discovery-types.ts");
  assert.match(types, /storage\?:\s*boolean/);
  assert.match(types, /billing\?:\s*boolean/);
  assert.match(
    types,
    /storage:\s*"http"\s*\|\s*"r2"\s*\|\s*"local"\s*\|\s*"s3"\s*\|\s*"none"/
  );

  const withRuntimes = createAthenaNextHandlers({
    client: createServerClient(),
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  const advertised = (await (
    await withRuntimes.billing.GET(
      new Request("http://localhost/api/athena/billing")
    )
  ).json()) as {
    capabilities?: { billing?: boolean; data?: boolean; storage?: boolean };
    diagnostics?: { storage?: string };
    endpoints?: { billing?: string; data?: string; storage?: string };
  };
  assert.equal(advertised.endpoints?.data, "/api/athena");
  assert.equal(advertised.endpoints?.billing, "/api/athena/billing");
  assert.equal(advertised.capabilities?.data, true);
  assert.equal(advertised.capabilities?.billing, true);
  const parsed = parseAthenaRuntimeDiscoveryDocument(advertised);
  assert.ok(parsed);
  assert.equal(parsed?.capabilities.billing, true);

  const without = createAthenaNextHandlers({
    client: createClient({
      auth: false,
      databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_finality",
      gatewayTransport: mockTransport(),
    }),
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  const empty = (await (
    await without.billing.GET(
      new Request("http://localhost/api/athena/billing")
    )
  ).json()) as {
    capabilities?: { billing?: boolean; storage?: boolean };
    endpoints?: { billing?: string; storage?: string };
  };
  assert.equal(empty.endpoints?.billing, undefined);
  assert.equal(empty.endpoints?.storage, undefined);
  assert.equal(empty.capabilities?.billing, false);
  assert.equal(empty.capabilities?.storage, false);

  const s3Client = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_finality",
    gatewayTransport: mockTransport(),
    storage: {
      bucket: "athena-finality",
      provider: "s3",
      s3: memoryS3(),
    },
  });
  const s3Handlers = createAthenaNextHandlers({
    client: s3Client,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  const s3Live = (await (
    await s3Handlers.storage.GET(
      new Request("http://localhost/api/athena/storage")
    )
  ).json()) as {
    capabilities?: { storage?: boolean };
    diagnostics?: { storage?: string };
    endpoints?: { storage?: string };
  };
  assert.equal(s3Live.endpoints?.storage, "/api/athena/storage");
  assert.equal(s3Live.capabilities?.storage, true);
  assert.equal(s3Live.diagnostics?.storage, "s3");
  const s3Doc = parseAthenaRuntimeDiscoveryDocument(s3Live);
  assert.equal(s3Doc?.diagnostics?.storage, "s3");
  assert.equal(s3Doc?.capabilities.storage, true);
});

test("T-FIN-EQUIV: P?: direct and HTTP Billing and Storage share authorization outcomes", async () => {
  const client = createServerClient();
  const principal = normalizeAthenaPrincipal({
    authenticated: true,
    grants: ["billing.payments.write"],
    rights: ["billing.payments.read"],
    userId: "user_finality",
  });
  const runtime = getAthenaClientInternals(client)?.billingRuntime;
  assert.ok(runtime?.execute);
  await assert.rejects(
    () =>
      runtime.execute(
        "payments.create",
        {
          amount: { currency: "EUR", value: "10.00" },
          description: "Order 42",
          idempotencyKey: "idem-finality",
          redirectUrl: "https://example.com/return",
        },
        principal
      ),
    AthenaBillingAuthorizationError
  );
  const handlers = createAthenaNextHandlers({
    auth: {
      lookupSession: async (token) =>
        token === "sess_finality"
          ? {
              session: { id: "s", userId: "user_finality" },
              user: {
                id: "user_finality",
                rights: ["billing.payments.read"],
              },
            }
          : null,
      mode: "athena-session",
    },
    client,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  const http = await handlers.billing.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({
        operation: "payments.create",
        payload: {
          amount: { currency: "EUR", value: "10.00" },
          description: "Order 42",
          idempotencyKey: "idem-finality-http",
          redirectUrl: "https://example.com/return",
        },
      }),
      headers: {
        "content-type": "application/json",
        cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_finality`,
        origin: "http://localhost",
        "x-rights": "billing.payments.write",
        "x-user-id": "forged-admin",
      },
      method: "POST",
    })
  );
  const json = (await http.json()) as { error?: { code?: string } };
  assert.equal(http.status, 403);
  assert.equal(json.error?.code, ATHENA_BILLING_AUTHORIZATION_DENIED);

  const provider = recordingProvider();
  const storage = createStorageClient(provider);
  const storagePrincipal = normalizeAthenaPrincipal({
    authenticated: true,
    grants: ["storage.put"],
    rights: ["storage.get"],
    userId: "user_finality_storage",
  });
  const denied = await storage.runtime.execute(
    {
      body: new TextEncoder().encode("x"),
      key: "finality.bin",
      op: "put",
    },
    storagePrincipal
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.error?.errorNumber, 3003);
  assert.equal(provider.calls.length, 0);

  const storageHandlers = createAthenaNextHandlers({
    auth: {
      lookupSession: async (token) =>
        token === "sess_storage"
          ? {
              session: {
                id: "sess_storage",
                userId: "user_finality_storage",
              },
              user: {
                id: "user_finality_storage",
                rights: ["storage.get"],
              },
            }
          : null,
      mode: "athena-session",
    },
    client: storage.client,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  const storageHttp = await storageHandlers.storage.POST(
    new Request("http://localhost/api/athena/storage", {
      body: JSON.stringify({
        operation: "put",
        payload: {
          body: Buffer.from("x").toString("base64"),
          key: "finality.bin",
        },
      }),
      headers: {
        "content-type": "application/json",
        cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_storage`,
        origin: "http://localhost",
        "x-rights": "storage.put",
        "x-user-id": "forged-admin",
      },
      method: "POST",
    })
  );
  const storageJson = (await storageHttp.json()) as {
    error?: { errorNumber?: number };
    ok?: boolean;
  };
  assert.equal(storageHttp.ok, false);
  assert.equal(storageJson.ok, false);
  assert.equal(storageJson.error?.errorNumber, 3003);
  assert.equal(provider.calls.length, 0);
});

test("T-FIN-BROWSER-GRAPH: P?: browser source graph has no database provider R2 S3 Mollie or session-store secrets", () => {
  const files = [
    "browser.ts",
    "v3-client-core.ts",
    "next/client.ts",
    "react-native/client.ts",
    "billing/runtime/browser-transport.ts",
    "storage/runtime/browser-transport.ts",
  ];
  const blob = files.map((rel) => readSrc(rel)).join("\n");
  assert.equal(blob.includes("createOfficialMollieAdapter"), false);
  assert.equal(blob.includes("runtime/providers/s3-provider"), false);
  assert.equal(blob.includes("runtime/providers/r2-provider"), false);
  assert.equal(blob.includes("auth/local/runtime"), false);
  assert.equal(blob.includes("auth/local/database"), false);
  assert.equal(blob.includes('import "server-only"'), false);
  assert.equal(blob.includes('from "pg"'), false);
  assert.equal(/testKey|liveKey/.test(blob), false);
  assert.equal(/secretAccessKey|AWS_SECRET_ACCESS_KEY/.test(blob), false);
  assert.equal(blob.includes("next/billing-handlers"), false);
  assert.equal(blob.includes("next/storage-handlers"), false);
});

test("T-FIN-AUDIT: P?: browser bundle audit forbids Mollie keys S3 provider and auth local runtime", () => {
  const audit = readFileSync(
    join(pkgRoot, "scripts", "audit-browser-bundle-safety.mjs"),
    "utf8"
  );
  assert.match(audit, /createOfficialMollieAdapter/);
  assert.match(audit, /testKey/);
  assert.match(audit, /liveKey/);
  assert.match(audit, /s3 storage provider|s3-provider/);
  assert.match(
    audit,
    /embedded auth local runtime|auth\/local\/(?:runtime|database)/
  );
  assert.match(audit, /billing HTTP handlers|next\/billing-handlers/);
});
