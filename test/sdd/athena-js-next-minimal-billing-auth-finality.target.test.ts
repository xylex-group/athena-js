/**
 * Target: next-minimal Billing authorization + HTTP error-contract finality.
 * See docs/sdd/xylex/athena-next-minimal-billing-auth-finality/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ATHENA_AUTH_SESSION_COOKIE_NAME } from "../../src/auth/contract/index.ts";
import {
  ATHENA_BILLING_AUTHORIZATION_DENIED,
  isAthenaBillingAuthorizationError,
} from "../../src/billing/errors.ts";
import { billingErrorFromTransport } from "../../src/billing/runtime/http-error.ts";
import type { AthenaGatewayClient } from "../../src/gateway/client.ts";
import { createAthenaBillingHandlers } from "../../src/next/billing-handlers.ts";
import { createAthenaNextHandlers } from "../../src/next/data-handlers.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";
import {
  BUILTIN_AUTHORIZATION_ROLES,
  PLATFORM_CUSTOMER_ROLE,
} from "../../src/runtime/authorization/templates.ts";
import {
  createLookupSessionFromAuthStores,
  resolveStoredUserRights,
} from "../../src/runtime/data/athena-session.ts";
import { createClient } from "../../src/v3-client.ts";
import { FetchMollieSdk } from "../helpers/fetch-mollie-sdk.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const exampleRoot = join(
  pkgRoot,
  "..",
  "athena-auth-ui",
  "examples",
  "next-minimal"
);

const CUSTOMER_RIGHTS = [
  "storage.get",
  "storage.head",
  "storage.list",
  "billing.catalog.read",
  "billing.self.invoices.read",
  "billing.self.payments.read",
  "billing.self.subscription.read",
  "billing.self.subscription.write",
  "billing.self.checkout.write",
] as const;

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

function createServerClient() {
  return createClient({
    auth: false,
    billing: {
      catalog: { prices: [], products: [] },
      mode: "local",
      providers: {
        mollie: {
          liveKey: "live_athena_nba",
          sdk: FetchMollieSdk,
          testKey: "test_athena_nba",
        },
      },
      testMode: true,
    },
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_nba_billing",
    gatewayTransport: mockTransport(),
  });
}

function emptyRightsHandlers() {
  const client = createServerClient();
  return createAthenaNextHandlers({
    auth: {
      lookupSession: async (token) =>
        token === "sess_nba"
          ? {
            session: { id: "session-nba", userId: "user_nba" },
            user: { id: "user_nba", rights: [] },
          }
          : null,
      mode: "athena-session",
    },
    client,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
}

async function postBilling(
  handlers: { billing: { POST: (request: Request) => Promise<Response> } },
  operation: string,
  token = "sess_nba",
  payload: Record<string, unknown> = {}
): Promise<{
  json: {
    data?: { items?: unknown[] };
    error?: {
      code?: string;
      errorNumber?: number;
      missing?: string[];
      operation?: string;
      reason?: string;
    };
    ok?: boolean;
    status?: number;
  };
  status: number;
}> {
  const response = await handlers.billing.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({ operation, payload }),
      headers: {
        "content-type": "application/json",
        cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=${token}`,
        origin: "http://localhost",
      },
      method: "POST",
    })
  );
  return {
    json: (await response.json()) as {
      data?: { items?: unknown[] };
      error?: {
        code?: string;
        errorNumber?: number;
        missing?: string[];
        operation?: string;
        reason?: string;
      };
      ok?: boolean;
      status?: number;
    },
    status: response.status,
  };
}

function assertDenied(
  result: Awaited<ReturnType<typeof postBilling>>,
  operation: string,
  missing: string
) {
  assert.equal(result.json.ok, false);
  assert.equal(result.status, 403);
  assert.notEqual(result.status, 500);
  assert.equal(result.json.error?.code, ATHENA_BILLING_AUTHORIZATION_DENIED);
  assert.notEqual(result.json.error?.code, "ATHENA_BILLING_INTERNAL");
  assert.equal(result.json.error?.errorNumber, 4014);
  assert.equal(result.json.error?.operation, operation);
  assert.deepEqual(result.json.error?.missing, [missing]);
}

test("T-NBA-LIST-403: empty-rights session subscriptions.list is 403/4014 not INTERNAL", async () => {
  const handlers = emptyRightsHandlers();
  assertDenied(
    await postBilling(handlers, "subscriptions.list"),
    "subscriptions.list",
    "billing.subscriptions.read"
  );
});

test("T-NBA-PRODUCTS: products.list missing billing.catalog.read", async () => {
  const handlers = emptyRightsHandlers();
  assertDenied(
    await postBilling(handlers, "products.list"),
    "products.list",
    "billing.catalog.read"
  );
});

test("T-NBA-INVOICES: invoices.list missing billing.sales-invoices.read", async () => {
  const handlers = emptyRightsHandlers();
  assertDenied(
    await postBilling(handlers, "invoices.list"),
    "invoices.list",
    "billing.sales-invoices.read"
  );
});

test("T-NBA-GRANTS: grants do not satisfy Billing HTTP authorization", async () => {
  const client = createServerClient();
  const handlers = createAthenaNextHandlers({
    auth: {
      lookupSession: async (token) =>
        token === "sess_nba"
          ? {
            session: { id: "session-nba", userId: "user_nba" },
            user: {
              grants: ["billing.subscriptions.read"],
              id: "user_nba",
              rights: [],
            },
          }
          : null,
      mode: "athena-session",
    },
    client,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  assertDenied(
    await postBilling(handlers, "subscriptions.list"),
    "subscriptions.list",
    "billing.subscriptions.read"
  );
});

test("T-NBA-DUCK: lost-prototype deny still encodes 403 via duck type + transport revive", () => {
  const duck = {
    code: ATHENA_BILLING_AUTHORIZATION_DENIED,
    errorNumber: 4014,
    message: "Billing operation subscriptions.list denied",
    missing: ["billing.subscriptions.read"],
    operation: "subscriptions.list",
    status: 403,
  };
  assert.equal(isAthenaBillingAuthorizationError(duck), true);
  const revived = billingErrorFromTransport({
    code: ATHENA_BILLING_AUTHORIZATION_DENIED,
    errorNumber: 4014,
    message: "denied",
    missing: ["billing.subscriptions.read"],
    operation: "subscriptions.list",
    status: 403,
  });
  assert.equal(isAthenaBillingAuthorizationError(revived), true);
  assert.equal(
    readSrc("billing/errors.ts").includes(
      "error instanceof AthenaBillingAuthorizationError"
    ),
    true
  );
  assert.equal(
    readSrc("billing/errors.ts").includes("error.errorNumber === 4014"),
    true
  );
  assert.equal(
    readSrc("next/billing-handlers.ts").includes(
      "isAthenaBillingAuthorizationError(error)"
    ),
    true
  );
});

test("T-NBA-LOOKUP-ROLE: rightsByRole.customer projects Rights; grants ignored", async () => {
  assert.deepEqual(
    resolveStoredUserRights(
      { role: "customer" },
      { rightsByRole: { customer: CUSTOMER_RIGHTS } }
    ).rights,
    [...CUSTOMER_RIGHTS]
  );
  assert.deepEqual(
    resolveStoredUserRights(
      { grants: ["billing.payments.read"], role: null },
      { defaultRole: "unauthorized", rightsByRole: { unauthorized: [] } }
    ).rights,
    []
  );
  const lookup = createLookupSessionFromAuthStores(
    {
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
        return { id: "user_role", role: "customer" };
      },
    },
    { authorization: { rightsByRole: { customer: CUSTOMER_RIGHTS } } }
  );
  const session = await lookup("tok");
  assert.deepEqual(session?.user.rights, [...CUSTOMER_RIGHTS]);
});

test("T-NBA-NO-OVERLAY: billing-handlers source has no PROCESS_OWNED_BILLING_PRINCIPAL", () => {
  assert.equal(
    readSrc("next/billing-handlers.ts").includes(
      "PROCESS_OWNED_BILLING_PRINCIPAL"
    ),
    false
  );
});

test("T-NBA-EXAMPLE: next-minimal catalog + assignment-owned customer Billing Rights", () => {
  const root = readFileSync(
    join(exampleRoot, "src", "lib", "athena", "create-client.ts"),
    "utf8"
  );
  assert.equal(root.includes("rightsByRole"), false);
  assert.match(root, /billingCatalog/);
  assert.match(root, /from "\.\/billing\/catalog"/);
  assert.equal(root.includes("allowUniqueEmailAutoBind: true"), false);
  const customer = BUILTIN_AUTHORIZATION_ROLES.find(
    (role) => role.key === PLATFORM_CUSTOMER_ROLE
  );
  assert.ok(customer);
  const rights = new Set(customer.rights);
  for (const key of CUSTOMER_RIGHTS) {
    assert.equal(rights.has(parseAthenaRightKey(key)), true, key);
  }
  assert.equal(
    rights.has(parseAthenaRightKey("billing.subscriptions.read")),
    false
  );
  const providers = readFileSync(
    join(exampleRoot, "src", "components", "providers.tsx"),
    "utf8"
  );
  assert.match(providers, /operationsBilling:\s*true/);
  assert.match(providers, /apiKey:/);
  assert.equal(root.includes("storage.put"), false);
  assert.equal(root.includes("storage.delete"), false);
});

test("T-NBA-DIST-SHAPE: duck-type guard present in source; example consumes workspace packages", () => {
  assert.equal(
    readSrc("billing/errors.ts").includes(
      "error.code === ATHENA_BILLING_AUTHORIZATION_DENIED"
    ),
    true
  );
  const examplePkg = JSON.parse(
    readFileSync(join(exampleRoot, "package.json"), "utf8")
  ) as { dependencies?: Record<string, string> };
  const athena = examplePkg.dependencies?.["@xylex-group/athena"] ?? "";
  const authUi = examplePkg.dependencies?.["@xylex-group/athena-auth-ui"] ?? "";
  assert.equal(
    athena.includes("workspace:") || athena.startsWith("file:"),
    true
  );
  assert.equal(
    authUi.includes("workspace:") || authUi.startsWith("file:"),
    true
  );
  const errorsDist = join(pkgRoot, "dist", "billing", "errors.js");
  if (existsSync(errorsDist)) {
    const dist = readFileSync(errorsDist, "utf8");
    assert.equal(dist.includes("ATHENA_BILLING_AUTHORIZATION_DENIED"), true);
    assert.equal(dist.includes("errorNumber"), true);
  }
});

test("T-NBA-X-RIGHTS: stuffed x-rights cannot satisfy a session with empty Rights", async () => {
  const handlers = emptyRightsHandlers();
  const response = await handlers.billing.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({ operation: "subscriptions.list", payload: {} }),
      headers: {
        "content-type": "application/json",
        cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_nba`,
        origin: "http://localhost",
        "x-rights": "billing.subscriptions.read",
      },
      method: "POST",
    })
  );
  const json = (await response.json()) as {
    error?: { missing?: string[] };
    ok?: boolean;
  };
  assert.equal(response.status, 403);
  assert.equal(json.ok, false);
  assert.deepEqual(json.error?.missing, ["billing.subscriptions.read"]);
});

test("T-NBA-UNAUTH: missing session is unauthenticated not Billing permission", async () => {
  const handlers = emptyRightsHandlers();
  const response = await handlers.billing.POST(
    new Request("http://localhost/api/athena/billing", {
      body: JSON.stringify({ operation: "subscriptions.list", payload: {} }),
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
      },
      method: "POST",
    })
  );
  const json = (await response.json()) as { error?: { code?: string } };
  assert.equal(response.status, 401);
  assert.equal(json.error?.code, "ATHENA_BILLING_UNAUTHENTICATED");
});

test("T-NBA-NO-RUNTIME: missing Billing runtime is 503 unavailable", async () => {
  const client = createClient({
    auth: false,
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_nba_noruntime",
    gatewayTransport: mockTransport(),
  });
  const handlers = createAthenaBillingHandlers({
    auth: {
      lookupSession: async (token) =>
        token === "sess_nba"
          ? {
            session: { id: "session-nba", userId: "user_nba" },
            user: { id: "user_nba", rights: [...CUSTOMER_RIGHTS] },
          }
          : null,
      mode: "athena-session",
    },
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
      body: JSON.stringify({ operation: "subscriptions.list", payload: {} }),
      headers: {
        "content-type": "application/json",
        cookie: `${ATHENA_AUTH_SESSION_COOKIE_NAME}=sess_nba`,
        origin: "http://localhost",
      },
      method: "POST",
    })
  );
  const json = (await response.json()) as { error?: { code?: string } };
  assert.equal(response.status, 503);
  assert.equal(json.error?.code, "ATHENA_BILLING_OPERATION_UNAVAILABLE");
});

test("T-NBA-ISOLATION: session with merchant Rights cannot list another tenant invoices", async () => {
  const client = createServerClient();
  const handlers = createAthenaNextHandlers({
    auth: {
      lookupSession: async (token) =>
        token === "sess_nba"
          ? {
            session: { id: "session-nba", userId: "user_a" },
            user: {
              id: "user_a",
              rights: [
                "billing.payments.read",
                "billing.payments.write",
                "billing.subscriptions.read",
                "billing.subscriptions.write",
                "billing.sales-invoices.read",
              ],
            },
          }
          : null,
      mode: "athena-session",
    },
    client,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
  const list = await postBilling(handlers, "invoices.list");
  assert.ok(
    list.status === 403 || list.status === 400,
    `expected deny status, got ${list.status}`
  );
  if (list.status === 403) {
    assert.equal(list.json.error?.code, ATHENA_BILLING_AUTHORIZATION_DENIED);
    assert.deepEqual(list.json.error?.missing, []);
  }
  const getForeign = await postBilling(handlers, "invoices.get", "sess_nba", {
    invoiceId: "inv_user_b",
  });
  assert.ok(
    getForeign.status === 403 || getForeign.status === 400,
    `expected deny status, got ${getForeign.status}`
  );
  if (getForeign.status === 403) {
    assert.equal(
      getForeign.json.error?.code,
      ATHENA_BILLING_AUTHORIZATION_DENIED
    );
  }
  const cancel = await postBilling(
    handlers,
    "subscriptions.cancel",
    "sess_nba",
    {
      idempotencyKey: "iso-cancel-user-b",
      subscriptionId: "sub_user_b",
    }
  );
  assert.ok(
    cancel.status === 403 || cancel.status === 400,
    `expected deny status, got ${cancel.status}`
  );
  if (cancel.status === 403) {
    assert.equal(cancel.json.error?.code, ATHENA_BILLING_AUTHORIZATION_DENIED);
  }
});

test("T-NBA-BINDING-SCHEMA: embedded Billing stores Athena subject locators", () => {
  const sql = readSrc(
    "migrations/embedded-billing/sql/0002_billing_subject_bindings.sql"
  );
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS billing/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS billing\.billing_payments/);
  assert.match(sql, /billing\.billing_subject_bindings/);
  assert.match(
    sql,
    /UNIQUE INDEX IF NOT EXISTS idx_billing_subject_bindings_provider_locator/
  );
  assert.match(sql, /ownership_status/);
  assert.equal(sql.includes("email_snapshot"), true);
  assert.equal(sql.includes("UNIQUE(email"), false);
  const catalog = readSrc("migrations/embedded-billing/catalog.ts");
  assert.match(catalog, /0002_billing_subject_bindings\.sql/);
});

function catalogHandlers(input: {
  catalog?: { prices: unknown[]; products: unknown[] };
  rights: readonly string[];
}) {
  const client = createClient({
    auth: false,
    billing: {
      ...(input.catalog ? { catalog: input.catalog } : {}),
      mode: "local",
      providers: {
        mollie: {
          liveKey: "live_athena_nba",
          sdk: FetchMollieSdk,
          testKey: "test_athena_nba",
        },
      },
      testMode: true,
    },
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_nba_billing",
    gatewayTransport: mockTransport(),
  });
  return createAthenaNextHandlers({
    auth: {
      lookupSession: async (token) =>
        token === "sess_nba"
          ? {
            session: { id: "session-nba", userId: "user_nba" },
            user: { id: "user_nba", rights: [...input.rights] },
          }
          : null,
      mode: "athena-session",
    },
    client,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });
}

test("T-NBA-PRICES-LIST: configured catalog returns items over Next billing handler", async () => {
  const handlers = catalogHandlers({
    catalog: {
      prices: [
        {
          amount: { currency: "EUR", value: "9.00" },
          id: "starter-monthly",
          productId: "starter",
        },
      ],
      products: [{ id: "starter", name: "Starter" }],
    },
    rights: CUSTOMER_RIGHTS,
  });
  const result = await postBilling(handlers, "prices.list");
  assert.equal(result.status, 200);
  assert.equal(result.json.ok, true);
  assert.equal(Array.isArray(result.json.data?.items), true);
  assert.equal(
    (result.json.data?.items?.[0] as { id?: string } | undefined)?.id,
    "starter-monthly"
  );
});

test("T-NBA-PRICES-ABSENT: catalog absent is missing_catalog not a list success", async () => {
  const handlers = catalogHandlers({
    rights: CUSTOMER_RIGHTS,
  });
  const result = await postBilling(handlers, "prices.list");
  assert.equal(result.json.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.json.error?.operation, "prices.list");
  assert.equal(result.json.error?.reason, "missing_catalog");
});
