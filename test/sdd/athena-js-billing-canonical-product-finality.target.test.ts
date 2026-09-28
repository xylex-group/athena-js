/**
 * Target: Athena JS billing canonical product finality.
 * See docs/sdd/xylex/athena-js-billing-canonical-product-finality/
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  canonicalizeBillingPaymentStatus,
  canonicalizeBillingSubscriptionStatus,
} from "../../src/billing/canonical/status.ts";
import { AthenaBillingError } from "../../src/billing/errors.ts";
import {
  applyBillingImportPlan,
  createMemoryBillingImportBindingStore,
} from "../../src/billing/import/apply.ts";
import { planBillingImport } from "../../src/billing/import/planner.ts";
import { DEFAULT_BILLING_IMPORT_POLICY } from "../../src/billing/import/types.ts";
import { BILLING_RECONCILIATION_RESOURCE_KINDS } from "../../src/billing/reconciliation/resources.ts";
import { diagnoseBillingOperationCapability } from "../../src/billing/runtime/authority.ts";
import { projectAthenaBillingHealth } from "../../src/billing/runtime/health.ts";
import { DECLARED_BILLING_PROVIDER_MATERIALIZES_WITHOUT_CREATE_CONNECTION } from "../../src/billing/runtime/local/connections/materialize.ts";
import { STRIPE_BILLING_PROVIDER_CAPABILITIES } from "../../src/billing/runtime/local/providers/stripe/capabilities.ts";
import { isSelfBillingOperation } from "../../src/billing/runtime/self/dispatch.ts";
import { projectBillingEntitlementsFromCanonical } from "../../src/billing/runtime/self/entitlements.ts";
import { executeSelfBillingOperation } from "../../src/billing/runtime/self/runtime.ts";
import { ensureSubjectCustomer } from "../../src/billing/subject/ensure.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";
import type { AthenaPrincipal } from "../../src/runtime/data/principal.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const exampleCatalog = join(
  pkgRoot,
  "..",
  "athena-auth-ui",
  "examples",
  "next-minimal",
  "src",
  "lib",
  "athena",
  "billing",
  "catalog.ts"
);
const exampleRoot = join(
  pkgRoot,
  "..",
  "athena-auth-ui",
  "examples",
  "next-minimal",
  "src",
  "lib",
  "athena",
  "create-client.ts"
);

function sessionUser(id: string): AthenaPrincipal {
  return {
    authenticated: true,
    grants: [],
    rights: [
      parseAthenaRightKey("billing.self.invoices.read"),
      parseAthenaRightKey("billing.self.subscription.read"),
    ],
    userId: id,
  };
}

test("P?: self.customer.get is a self billing operation", () => {
  assert.equal(isSelfBillingOperation("self.customer.get"), true);
  assert.equal(isSelfBillingOperation("self.entitlements"), true);
});

test("P?: self.customer.get rejects connectionId selector", async () => {
  await assert.rejects(
    () =>
      executeSelfBillingOperation({
        operation: "self.customer.get",
        payload: { connectionId: "conn_1" },
        principal: sessionUser("user_1"),
        sql: {
          async query() {
            return { rows: [] };
          },
        },
      }),
    (error: unknown) => {
      assert.equal(error instanceof AthenaBillingError, true);
      return true;
    }
  );
});

test("P?: ensureSubjectCustomer does not query by email", () => {
  const source = readFileSync(
    join(pkgRoot, "src", "billing", "subject", "ensure.ts"),
    "utf8"
  );
  assert.equal(source.includes("email"), true);
  assert.equal(source.includes("findUsersByEmail"), false);
  assert.equal(typeof ensureSubjectCustomer, "function");
});

test("P?: entitlements project from canonical state without Mollie", () => {
  const snapshot = projectBillingEntitlementsFromCanonical({
    metadata: { productId: "pro" },
    nextPaymentDate: "2026-09-01",
    providerStatus: "active",
  });
  assert.equal(snapshot.plans[0], "pro");
  assert.equal(snapshot.features.storageGb, 500);
  assert.equal(snapshot.subscription?.canonicalStatus, "active");
  const entitlementsSrc = readFileSync(
    join(pkgRoot, "src", "billing", "runtime", "self", "entitlements.ts"),
    "utf8"
  );
  assert.equal(entitlementsSrc.includes("mollie-api"), false);
  assert.equal(entitlementsSrc.includes("MollieClient"), false);
});

test("P?: next-minimal catalog is starter and pro only", () => {
  const catalog = readFileSync(exampleCatalog, "utf8");
  assert.match(catalog, /starter-monthly/);
  assert.match(catalog, /pro-monthly/);
  assert.equal(catalog.includes("cocaine"), false);
});

test("P?: unique email without auto-bind persists a conflict and does not bind", async () => {
  const store = createMemoryBillingImportBindingStore();
  const plan = planBillingImport({
    connectionId: "11111111-1111-4111-8111-111111111111",
    customer: {
      email: "user@example.com",
      metadata: {},
      name: null,
      providerCustomerId: "cst_1",
      raw: {},
    },
    directorySubject: null,
    documentHints: [],
    emailMatches: [
      {
        email: "user@example.com",
        subject: { id: "user_1", kind: "user" },
      },
    ],
    existingLocator: null,
    existingPrimary: null,
    policy: DEFAULT_BILLING_IMPORT_POLICY,
  });
  assert.equal(plan.action, "mark_conflict");
  const outcome = await applyBillingImportPlan(store, { plan });
  assert.equal(outcome, "conflict");
  assert.equal(store.records.length, 0);
  assert.equal(store.conflicts.length, 1);
});

test("P?: repeated mark_conflict keeps one open conflict", async () => {
  const store = createMemoryBillingImportBindingStore();
  const plan = planBillingImport({
    connectionId: "11111111-1111-4111-8111-111111111111",
    customer: {
      email: "user@example.com",
      metadata: {},
      name: null,
      providerCustomerId: "cst_1",
      raw: {},
    },
    directorySubject: null,
    documentHints: [],
    emailMatches: [
      {
        email: "user@example.com",
        subject: { id: "user_1", kind: "user" },
      },
    ],
    existingLocator: null,
    existingPrimary: null,
    policy: DEFAULT_BILLING_IMPORT_POLICY,
  });
  assert.equal(plan.action, "mark_conflict");
  await applyBillingImportPlan(store, { plan });
  await applyBillingImportPlan(store, { plan });
  assert.equal(store.conflicts.length, 1);
  assert.equal(store.conflicts[0]?.observationCount, 2);
  assert.equal(store.conflicts[0]?.reason, "manual_review_required");
});

test("P?: insufficient credential scope includes remediation", () => {
  const capability = diagnoseBillingOperationCapability({
    actualAuthority: "profile",
    anyCredentialConfigured: true,
    grantedPermissions: new Set(),
    implemented: true,
    requiredAuthority: "organization",
    requiredPermissions: [],
    scopeAllowed: false,
    selectedModeAllowed: true,
  });
  assert.equal(capability.available, false);
  assert.equal(capability.reason, "credential_scope_insufficient");
  assert.equal(typeof capability.remediation, "string");
  assert.match(String(capability.remediation), /organization-scoped/);
});

test("P?: next-minimal root does not call createConnection", () => {
  const root = readFileSync(exampleRoot, "utf8");
  assert.equal(root.includes("createConnection("), false);
  assert.equal(
    DECLARED_BILLING_PROVIDER_MATERIALIZES_WITHOUT_CREATE_CONNECTION,
    true
  );
  assert.equal(root.includes("allowUniqueEmailAutoBind: true"), false);
  assert.match(root, /allowUniqueEmailAutoBind:\s*false/);
});

test("P?: payment and subscription expose canonical and provider status", () => {
  assert.equal(
    canonicalizeBillingPaymentStatus({ providerStatus: "paid" }),
    "paid"
  );
  assert.equal(
    canonicalizeBillingSubscriptionStatus({ providerStatus: "active" }),
    "active"
  );
  const paymentType = readFileSync(
    join(pkgRoot, "src", "billing", "types.ts"),
    "utf8"
  );
  assert.match(paymentType, /canonicalStatus/);
  assert.match(paymentType, /providerStatus/);
});

test("P?: admin health projects pendingConflicts", () => {
  const health = projectAthenaBillingHealth({
    classic: "active",
    conflicts: 2,
    connectionStatus: "active",
    drift: false,
    enabled: true,
    healthy: true,
    nextGen: "active",
    provider: "mollie",
    reconciliation: "caught_up",
    warnings: [],
    webhookIngestion: "active",
  });
  assert.equal(health.pendingConflicts, 2);
});

test("P?: reconciliation resource kinds include payments and subscriptions", () => {
  assert.equal(
    BILLING_RECONCILIATION_RESOURCE_KINDS.includes("customers"),
    true
  );
  assert.equal(
    BILLING_RECONCILIATION_RESOURCE_KINDS.includes("payments"),
    true
  );
  assert.equal(
    BILLING_RECONCILIATION_RESOURCE_KINDS.includes("subscriptions"),
    true
  );
  assert.equal(
    BILLING_RECONCILIATION_RESOURCE_KINDS.includes("invoices"),
    true
  );
  const coordinator = readFileSync(
    join(pkgRoot, "src", "billing", "reconciliation", "coordinator.ts"),
    "utf8"
  );
  assert.match(coordinator, /BILLING_RECONCILIATION_RESOURCE_KINDS/);
});

test("P?: binding conflict and entitlements migrations exist", () => {
  assert.equal(
    existsSync(
      join(
        pkgRoot,
        "src",
        "migrations",
        "embedded-billing",
        "sql",
        "0019_billing_entitlements.sql"
      )
    ),
    true
  );
  assert.equal(
    existsSync(
      join(
        pkgRoot,
        "src",
        "migrations",
        "embedded-billing",
        "sql",
        "0020_billing_binding_conflicts.sql"
      )
    ),
    true
  );
  const catalog = readFileSync(
    join(pkgRoot, "src", "migrations", "embedded-billing", "catalog.ts"),
    "utf8"
  );
  assert.match(catalog, /0020_billing_binding_conflicts\.sql/);
  assert.match(catalog, /0036_billing_binding_conflict_identity\.sql/);
});

test("P?: Stripe stub declares operations unsupported", () => {
  assert.equal(
    STRIPE_BILLING_PROVIDER_CAPABILITIES.operations["payments.create"],
    false
  );
  assert.equal(STRIPE_BILLING_PROVIDER_CAPABILITIES.ports.payments, false);
});
