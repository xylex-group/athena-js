/**
 * Target: customer Billing + Storage settings finality (storage HTTP + example Rights).
 * See docs/sdd/xylex/athena-auth-ui-customer-runtime-settings-finality/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../../src/auth/contract/index.ts";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import type { AthenaRuntimeDiscoveryDocument } from "../../src/gateway/discovery-types.ts";
import { parseAthenaRuntimeDiscoveryDocument } from "../../src/gateway/discovery-types.ts";
import { createAthenaStorageHandlers } from "../../src/next/storage-handlers.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";
import {
  BUILTIN_AUTHORIZATION_ROLES,
  PLATFORM_CUSTOMER_ROLE,
} from "../../src/runtime/authorization/templates.ts";
import type { AthenaRuntimeSessionLookup } from "../../src/runtime/data/principal.ts";
import {
  bindStorageProvider,
  bindStorageRuntime,
  createStorageRuntime,
} from "../../src/storage/runtime/index.ts";
import type {
  AuthorizedStorageOperation,
  StorageObjectOp,
  StorageObjectProvider,
  StorageObjectResult,
} from "../../src/storage/runtime/types.ts";
import { createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const exampleRoot = join(
  pkgRoot,
  "..",
  "athena-auth-ui",
  "examples",
  "next-minimal"
);

const DISCOVERY: AthenaRuntimeDiscoveryDocument = {
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
  endpoints: { data: "/api/athena", storage: "/api/athena/storage" },
  protocol: { major: 1, minor: 1 },
  runtime: "next-local",
  runtimeImplementation: "athena-js",
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

function recordingProvider(): StorageObjectProvider & {
  calls: AuthorizedStorageOperation[];
} {
  const calls: AuthorizedStorageOperation[] = [];
  return {
    calls,
    async execute(op: AuthorizedStorageOperation) {
      calls.push(op);
      return {
        data: { key: op.key, objects: [], op: op.op },
        ok: true,
        status: 200,
      };
    },
  };
}

function sessionFor(rights: readonly string[]): AthenaRuntimeSessionLookup {
  return {
    session: { id: "session-a", userId: "user-a" },
    user: { id: "user-a", rights: [...rights] },
  };
}

function handlersFor(rights: readonly string[]) {
  const provider = recordingProvider();
  const runtime = createStorageRuntime({ provider });
  const client = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_crs_storage",
    gatewayTransport: mockTransport(),
    storage: bindStorageRuntime(bindStorageProvider({}, provider), runtime),
  });
  return {
    handlers: createAthenaStorageHandlers({
      auth: {
        lookupSession: async (token) =>
          token === "sess" ? sessionFor(rights) : null,
        mode: "athena-session",
      },
      client,
      discoveryDocument: DISCOVERY,
      security: { mode: "authenticated" },
    }),
    provider,
  };
}

async function call(
  rights: readonly string[],
  operation: StorageObjectOp,
  payload: Record<string, unknown> = {}
) {
  const { handlers, provider } = handlersFor(rights);
  const response = await handlers.POST(
    new Request("http://localhost/api/athena/storage", {
      body: JSON.stringify({ operation, payload }),
      headers: {
        "content-type": "application/json",
        cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess`,
        origin: "http://localhost",
      },
      method: "POST",
    })
  );
  const json = (await response.json()) as StorageObjectResult;
  return { json, provider, response };
}

test("T-CRS-STO-LIST-403: empty-rights list is storage authorization denied", async () => {
  const { json, provider, response } = await call([], "list");
  assert.equal(response.ok, false);
  assert.equal(json.ok, false);
  assert.equal(json.status, 403);
  assert.equal(json.error?.code, "storage_authorization_denied");
  assert.equal(json.error?.errorNumber, 3003);
  assert.equal(provider.calls.length, 0);
});

test("T-CRS-STO-LIST-OK: storage.list principal can list", async () => {
  const { json, provider, response } = await call(["storage.list"], "list");
  assert.equal(response.ok, true);
  assert.equal(json.ok, true);
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0]?.op, "list");
});

test("T-CRS-STO-PUT-403: empty-rights put does not invoke provider", async () => {
  const { json, provider } = await call([], "put", { key: "a.bin" });
  assert.equal(json.ok, false);
  assert.equal(json.status, 403);
  assert.equal(provider.calls.length, 0);
});

test("T-CRS-EXAMPLE: platform customer has storage + billing least privilege", () => {
  const customer = BUILTIN_AUTHORIZATION_ROLES.find(
    (role) => role.key === PLATFORM_CUSTOMER_ROLE
  );
  assert.ok(customer);
  const rights = new Set(customer.rights);
  for (const key of [
    "storage.get",
    "storage.head",
    "storage.list",
    "billing.catalog.read",
    "billing.self.invoices.read",
    "billing.self.checkout.write",
  ] as const) {
    assert.equal(rights.has(parseAthenaRightKey(key)), true, key);
  }
  assert.equal(rights.has(parseAthenaRightKey("storage.put")), false);
  assert.equal(rights.has(parseAthenaRightKey("storage.delete")), false);
  assert.equal(rights.has(parseAthenaRightKey("billing.payments.read")), false);
  assert.equal(
    rights.has(parseAthenaRightKey("billing.sales-invoices.read")),
    false
  );
});

test("T-CRS-SECRETS: next-minimal browser client has no provider secrets", () => {
  const browser = readFileSync(
    join(exampleRoot, "src", "lib", "athena-browser.ts"),
    "utf8"
  );
  assert.equal(/process\.env\.(R2_|MOLLIE_|DATABASE_URL)/.test(browser), false);
});

test("T-CRS-BUCKET-SAFE: discovery may carry storageBucket without credentials", () => {
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
    diagnostics: {
      auth: "embedded",
      database: "postgres-direct",
      passkey: {
        authenticatorAttachment: null,
        configured: false,
        enabled: false,
        onboardingEnabled: false,
        origins: [],
        relatedOrigins: [],
        residentKey: null,
        rpId: null,
        rpName: null,
        timeoutMs: 0,
        userVerification: null,
      },
      runtime: "node",
      storage: "s3",
      storageBucket: "next-minimal",
    },
    endpoints: { data: "/api/athena" },
    protocol: { major: 1, minor: 1 },
    runtime: "next-local",
    runtimeImplementation: "athena-js",
  });
  assert.equal(parsed?.diagnostics?.storage, "s3");
  assert.equal(parsed?.diagnostics?.storageBucket, "next-minimal");
  assert.equal(JSON.stringify(parsed).includes("secret"), false);
});
