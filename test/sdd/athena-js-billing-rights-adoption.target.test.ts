/**
 * Target: local Billing Runtime evaluates Rust dialect Athena Rights.
 * GREEN after dialect table + gate-after-capability + 4014 deny.
 * Former characterization baseline retired to
 * test/sdd/superseded/athena-js-billing-rights-adoption.baseline.superseded.ts.
 * See docs/sdd/xylex/athena-js-billing-rights-adoption/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ATHENA_BILLING_AUTHORIZATION_DENIED,
  AthenaBillingAuthorizationError,
} from "../../src/billing/errors.ts";
import type { BillingOperation } from "../../src/billing/runtime/capabilities.ts";
import { PROCESS_BILLING_INVOCATION } from "../../src/billing/runtime/invocation-authority.ts";
import { createBillingProviderRegistry } from "../../src/billing/runtime/local/providers/create-registry.ts";
import { createMollieBillingProviderRuntime } from "../../src/billing/runtime/local/providers/mollie/runtime.ts";
import { BillingProviderRegistry } from "../../src/billing/runtime/local/providers/registry.ts";
import type { BillingProviderRuntime } from "../../src/billing/runtime/local/providers/types.ts";
import { createLocalBillingRuntime } from "../../src/billing/runtime/local/runtime.ts";
import {
  authorizeBillingOperation,
  BILLING_OPERATION_RIGHTS,
  PROCESS_OWNED_BILLING_PRINCIPAL,
  requiredBillingRights,
} from "../../src/billing/runtime/rights.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";
import { missingRequiredRights } from "../../src/rights/matching.ts";
import { normalizeAthenaPrincipal } from "../../src/runtime/data/principal.ts";
import { assertMissingRightsEnvelope } from "../helpers/authorization-envelope.ts";
import { FetchMollieSdk } from "../helpers/fetch-mollie-sdk.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const billingRoot = join(srcRoot, "billing");
const repoRoot = join(pkgRoot, "..", "..");

const EXPECTED_RIGHTS: Record<BillingOperation, string> = {
  "admin.conflicts.list": "billing.admin.conflicts.write",
  "admin.conflicts.resolve": "billing.admin.conflicts.write",
  "admin.connections.materialize": "billing.admin.reconciliation.write",
  "admin.ingestion.health": "billing.admin.ingestion.read",
  "admin.reconciliation.retry": "billing.admin.reconciliation.write",
  "admin.reconciliation.run": "billing.admin.reconciliation.write",
  "admin.webhooks.reconcile": "billing.admin.webhooks.write",
  "admin.webhooks.status": "billing.admin.webhooks.read",
  "admin.webhooks.verify": "billing.admin.webhooks.write",
  "checkout.create": "billing.payments.write",
  "customers.create": "billing.customers.write",
  "customers.delete": "billing.customers.write",
  "customers.get": "billing.customers.read",
  "customers.list": "billing.customers.read",
  "customers.update": "billing.customers.write",
  "invoices.get": "billing.sales-invoices.read",
  "invoices.list": "billing.sales-invoices.read",
  "paymentLinks.create": "billing.payment-links.write",
  "paymentLinks.delete": "billing.payment-links.write",
  "paymentLinks.get": "billing.payment-links.read",
  "paymentLinks.list": "billing.payment-links.read",
  "paymentLinks.update": "billing.payment-links.write",
  "payments.cancel": "billing.payments.write",
  "payments.create": "billing.payments.write",
  "payments.get": "billing.payments.read",
  "payments.list": "billing.payments.read",
  "prices.list": "billing.catalog.read",
  "products.list": "billing.catalog.read",
  "relations.list": "billing.catalog.read",
  "refunds.cancel": "billing.refunds.write",
  "refunds.create": "billing.refunds.write",
  "refunds.get": "billing.refunds.read",
  "refunds.list": "billing.refunds.read",
  "self.checkout.create": "billing.self.checkout.write",
  "self.checkout.resume": "billing.self.checkout.write",
  "self.customer.get": "billing.self.invoices.read",
  "self.entitlements": "billing.self.subscription.read",
  "self.invoices.get": "billing.self.invoices.read",
  "self.invoices.list": "billing.self.invoices.read",
  "self.payments.get": "billing.self.payments.read",
  "self.payments.list": "billing.self.payments.read",
  "self.subscription.cancel": "billing.self.subscription.write",
  "self.subscription.change": "billing.self.subscription.write",
  "self.subscription.enroll": "billing.self.subscription.write",
  "self.subscription.get": "billing.self.subscription.read",
  "subscriptions.cancel": "billing.subscriptions.write",
  "subscriptions.create": "billing.subscriptions.write",
  "subscriptions.get": "billing.subscriptions.read",
  "subscriptions.list": "billing.subscriptions.read",
  "subscriptions.update": "billing.subscriptions.write",
  "webhooks.create": "billing.webhooks.write",
  "webhooks.delete": "billing.webhooks.write",
  "webhooks.get": "billing.webhooks.read",
  "webhooks.list": "billing.webhooks.read",
  "webhooks.test": "billing.webhooks.write",
  "webhooks.update": "billing.webhooks.write",
};

const OPERATIONS = Object.keys(EXPECTED_RIGHTS) as BillingOperation[];

const DIALECT_PREFIXES = [
  "billing.catalog.",
  "billing.payments.",
  "billing.customers.",
  "billing.refunds.",
  "billing.subscriptions.",
  "billing.payment-links.",
  "billing.sales-invoices.",
  "billing.webhooks.",
  "billing.self.",
  "billing.admin.",
] as const;

const FORBIDDEN_REQUIREMENTS = [
  "billing.payments.create",
  "billing.refunds.create",
  "billing.customers.list",
  "billing.payment_links.write",
  "billing.read",
  "billing.manage",
  "billing.customer.manage",
  "billing.refund.manage",
  "billing.subscription.manage",
  "billing.document.read",
  "billing.provider.admin",
] as const;

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function billingBlob(): string {
  return collectTsFiles(billingRoot)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

function principalWith(
  rights: readonly string[],
  grants: readonly string[] = []
) {
  return normalizeAthenaPrincipal({
    authenticated: true,
    grants,
    rights: [...rights],
    userId: "billing-user",
  });
}

function billingDenyErrorNumber(error: unknown): number | undefined {
  if (typeof error !== "object" || error == null) {
    return;
  }
  if (!("errorNumber" in error)) {
    return;
  }
  const value = (error as { errorNumber: unknown }).errorNumber;
  return typeof value === "number" ? value : undefined;
}

function mollieConfigured() {
  return {
    mollie: {
      liveKey: "live_athena_local_runtime",
      sdk: FetchMollieSdk,
      testKey: "test_athena_local_runtime",
    },
  };
}

function createPaymentInput() {
  return {
    amount: { currency: "EUR", value: "10.00" },
    description: "Order 42",
    idempotencyKey: "idem-rights-1",
    redirectUrl: "https://example.com/return",
  };
}

test("T-BIL-DESC: P?: every privileged Billing operation declares dialect Rights", () => {
  assert.equal(existsSync(join(billingRoot, "runtime", "rights.ts")), true);
  for (const operation of OPERATIONS) {
    const required = requiredBillingRights(operation);
    assert.ok(required.length >= 1, operation);
    assert.deepEqual(BILLING_OPERATION_RIGHTS[operation], required);
  }
});

test("T-BIL-CATALOG: P?: Billing required Rights are Rust dialect keys not JS-invented or grant-catalog names", () => {
  for (const operation of OPERATIONS) {
    const required = requiredBillingRights(operation);
    assert.deepEqual(required, [
      parseAthenaRightKey(EXPECTED_RIGHTS[operation]),
    ]);
    for (const key of required) {
      assert.equal(
        FORBIDDEN_REQUIREMENTS.includes(
          key as (typeof FORBIDDEN_REQUIREMENTS)[number]
        ),
        false,
        `${operation} → ${key}`
      );
      assert.ok(
        DIALECT_PREFIXES.some((prefix) => key.startsWith(prefix)),
        `${operation} → ${key} is not a dialect key`
      );
      assert.ok(
        key.endsWith(".read") || key.endsWith(".write"),
        `${operation} → ${key} must be read or write`
      );
    }
  }
  assert.deepEqual(requiredBillingRights("payments.create"), [
    parseAthenaRightKey("billing.payments.write"),
  ]);
  assert.deepEqual(requiredBillingRights("invoices.list"), [
    parseAthenaRightKey("billing.sales-invoices.read"),
  ]);
  assert.deepEqual(requiredBillingRights("admin.reconciliation.run"), [
    parseAthenaRightKey("billing.admin.reconciliation.write"),
  ]);
  assert.ok(
    authorizeBillingOperation(
      principalWith(["billing.customers.write"]),
      "admin.reconciliation.run"
    )
  );
  assert.ok(
    authorizeBillingOperation(
      principalWith(["billing.webhooks.read"]),
      "admin.ingestion.health"
    )
  );
  const mollieRights = readFileSync(
    join(repoRoot, "crates", "athena-billing-mollie", "src", "rights.rs"),
    "utf8"
  );
  const stripeRights = readFileSync(
    join(repoRoot, "crates", "athena-billing-stripe", "src", "rights.rs"),
    "utf8"
  );
  assert.match(mollieRights, /billing\.admin\.reconciliation\.write/);
  assert.match(stripeRights, /billing\.admin\.conflicts\.write/);
  const src = readFileSync(join(billingRoot, "runtime", "rights.ts"), "utf8");
  assert.match(src, /parseAthenaRightKey\("billing\.payments\.write"\)/);
  assert.match(src, /parseAthenaRightKey\("billing\.catalog\.read"\)/);
  assert.match(src, /parseAthenaRightKey\("billing\.sales-invoices\.read"\)/);
  assert.equal(src.includes('parseAthenaRightKey("billing.manage")'), false);
  assert.equal(src.includes('parseAthenaRightKey("billing.read")'), false);
  assert.equal(
    src.includes('parseAthenaRightKey("billing.customer.manage")'),
    false
  );
  assert.equal(
    src.includes('parseAthenaRightKey("billing.payments.create")'),
    false
  );
});

test("T-BIL-EVAL: P?: Local Billing Runtime evaluates Rights through AthenaPrincipal", () => {
  const rights = readFileSync(
    join(billingRoot, "runtime", "rights.ts"),
    "utf8"
  );
  assert.match(rights, /missingRequiredRights/);
  assert.match(rights, /principal\.rights/);
  assert.equal(/principal\.grants/.test(rights), false);
  const shared = readFileSync(
    join(billingRoot, "runtime", "local", "execute", "shared.ts"),
    "utf8"
  );
  assert.match(shared, /authorizeBillingOperation/);
});

test("T-BIL-WILDCARD: P?: star and billing-star wildcards match Billing Rights via existing rightMatches", () => {
  const payWrite = [parseAthenaRightKey("billing.payments.write")];
  const refundWrite = [parseAthenaRightKey("billing.refunds.write")];
  assert.equal(
    missingRequiredRights([parseAthenaRightKey("*")], payWrite).length,
    0
  );
  assert.equal(
    missingRequiredRights([parseAthenaRightKey("billing.*")], payWrite).length,
    0
  );
  assert.equal(
    missingRequiredRights([parseAthenaRightKey("billing.*")], refundWrite)
      .length,
    0
  );
  assert.equal(
    authorizeBillingOperation(principalWith(["*"]), "payments.create"),
    undefined
  );
  assert.equal(
    authorizeBillingOperation(principalWith(["billing.*"]), "payments.create"),
    undefined
  );
  assert.equal(
    authorizeBillingOperation(principalWith(["billing.*"]), "refunds.create"),
    undefined
  );
  assert.equal(
    authorizeBillingOperation(
      principalWith(["billing.payments.write"]),
      "payments.create"
    ),
    undefined
  );
  assert.ok(
    authorizeBillingOperation(
      principalWith(["billing.payments.write"]),
      "refunds.create"
    )
  );
  assert.ok(
    authorizeBillingOperation(
      principalWith(["billing.payments.*"]),
      "payments.create"
    )
  );
});

test("T-BIL-CATALOG-SPLIT: P?: catalog read does not authorize payment reads and inverse", () => {
  const catalog = principalWith(["billing.catalog.read"]);
  assert.equal(authorizeBillingOperation(catalog, "products.list"), undefined);
  assert.equal(authorizeBillingOperation(catalog, "prices.list"), undefined);
  const catalogDeniedList = authorizeBillingOperation(catalog, "payments.list");
  assert.equal(
    catalogDeniedList instanceof AthenaBillingAuthorizationError,
    true
  );
  assert.deepEqual(catalogDeniedList?.missing, [
    parseAthenaRightKey("billing.payments.read"),
  ]);
  const catalogDeniedGet = authorizeBillingOperation(catalog, "payments.get");
  assert.equal(
    catalogDeniedGet instanceof AthenaBillingAuthorizationError,
    true
  );
  assert.deepEqual(catalogDeniedGet?.missing, [
    parseAthenaRightKey("billing.payments.read"),
  ]);

  const payments = principalWith(["billing.payments.read"]);
  assert.equal(authorizeBillingOperation(payments, "payments.list"), undefined);
  assert.equal(authorizeBillingOperation(payments, "payments.get"), undefined);
  const paymentsDeniedProducts = authorizeBillingOperation(
    payments,
    "products.list"
  );
  assert.equal(
    paymentsDeniedProducts instanceof AthenaBillingAuthorizationError,
    true
  );
  assert.deepEqual(paymentsDeniedProducts?.missing, [
    parseAthenaRightKey("billing.catalog.read"),
  ]);
  const paymentsDeniedPrices = authorizeBillingOperation(
    payments,
    "prices.list"
  );
  assert.equal(
    paymentsDeniedPrices instanceof AthenaBillingAuthorizationError,
    true
  );
  assert.deepEqual(paymentsDeniedPrices?.missing, [
    parseAthenaRightKey("billing.catalog.read"),
  ]);

  assert.equal(
    authorizeBillingOperation(principalWith(["billing.*"]), "products.list"),
    undefined
  );
  assert.equal(
    authorizeBillingOperation(principalWith(["billing.*"]), "payments.list"),
    undefined
  );
  assert.equal(
    authorizeBillingOperation(principalWith(["*"]), "products.list"),
    undefined
  );
  assert.equal(
    authorizeBillingOperation(principalWith(["*"]), "payments.list"),
    undefined
  );
});

test("T-BIL-MISSING: P?: denied Billing operations report missing Rights", async () => {
  const configured = mollieConfigured();
  const runtime = createLocalBillingRuntime({
    configuredProviders: configured,
    invocation: PROCESS_BILLING_INVOCATION,
    principal: principalWith(["billing.payments.read"]),
    registry: createBillingProviderRegistry(configured),
    testMode: true,
  });
  try {
    await runtime.payments.create(createPaymentInput());
    assert.fail("expected authorization deny");
  } catch (error) {
    assert.equal(error instanceof AthenaBillingAuthorizationError, true);
    const denied = error as AthenaBillingAuthorizationError;
    assert.equal(denied.code, ATHENA_BILLING_AUTHORIZATION_DENIED);
    assert.equal(denied.status, 403);
    assert.equal(denied.operation, "payments.create");
    assert.deepEqual(denied.missing, [
      parseAthenaRightKey("billing.payments.write"),
    ]);
    assert.equal(billingDenyErrorNumber(denied), 4014);
    assertMissingRightsEnvelope({
      code: denied.code,
      errorNumber: denied.errorNumber,
      message: denied.message,
      missing: denied.missing.map(String),
      operation: denied.operation,
    });
  }
});

test("T-BIL-MALFORMED: P?: malformed Rights on a principal never authorize Billing", async () => {
  const configured = mollieConfigured();
  const runtime = createLocalBillingRuntime({
    configuredProviders: configured,
    invocation: PROCESS_BILLING_INVOCATION,
    principal: principalWith(["admin:read", "billing manage"]),
    registry: createBillingProviderRegistry(configured),
    testMode: true,
  });
  await assert.rejects(
    () => runtime.payments.create(createPaymentInput()),
    (error: unknown) =>
      error instanceof AthenaBillingAuthorizationError &&
      error.missing.includes(parseAthenaRightKey("billing.payments.write"))
  );
});

test("T-BIL-GRANTS: P?: Billing grants never satisfy required Rights", async () => {
  const configured = mollieConfigured();
  const runtime = createLocalBillingRuntime({
    configuredProviders: configured,
    invocation: PROCESS_BILLING_INVOCATION,
    principal: principalWith([], ["billing.payments.write", "billing.*", "*"]),
    registry: createBillingProviderRegistry(configured),
    testMode: true,
  });
  await assert.rejects(
    () => runtime.payments.create(createPaymentInput()),
    AthenaBillingAuthorizationError
  );
});

test("T-BIL-DENY-PROVIDER: P?: denied Billing Rights never execute the provider adapter", async () => {
  let createCalls = 0;
  const inner = createMollieBillingProviderRuntime({
    sdk: FetchMollieSdk,
    testKey: "test_athena_local_runtime",
  });
  const runtimeAdapter: BillingProviderRuntime = {
    customers: inner.customers,
    async getCapabilities(binding) {
      return inner.getCapabilities(binding);
    },
    invoices: inner.invoices,
    paymentLinks: inner.paymentLinks,
    payments: {
      cancel: inner.payments.cancel,
      async create(context, input) {
        createCalls += 1;
        return inner.payments.create(context, input);
      },
      get: inner.payments.get,
      list: inner.payments.list,
    },
    provider: inner.provider,
    refunds: inner.refunds,
    subscriptions: inner.subscriptions,
    webhooks: inner.webhooks,
  };
  const configured = {
    mollie: { sdk: FetchMollieSdk, testKey: "test_athena_local_runtime" },
  };
  const runtime = createLocalBillingRuntime({
    configuredProviders: configured,
    invocation: PROCESS_BILLING_INVOCATION,
    principal: principalWith([]),
    registry: new BillingProviderRegistry([runtimeAdapter]),
    testMode: true,
  });
  await assert.rejects(
    () => runtime.payments.create(createPaymentInput()),
    AthenaBillingAuthorizationError
  );
  assert.equal(createCalls, 0);
});

test("T-BIL-SAFETY: P?: financial safety preflight is unchanged above providers", () => {
  const invoke = readFileSync(
    join(billingRoot, "runtime", "local", "execute", "invoke.ts"),
    "utf8"
  );
  const payments = readFileSync(
    join(billingRoot, "runtime", "local", "execute", "payments.ts"),
    "utf8"
  );
  const prepareIdx = invoke.indexOf("prepareBillingCommand({");
  const resolveIdx = invoke.indexOf("prepareLocalBillingInvocation({");
  assert.ok(prepareIdx >= 0 && resolveIdx >= 0 && prepareIdx < resolveIdx);
  assert.match(invoke, /finalizeBillingCommand/);
  assert.match(payments, /idempotencyKey: payload\.idempotencyKey/);
  assert.equal(existsSync(join(billingRoot, "safety", "prepare.ts")), true);
  assert.equal(existsSync(join(billingRoot, "safety", "retry.ts")), true);
  assert.equal(existsSync(join(billingRoot, "safety", "money.ts")), true);
  const retry = readFileSync(join(billingRoot, "safety", "retry.ts"), "utf8");
  assert.match(retry, /export function billingRetryDisposition\(/);
  assert.equal(retry.includes("billingRetryDispositionForKind"), false);
  const money = readFileSync(join(billingRoot, "safety", "money.ts"), "utf8");
  assert.equal(money.includes("parseFloat"), false);
  assert.equal(/\bNumber\s*\(/.test(money), false);
});

test("T-BIL-MOLLIE: P?: local Mollie payments.create still uses the official SDK path", async () => {
  const adapter = readFileSync(
    join(
      billingRoot,
      "runtime",
      "local",
      "providers",
      "mollie",
      "sdk",
      "official-adapter.ts"
    ),
    "utf8"
  );
  assert.match(adapter, /export function createOfficialMollieAdapter/);
  assert.match(adapter, /new Sdk\(options\)/);
  const calls: string[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    calls.push(`${(init?.method ?? "GET").toUpperCase()} ${String(url)}`);
    return new Response(
      JSON.stringify({
        amount: { currency: "EUR", value: "10.00" },
        createdAt: "2026-08-23T10:00:00+00:00",
        description: "Order 42",
        id: "tr_local_1",
        resource: "payment",
        status: "open",
      }),
      { headers: { "content-type": "application/json" }, status: 201 }
    );
  }) as typeof fetch;
  try {
    const configured = mollieConfigured();
    const runtime = createLocalBillingRuntime({
      configuredProviders: configured,
      invocation: PROCESS_BILLING_INVOCATION,
      registry: createBillingProviderRegistry(configured),
      testMode: true,
    });
    const payment = await runtime.payments.create(createPaymentInput());
    assert.equal(payment.providerPaymentId, "tr_local_1");
    assert.ok(calls.some((call) => call.includes("api.mollie.com")));
  } finally {
    globalThis.fetch = previous;
  }
});

test("T-BIL-NO-HTTP: P?: /api/athena/billing is not added", () => {
  const blob = billingBlob();
  const rights = readFileSync(
    join(billingRoot, "runtime", "rights.ts"),
    "utf8"
  );
  const shared = readFileSync(
    join(billingRoot, "runtime", "local", "execute", "shared.ts"),
    "utf8"
  );
  assert.equal(rights.includes("createAthenaBillingHandlers"), false);
  assert.equal(rights.includes("/api/athena/billing"), false);
  assert.equal(shared.includes("createAthenaBillingHandlers"), false);
  assert.equal(blob.includes("createBillingClient"), false);
  assert.equal(existsSync(join(srcRoot, "billing", "http")), false);
  const pkg = JSON.parse(
    readFileSync(join(pkgRoot, "package.json"), "utf8")
  ) as { exports?: Record<string, unknown> };
  assert.equal(pkg.exports?.["./billing/client"] == null, true);
  assert.equal(pkg.exports?.["./billing/rights"] == null, true);
});

test("T-BIL-LAYER: P?: Billing Rights sit after capability and before provider ports", () => {
  const shared = readFileSync(
    join(billingRoot, "runtime", "local", "execute", "shared.ts"),
    "utf8"
  );
  const authIdx = shared.lastIndexOf("authorizeBillingOperation");
  const capsIdx = shared.indexOf("getCapabilities");
  const decideIdx = shared.lastIndexOf("decideLocalBillingOperationCapability");
  assert.ok(authIdx >= 0 && capsIdx >= 0 && capsIdx < authIdx);
  assert.ok(decideIdx >= 0 && decideIdx < authIdx);
  const invoke = readFileSync(
    join(billingRoot, "runtime", "local", "execute", "invoke.ts"),
    "utf8"
  );
  const resolveIdx = invoke.indexOf("prepareLocalBillingInvocation({");
  const portIdx = invoke.indexOf("requireProviderPort(");
  assert.ok(resolveIdx >= 0 && portIdx >= 0 && resolveIdx < portIdx);
  const molliePayments = readFileSync(
    join(billingRoot, "runtime", "local", "providers", "mollie", "payments.ts"),
    "utf8"
  );
  assert.equal(molliePayments.includes("authorizeBillingOperation"), false);
  assert.equal(molliePayments.includes("missingRequiredRights"), false);
  assert.equal(molliePayments.includes("parseAthenaRightKey"), false);
});

test("T-BIL-NO-PROMOTE: P?: vendor customers.write is not auto-promoted to an Athena Right", () => {
  const src = readFileSync(
    join(
      billingRoot,
      "runtime",
      "local",
      "providers",
      "operation-authority.ts"
    ),
    "utf8"
  );
  assert.match(src, /permissions: \["customers\.write"\]/);
  assert.match(src, /permissions: \["payments\.write"\]/);
  assert.equal(src.includes("parseAthenaRightKey"), false);
  const rights = readFileSync(
    join(billingRoot, "runtime", "rights.ts"),
    "utf8"
  );
  assert.equal(
    rights.includes('parseAthenaRightKey("customers.write")'),
    false
  );
  assert.equal(rights.includes('parseAthenaRightKey("payments.write")'), false);
});

test("T-BIL-ERROR-BAND: P?: Billing authorization deny uses billing 4000-band not storage 3003", () => {
  const errors = readFileSync(join(billingRoot, "errors.ts"), "utf8");
  assert.match(errors, /ATHENA_BILLING_AUTHORIZATION_DENIED/);
  assert.match(errors, /errorNumber/);
  assert.match(errors, /\b4014\b/);
  assert.equal(/\b3003\b/.test(errors), false);
  assert.equal(/\b3003\b/.test(billingBlob()), false);
  const contract = readFileSync(
    join(repoRoot, "contracts", "billing", "errors.json"),
    "utf8"
  );
  assert.match(contract, /\b4014\b/);
  const denied = new AthenaBillingAuthorizationError({
    missing: [parseAthenaRightKey("billing.payments.write")],
    operation: "payments.create",
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.code, ATHENA_BILLING_AUTHORIZATION_DENIED);
  assert.equal(billingDenyErrorNumber(denied), 4014);
});

test("T-BIL-OVERLAY: P?: omitted principal uses dialect overlay Rights not grant-catalog keys", () => {
  assert.equal(
    PROCESS_OWNED_BILLING_PRINCIPAL.userId,
    "athena.billing.process"
  );
  assert.deepEqual(PROCESS_OWNED_BILLING_PRINCIPAL.grants, []);
  const dialect = [
    "billing.catalog.read",
    "billing.payments.read",
    "billing.payments.write",
    "billing.customers.read",
    "billing.customers.write",
    "billing.refunds.read",
    "billing.refunds.write",
    "billing.subscriptions.read",
    "billing.subscriptions.write",
    "billing.payment-links.read",
    "billing.payment-links.write",
    "billing.sales-invoices.read",
    "billing.webhooks.read",
    "billing.webhooks.write",
    "billing.self.invoices.read",
    "billing.self.payments.read",
    "billing.self.subscription.read",
    "billing.self.subscription.write",
    "billing.self.checkout.write",
    "billing.admin.reconciliation.write",
    "billing.admin.webhooks.read",
    "billing.admin.webhooks.write",
    "billing.admin.ingestion.read",
    "billing.admin.conflicts.write",
  ].map((key) => parseAthenaRightKey(key));
  for (const key of dialect) {
    assert.ok(
      PROCESS_OWNED_BILLING_PRINCIPAL.rights.includes(key),
      `overlay missing ${key}`
    );
  }
  assert.equal(
    PROCESS_OWNED_BILLING_PRINCIPAL.rights.includes(
      parseAthenaRightKey("billing.manage")
    ),
    false
  );
  assert.equal(
    authorizeBillingOperation(
      PROCESS_OWNED_BILLING_PRINCIPAL,
      "payments.create"
    ),
    undefined
  );
});

test("T-BIL-SELF-NO-OVERLAY: self-service re-entry does not use PROCESS_OWNED_BILLING_PRINCIPAL", () => {
  const selfDir = join(billingRoot, "runtime", "self");
  for (const file of [
    "checkout.ts",
    "enroll.ts",
    "advance-enrollment.ts",
    "resume.ts",
    "subscriptions.ts",
    "delegated-principal.ts",
  ]) {
    const src = readFileSync(join(selfDir, file), "utf8");
    assert.equal(src.includes("PROCESS_OWNED_BILLING_PRINCIPAL"), false, file);
  }
  const ensure = readFileSync(
    join(billingRoot, "subject", "ensure-provider-customer.ts"),
    "utf8"
  );
  assert.equal(ensure.includes("PROCESS_OWNED_BILLING_PRINCIPAL"), false);
  assert.match(ensure, /selfDelegatedBillingPrincipal/);
});
