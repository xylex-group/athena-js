import { strict as assert } from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../src/auth/contract/index.ts";
import { MemoryAuthStores } from "../src/auth/local/memory-stores.ts";
import { ATHENA_BILLING_AUTHORIZATION_DENIED } from "../src/billing/errors.ts";
import {
  formatValidationReport,
  validateLocalRuntime,
} from "../src/cli/validate-local.ts";
import { produceAthenaDevtoolsSnapshot } from "../src/devtools/produce/index.ts";
import type { AthenaGatewayClient } from "../src/gateway/client.ts";
import { createAthenaNextHandlers } from "../src/next/data-handlers.ts";
import { createAthenaStorageHandlers } from "../src/next/storage-handlers.ts";
import {
  AthenaAuthorizationResolutionError,
  createLookupSessionFromAuthStores,
} from "../src/runtime/data/athena-session.ts";
import type { AthenaRuntimeAuthSessionStore } from "../src/runtime/data/principal.ts";
import {
  defineAthenaRights,
  getLastAthenaPersistedAuthorizationDiagnostic,
  getLastAthenaRightsResolutionDiagnostic,
  resetAthenaRightsResolutionDiagnostics,
  resolveStoredUserRightsResolution,
  validateAthenaRightsProjection,
} from "../src/runtime/data/rights-resolution.ts";
import {
  bindStorageProvider,
  bindStorageRuntime,
  createStorageRuntime,
} from "../src/storage/runtime/index.ts";
import type {
  AuthorizedStorageOperation,
  StorageObjectProvider,
} from "../src/storage/runtime/types.ts";
import { createClient } from "../src/v3-client.ts";
import { FetchMollieSdk } from "./helpers/fetch-mollie-sdk.ts";

const CUSTOMER_RIGHTS = [
  "storage.get",
  "storage.head",
  "storage.list",
  "storage.put",
  "storage.delete",
  "billing.catalog.read",
] as const;

const ROLE_TABLE = {
  defaultRole: "customer",
  mode: "role" as const,
  rightsByRole: {
    admin: [...CUSTOMER_RIGHTS],
    customer: [...CUSTOMER_RIGHTS],
    unauthorized: [] as const,
  },
};

afterEach(() => {
  resetAthenaRightsResolutionDiagnostics();
});

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

function storesForUser(user: {
  id?: string;
  metadata?: Record<string, unknown> | string | null;
  rights?: readonly string[];
  role?: string | null;
}): AthenaRuntimeAuthSessionStore {
  return {
    async getSessionByToken(token) {
      if (token !== "sess_role") {
        return;
      }
      return {
        active: true,
        expires_at: new Date(Date.now() + 60_000),
        id: "session-role",
        user_id: user.id ?? "user-role",
      };
    },
    async getUserById() {
      return {
        id: user.id ?? "user-role",
        metadata: user.metadata,
        rights: user.rights,
        role: user.role,
      };
    },
  };
}

function recordingProvider(): StorageObjectProvider {
  return {
    async execute(op: AuthorizedStorageOperation) {
      return { data: { key: op.key, op: op.op }, ok: true, status: 200 };
    },
  };
}

test("stored role customer uses mapped rights", () => {
  const resolution = resolveStoredUserRightsResolution(
    { role: "customer" },
    ROLE_TABLE,
    { userId: "u1" }
  );
  assert.equal(resolution.ok, true);
  assert.equal(resolution.source, "role");
  assert.deepEqual(resolution.rights, [...CUSTOMER_RIGHTS]);
  assert.equal(getLastAthenaRightsResolutionDiagnostic()?.source, "role");
});

test("stored role admin uses mapped admin rights", () => {
  const resolution = resolveStoredUserRightsResolution(
    { role: "admin" },
    ROLE_TABLE,
    { userId: "u1" }
  );
  assert.equal(resolution.ok, true);
  assert.equal(resolution.role, "admin");
  assert.deepEqual(resolution.rights, [...CUSTOMER_RIGHTS]);
});

test("unmapped stored role fails closed with role_not_mapped", () => {
  const resolution = resolveStoredUserRightsResolution(
    { role: "admin" },
    {
      defaultRole: "customer",
      rightsByRole: {
        customer: [...CUSTOMER_RIGHTS],
        unauthorized: [],
      },
    },
    { userId: "u1" }
  );
  assert.equal(resolution.ok, false);
  assert.equal(resolution.reason, "role_not_mapped");
  assert.deepEqual(resolution.rights, []);
  const diagnostic = getLastAthenaRightsResolutionDiagnostic();
  assert.equal(diagnostic?.reason, "role_not_mapped");
  assert.equal(diagnostic?.storedRole, "admin");
  assert.equal(diagnostic?.selectedRole, undefined);
  assert.deepEqual(diagnostic?.configuredRoles, ["customer", "unauthorized"]);
});

test("absent stored role uses defaultRole", () => {
  const resolution = resolveStoredUserRightsResolution(
    { role: null },
    ROLE_TABLE,
    { userId: "u1" }
  );
  assert.equal(resolution.ok, true);
  assert.equal(resolution.source, "default-role");
  assert.equal(resolution.role, "customer");
  assert.deepEqual(resolution.rights, [...CUSTOMER_RIGHTS]);
});

test("absent stored role and unmapped defaultRole fails closed", () => {
  const resolution = resolveStoredUserRightsResolution(
    {},
    { defaultRole: "customer", rightsByRole: { unauthorized: [] } },
    { userId: "u1" }
  );
  assert.equal(resolution.ok, false);
  assert.equal(resolution.reason, "default_role_not_mapped");
  assert.deepEqual(resolution.rights, []);
});

test("role mode ignores metadata.rights", () => {
  const resolution = resolveStoredUserRightsResolution(
    {
      metadata: { rights: ["storage.list"] },
      role: "admin",
    },
    {
      defaultRole: "customer",
      mode: "role",
      rightsByRole: {
        customer: [...CUSTOMER_RIGHTS],
        unauthorized: [],
      },
    },
    { userId: "u1" }
  );
  assert.equal(resolution.ok, false);
  assert.equal(resolution.reason, "role_not_mapped");
  assert.deepEqual(resolution.rights, []);
});

test("stored mode ignores rightsByRole", () => {
  const resolution = resolveStoredUserRightsResolution(
    {
      rights: ["storage.list"],
      role: "customer",
    },
    {
      mode: "stored",
      rightsByRole: { customer: [] },
    },
    { userId: "u1" }
  );
  assert.equal(resolution.ok, true);
  assert.equal(resolution.source, "stored");
  assert.deepEqual(resolution.rights, ["storage.list"]);
});

test("explicit unauthorized mapping is mapped empty rights not role_not_mapped", () => {
  const resolution = resolveStoredUserRightsResolution(
    { role: "unauthorized" },
    ROLE_TABLE,
    { userId: "u1" }
  );
  assert.equal(resolution.ok, true);
  assert.equal(resolution.source, "role");
  assert.deepEqual(resolution.rights, []);
});

test("defineAthenaRights parses keys and rejects malformed tokens", () => {
  assert.deepEqual(
    defineAthenaRights(["storage.list"]).map((key) => String(key)),
    ["storage.list"]
  );
  assert.throws(() => defineAthenaRights(["admin:read"]));
});

test("strictRoles validation requires mapped defaultRole", () => {
  const invalid = validateAthenaRightsProjection({
    defaultRole: "customer",
    rightsByRole: { unauthorized: [] },
    strictRoles: true,
  });
  assert.equal(invalid.ok, false);
  assert.match(
    invalid.issues[0]?.message ?? "",
    /defaultRole "customer" is not present in rightsByRole/
  );
  assert.throws(() =>
    createLookupSessionFromAuthStores(storesForUser({ role: "customer" }), {
      authorization: {
        defaultRole: "customer",
        rightsByRole: { unauthorized: [] },
        strictRoles: true,
      },
    })
  );
});

test("devtools snapshot exposes role_not_mapped authorization", async () => {
  resolveStoredUserRightsResolution(
    { role: "admin" },
    {
      defaultRole: "customer",
      rightsByRole: {
        customer: [...CUSTOMER_RIGHTS],
        unauthorized: [],
      },
    },
    { userId: "user-admin" }
  );
  const snapshot = await produceAthenaDevtoolsSnapshot({});
  assert.equal(snapshot.authorization.status, "not-configured");
  assert.ok(
    snapshot.authorization.diagnostics.some(
      (entry) =>
        entry.detail.includes("role_not_mapped") ||
        entry.code === "legacy-permission-map"
    )
  );
  assert.ok(
    snapshot.authorization.catalog.rights.some(
      (entry) => entry.key === "authorization.platform.write"
    )
  );
});

test("validate local reports authorization mapping errors", async () => {
  const report = await validateLocalRuntime({
    inspect: {
      applicationPlan: async () => ({
        applied: [],
        conflicts: [],
        pending: [],
      }),
      authorization: () => ({
        defaultRole: "customer",
        rightsByRole: { unauthorized: [] },
      }),
      authPlan: async () => ({
        appliedCount: 0,
        conflictCount: 0,
        driftCount: 0,
        entries: [],
        hasBlockingDrift: false,
        health: "HEALTHY",
        pendingCount: 0,
      }),
      columns: async () => [
        "credential_id",
        "counter",
        "user_id",
        "public_key",
        "updated_at",
      ],
      passkey: () => ({
        enabled: true,
        origins: ["http://localhost:3010"],
        rpId: "localhost",
        rpName: "test",
      }),
      ping: async () => undefined,
      tables: async () => ["users", "sessions", "passkeys", "verifications"],
      target: async () => ({
        database: "neondb",
        directory: "athena/migrations",
        provider: "postgres/direct",
      }),
    },
  });
  assert.equal(report.ok, false);
  const mapping = report.checks.find(
    (check) => check.id === "auth.authorization.mapping"
  );
  assert.equal(mapping?.status, "error");
  assert.equal(
    mapping?.detail,
    'defaultRole "customer" is not present in rightsByRole'
  );
  const formatted = formatValidationReport(report);
  assert.match(formatted, /Authorization role mapping/);
  assert.match(
    formatted,
    /defaultRole "customer" is not present in rightsByRole/
  );
});

test("unmapped admin is denied storage.list with role_not_mapped", async () => {
  const authorization = {
    defaultRole: "customer",
    rightsByRole: {
      customer: [...CUSTOMER_RIGHTS],
      unauthorized: [],
    },
  };
  const lookup = createLookupSessionFromAuthStores(
    storesForUser({ role: "admin" }),
    { authorization }
  );
  const provider = recordingProvider();
  const runtime = createStorageRuntime({ provider });
  const client = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_role_map",
    gatewayTransport: mockTransport(),
    storage: bindStorageRuntime(bindStorageProvider({}, provider), runtime),
  });
  const handlers = createAthenaStorageHandlers({
    auth: { lookupSession: lookup, mode: "athena-session" },
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
      endpoints: { data: "/api/athena", storage: "/api/athena/storage" },
      protocol: { major: 1, minor: 1 },
      runtime: "next-local",
      runtimeImplementation: "athena-js",
    },
    security: { mode: "authenticated" },
  });
  const response = await handlers.POST(
    new Request("http://localhost/api/athena/storage", {
      body: JSON.stringify({ operation: "list", payload: {} }),
      headers: {
        "content-type": "application/json",
        cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_role`,
        origin: "http://localhost",
      },
      method: "POST",
    })
  );
  const json = (await response.json()) as {
    error?: { missing?: string[]; operation?: string };
    ok?: boolean;
  };
  assert.equal(response.status, 403);
  assert.equal(json.ok, false);
  assert.equal(json.error?.operation, "list");
  assert.deepEqual(json.error?.missing, ["storage.list"]);
  assert.equal(
    getLastAthenaRightsResolutionDiagnostic()?.reason,
    "role_not_mapped"
  );
});

test("mapped customer can storage.list", async () => {
  const lookup = createLookupSessionFromAuthStores(
    storesForUser({ role: "customer" }),
    { authorization: ROLE_TABLE }
  );
  const provider = recordingProvider();
  const runtime = createStorageRuntime({ provider });
  const client = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_role_map",
    gatewayTransport: mockTransport(),
    storage: bindStorageRuntime(bindStorageProvider({}, provider), runtime),
  });
  const handlers = createAthenaStorageHandlers({
    auth: { lookupSession: lookup, mode: "athena-session" },
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
      endpoints: { data: "/api/athena", storage: "/api/athena/storage" },
      protocol: { major: 1, minor: 1 },
      runtime: "next-local",
      runtimeImplementation: "athena-js",
    },
    security: { mode: "authenticated" },
  });
  const response = await handlers.POST(
    new Request("http://localhost/api/athena/storage", {
      body: JSON.stringify({ operation: "list", payload: {} }),
      headers: {
        "content-type": "application/json",
        cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_role`,
        origin: "http://localhost",
      },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
  assert.equal(getLastAthenaRightsResolutionDiagnostic()?.reason, undefined);
});

test("unmapped admin is denied billing products.list with role_not_mapped", async () => {
  const lookup = createLookupSessionFromAuthStores(
    storesForUser({ role: "admin" }),
    {
      authorization: {
        defaultRole: "customer",
        rightsByRole: {
          customer: [...CUSTOMER_RIGHTS],
          unauthorized: [],
        },
      },
    }
  );
  const client = createClient({
    auth: false,
    billing: {
      catalog: { prices: [], products: [] },
      mode: "local",
      providers: {
        mollie: {
          liveKey: "live_role_map",
          sdk: FetchMollieSdk,
          testKey: "test_role_map",
        },
      },
      testMode: true,
    },
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_role_map",
    gatewayTransport: mockTransport(),
  });
  const handlers = createAthenaNextHandlers({
    auth: { lookupSession: lookup, mode: "athena-session" },
    client,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  const response = await handlers.billing.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({ operation: "products.list", payload: {} }),
      headers: {
        "content-type": "application/json",
        cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_role`,
        origin: "http://localhost",
      },
      method: "POST",
    })
  );
  const json = (await response.json()) as {
    error?: { code?: string; missing?: string[]; operation?: string };
  };
  assert.equal(response.status, 403);
  assert.equal(json.error?.code, ATHENA_BILLING_AUTHORIZATION_DENIED);
  assert.equal(json.error?.operation, "products.list");
  assert.deepEqual(json.error?.missing, ["billing.catalog.read"]);
  assert.equal(
    getLastAthenaRightsResolutionDiagnostic()?.reason,
    "role_not_mapped"
  );
});

test("persisted platform_admin assignment is used when users.role is admin and rightsByRole is absent", async () => {
  const stores = new MemoryAuthStores();
  await stores.createUser({
    email: "admin@example.com",
    id: "user-admin",
    name: "Admin",
  });
  await stores.updateUser("user-admin", { role: "admin" });
  await stores.createSession({
    expiresAt: new Date(Date.now() + 60_000),
    id: "sess-admin",
    token: "tok-admin",
    userId: "user-admin",
  });
  const lookup = createLookupSessionFromAuthStores(stores);
  const session = await lookup("tok-admin");
  assert.equal(session?.user.role, "admin");
  assert.equal(
    session?.user.rights?.includes("authorization.platform.write"),
    true
  );
  assert.equal(getLastAthenaRightsResolutionDiagnostic(), undefined);
});

test("persisted assignment resolver faults fail closed instead of role_not_mapped", async () => {
  const lookup = createLookupSessionFromAuthStores({
    async getSessionByToken(token) {
      if (token !== "tok") {
        return;
      }
      return {
        active: true,
        expires_at: new Date(Date.now() + 60_000),
        id: "sess",
        user_id: "user_role",
      };
    },
    async getUserById() {
      return { id: "user_role", role: "admin" };
    },
    async hasAuthorizationAssignment() {
      return true;
    },
    async resolveEffectiveRights() {
      throw new Error("assignment query failed");
    },
  });
  await assert.rejects(
    () => lookup("tok"),
    (error: unknown) => error instanceof AthenaAuthorizationResolutionError
  );
  assert.equal(getLastAthenaRightsResolutionDiagnostic(), undefined);
  assert.equal(
    getLastAthenaPersistedAuthorizationDiagnostic()?.fallback,
    "forbidden"
  );
  assert.equal(
    getLastAthenaPersistedAuthorizationDiagnostic()?.assignment,
    "present"
  );
  assert.match(
    getLastAthenaPersistedAuthorizationDiagnostic()?.error ?? "",
    /assignment query failed/
  );
});

test("billing principal fails closed when persisted authorization resolution throws", async () => {
  const lookup = createLookupSessionFromAuthStores({
    async getSessionByToken(token) {
      if (token !== "sess_role") {
        return;
      }
      return {
        active: true,
        expires_at: new Date(Date.now() + 60_000),
        id: "session-role",
        user_id: "user-role",
      };
    },
    async getUserById() {
      return { id: "user-role", role: "admin" };
    },
    async hasAuthorizationAssignment() {
      return true;
    },
    async resolveEffectiveRights() {
      throw new Error("assignment query failed");
    },
  });
  const client = createClient({
    auth: false,
    billing: {
      catalog: { prices: [], products: [] },
      mode: "local",
      providers: {
        mollie: {
          liveKey: "live_role_map",
          sdk: FetchMollieSdk,
          testKey: "test_role_map",
        },
      },
      testMode: true,
    },
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_role_map",
    gatewayTransport: mockTransport(),
  });
  const handlers = createAthenaNextHandlers({
    auth: { lookupSession: lookup, mode: "athena-session" },
    client,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  const response = await handlers.billing.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({ operation: "products.list", payload: {} }),
      headers: {
        "content-type": "application/json",
        cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_role`,
        origin: "http://localhost",
      },
      method: "POST",
    })
  );
  const json = (await response.json()) as {
    error?: { code?: string; missing?: string[]; operation?: string };
  };
  assert.equal(response.status, 401);
  assert.equal(json.error?.code, "ATHENA_BILLING_UNAUTHENTICATED");
  assert.equal(json.error?.missing, undefined);
  assert.equal(getLastAthenaRightsResolutionDiagnostic(), undefined);
  assert.equal(
    getLastAthenaPersistedAuthorizationDiagnostic()?.fallback,
    "forbidden"
  );
  assert.equal(
    getLastAthenaPersistedAuthorizationDiagnostic()?.assignment,
    "present"
  );
});
