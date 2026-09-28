/**
 * Target: billing subject isolation finality.
 * GREEN. Baseline retired to test/sdd/superseded/.
 * See docs/sdd/xylex/athena-js-billing-subject-isolation-finality/
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  isProcessBillingInvocation,
  PROCESS_BILLING_INVOCATION,
  resolveBillingInvocationAuthority,
} from "../../src/billing/runtime/invocation-authority.ts";
import {
  authorizeBillingSubjectBinding,
  isProcessOwnedBillingPrincipal,
  PROCESS_OWNED_BILLING_PRINCIPAL,
} from "../../src/billing/runtime/rights.ts";
import { clampSelfListLimit } from "../../src/billing/runtime/self/invoices.ts";
import type { BillingSubjectBindingRecord } from "../../src/billing/subject/repository.ts";
import { resolveSubject } from "../../src/billing/subject/resolve.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";
import type { AthenaPrincipal } from "../../src/runtime/data/principal.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

function srcPath(...parts: string[]): string {
  return join(srcRoot, ...parts);
}

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

function requireSrc(rel: string): string {
  const full = join(srcRoot, rel);
  assert.equal(existsSync(full), true, rel);
  return readFileSync(full, "utf8");
}

function sessionUser(id: string): AthenaPrincipal {
  return {
    authenticated: true,
    grants: [],
    rights: [parseAthenaRightKey("billing.payments.read")],
    userId: id,
  };
}

test("P?: subject-scoped billing.self runtime exists", () => {
  assert.equal(
    existsSync(srcPath("billing", "runtime", "self", "runtime.ts")),
    true
  );
  assert.equal(
    existsSync(srcPath("billing", "runtime", "self", "invoices.ts")),
    true
  );
});

test("P?: billing subject repository exists", () => {
  assert.equal(
    existsSync(srcPath("billing", "subject", "repository.ts")),
    true
  );
  assert.equal(existsSync(srcPath("billing", "subject", "resolve.ts")), true);
  assert.equal(existsSync(srcPath("billing", "subject", "ensure.ts")), true);
});

test("P?: migration 0003 billing subject finality exists", () => {
  const sqlPath = srcPath(
    "migrations",
    "embedded-billing",
    "sql",
    "0003_billing_subject_finality.sql"
  );
  assert.equal(existsSync(sqlPath), true);
  const sql = requireSrc(
    "migrations/embedded-billing/sql/0003_billing_subject_finality.sql"
  );
  assert.match(sql, /billing_provider_connections/);
  assert.match(sql, /billing_webhook_events/);
  assert.match(sql, /billing_projection_events/);
  assert.match(sql, /ownership_status <> 'resolved'/);
  assert.match(sql, /idx_billing_payments_connection_provider_payment/);
  const presets = readFileSync(
    join(
      pkgRoot,
      "..",
      "athena-auth-ui",
      "src",
      "components",
      "auth",
      "billing",
      "billing-query-presets.ts"
    ),
    "utf8"
  );
  assert.match(presets, /billing_provider_connections/);
  assert.match(presets, /billing_webhook_events/);
  assert.match(presets, /billing_projection_events/);
});

test("P?: embedded billing catalog includes 0003 after 0002", () => {
  const catalog = readSrc("migrations/embedded-billing/catalog.ts");
  assert.match(catalog, /0002_billing_subject_bindings\.sql/);
  assert.match(catalog, /0003_billing_subject_finality\.sql/);
  assert.match(catalog, /billing_provider_connections/);
  assert.match(catalog, /billing_webhook_events/);
  assert.match(catalog, /billing_projection_events/);
});

test("P?: live unique index serializes provider-customer bindings", () => {
  const sql = requireSrc(
    "migrations/embedded-billing/sql/0011_billing_subject_binding_uniqueness.sql"
  );
  assert.match(sql, /idx_billing_subject_bindings_one_live/);
  assert.match(sql, /idx_billing_subject_bindings_one_active/);
  assert.match(sql, /status IN \('pending', 'active'\)/);
  const postgres = readSrc("billing/subject/postgres.ts");
  assert.match(
    postgres,
    /ON CONFLICT \(connection_id, subject_kind, subject_id, provider_subject_kind\)/
  );
  assert.match(
    readSrc("billing/subject/ensure-provider-customer.ts"),
    /reserved\.inserted/
  );
  assert.match(
    readSrc("migrations/embedded-billing/catalog.ts"),
    /0011_billing_subject_binding_uniqueness\.sql/
  );
  assert.match(
    readSrc("billing/import/postgres.ts"),
    /isBillingUniqueViolation/
  );
});

test("P?: process authority is not a billing-overlay userId", () => {
  const rights = readSrc("billing/runtime/rights.ts");
  assert.equal(rights.includes("billing-overlay"), false);
  assert.equal(
    PROCESS_OWNED_BILLING_PRINCIPAL.userId,
    "athena.billing.process"
  );
  assert.equal(
    isProcessOwnedBillingPrincipal(PROCESS_OWNED_BILLING_PRINCIPAL),
    true
  );
  assert.equal(
    isProcessOwnedBillingPrincipal({
      authenticated: true,
      grants: [],
      rights: [],
      userId: "billing-overlay",
    }),
    false
  );
});

test("P?: BillingInvocationAuthority distinguishes process and session", () => {
  const invocation = requireSrc("billing/runtime/invocation-authority.ts");
  assert.match(invocation, /PROCESS_BILLING_INVOCATION/);
  assert.match(invocation, /PROCESS_INVOCATION_BRAND/);
  assert.match(invocation, /kind:\s*"process"/);
  assert.match(invocation, /kind:\s*"session"/);
  assert.equal(
    readSrc("next/billing-handlers.ts").includes('kind: "process"'),
    false
  );
  assert.equal(
    readSrc("next/billing-handlers.ts").includes("PROCESS_BILLING_INVOCATION"),
    false
  );
  const forged = resolveBillingInvocationAuthority({
    authority: { kind: "process" },
  });
  assert.equal(isProcessBillingInvocation(forged), false);
  assert.equal(forged.kind, "session");
  assert.equal(resolveBillingInvocationAuthority({}).kind, "session");
  assert.equal(isProcessBillingInvocation(PROCESS_BILLING_INVOCATION), true);
  assert.ok(
    authorizeBillingSubjectBinding(
      sessionUser("user_session"),
      "invoices.list",
      forged
    )
  );
  assert.equal(
    authorizeBillingSubjectBinding(
      PROCESS_OWNED_BILLING_PRINCIPAL,
      "invoices.list",
      PROCESS_BILLING_INVOCATION
    ),
    undefined
  );
  assert.ok(
    authorizeBillingSubjectBinding(
      PROCESS_OWNED_BILLING_PRINCIPAL,
      "invoices.list",
      { kind: "process" } as never
    )
  );
});

test("P?: user A can list A invoices via billing.self", () => {
  const invoices = requireSrc("billing/runtime/self/invoices.ts");
  assert.match(invoices, /subject_kind/);
  assert.match(invoices, /subject_id/);
  assert.match(invoices, /ownership_status = 'resolved'/);
});

test("P?: user A cannot list B invoices", () => {
  const invoices = requireSrc("billing/runtime/self/invoices.ts");
  assert.match(invoices, /subject_kind/);
  assert.doesNotMatch(invoices, /salesInvoices/);
});

test("P?: user A cannot fetch B canonical invoice ID", () => {
  const invoices = requireSrc("billing/runtime/self/invoices.ts");
  assert.match(invoices, /id = \$1/);
  assert.match(invoices, /subject_kind/);
});

test("P?: user A cannot cancel B subscription", () => {
  const subscriptions = requireSrc("billing/runtime/self/subscriptions.ts");
  assert.match(subscriptions, /subject_kind/);
  assert.match(subscriptions, /ownership_status = 'resolved'/);
});

test("P?: known provider IDs cannot bypass canonical ownership", () => {
  const invoices = requireSrc("billing/runtime/self/invoices.ts");
  assert.doesNotMatch(invoices, /provider_invoice_id = \$1/);
});

test("P?: payload userId email customerId provider connectionId are rejected", () => {
  const dispatch = requireSrc("billing/runtime/self/dispatch.ts");
  assert.match(dispatch, /userId/);
  assert.match(dispatch, /email/);
  assert.match(dispatch, /customerId/);
  assert.match(dispatch, /connectionId/);
});

test("P?: changing email preserves ownership", () => {
  const ensure = requireSrc("billing/subject/ensure.ts");
  assert.doesNotMatch(ensure, /WHERE email_snapshot =/);
  assert.match(ensure, /subject_kind/);
});

test("P?: duplicate email creates no automatic binding", () => {
  const ensure = requireSrc("billing/subject/ensure.ts");
  assert.doesNotMatch(ensure, /WHERE email_snapshot =/);
  assert.match(ensure, /reserve/);
});

test("P?: conflicting binding fails closed", () => {
  const resolve = requireSrc("billing/subject/resolve.ts");
  assert.match(resolve, /conflict/);
});

test("P?: unresolved webhook documents remain hidden", () => {
  const invoices = requireSrc("billing/runtime/self/invoices.ts");
  assert.match(invoices, /ownership_status = 'resolved'/);
  assert.doesNotMatch(invoices, /ownership_status = 'unresolved'/);
});

test("P?: Mollie self invoice listing never calls salesInvoices.list", () => {
  const invoices = requireSrc("billing/runtime/self/invoices.ts");
  assert.doesNotMatch(invoices, /salesInvoices/);
  assert.doesNotMatch(invoices, /callMollieSdk/);
});

test("P?: separate Mollie connections cannot collide", () => {
  const sql = requireSrc(
    "migrations/embedded-billing/sql/0003_billing_subject_finality.sql"
  );
  assert.match(sql, /billing_provider_connections/);
  assert.match(sql, /account_reference/);
});

test("P?: test and live connections cannot collide", () => {
  const sql = requireSrc(
    "migrations/embedded-billing/sql/0003_billing_subject_finality.sql"
  );
  assert.match(sql, /environment/);
});

test("P?: session principal cannot impersonate process authority", () => {
  assert.equal(
    isProcessOwnedBillingPrincipal(sessionUser("athena.billing.process")),
    false
  );
  assert.equal(
    isProcessOwnedBillingPrincipal(sessionUser("billing-overlay")),
    false
  );
  const denied = authorizeBillingSubjectBinding(
    sessionUser("athena.billing.process"),
    "invoices.list"
  );
  assert.ok(denied);
  assert.ok(
    authorizeBillingSubjectBinding(
      sessionUser("billing-overlay"),
      "invoices.list"
    )
  );
});

test("P?: billing.self is a billing HTTP operation", () => {
  const handlers = readSrc("next/billing-handlers.ts");
  assert.match(handlers, /self\.invoices\.list/);
  assert.match(handlers, /self\.payments\.list/);
  assert.match(handlers, /self\.subscription\.cancel/);
});

test("P?: browser transport exposes self not raw invoices.list", () => {
  const src = readSrc("billing/runtime/browser-transport.ts");
  assert.match(src, /self:\s*BillingSelfPort|const self:/);
  assert.doesNotMatch(src, /call\("invoices\.list"/);
  assert.doesNotMatch(src, /call\("customers\.list"/);
  assert.doesNotMatch(src, /call\("payments\./);
  assert.doesNotMatch(src, /call\("webhooks\./);
  assert.doesNotMatch(src, /call\("admin\./);
  assert.doesNotMatch(src, /call\("checkout\.create"/);
});

test("P?: CLI has billing reconcile-subjects", () => {
  const catalog = readFileSync(srcPath("cli", "commands-catalog.ts"), "utf8");
  assert.match(catalog, /reconcile-subjects/);
});

test("P?: BillingSubjectRef remains the only owner type", () => {
  const src = readSrc("billing/types.ts");
  assert.match(src, /export type BillingSubjectRef/);
  assert.equal(src.includes("BillingEmailIdentity"), false);
});

test("P?: no createBillingClient", () => {
  assert.equal(
    readSrc("billing/index.ts").includes("createBillingClient"),
    false
  );
});

test("P?: session catalog prices.list remains unbound", () => {
  assert.equal(
    authorizeBillingSubjectBinding(sessionUser("user_a"), "prices.list"),
    undefined
  );
});

test("P?: AthenaBillingRuntime and module expose typed billing.self", () => {
  const types = readSrc("billing/runtime/types.ts");
  assert.match(types, /export interface BillingSelfPort/);
  assert.match(types, /readonly self: BillingSelfPort/);
  assert.match(readSrc("billing/module.ts"), /self: BillingSelfPort/);
  assert.match(
    readSrc("billing/runtime/local/runtime.ts"),
    /createSelfBillingPort/
  );
  assert.match(
    readSrc("billing/runtime/remote/runtime.ts"),
    /createUnavailableBillingSelfPort/
  );
});

test("P?: 0003 never casts logical connection ids to uuid", () => {
  const sql = requireSrc(
    "migrations/embedded-billing/sql/0003_billing_subject_finality.sql"
  );
  assert.doesNotMatch(sql, /USING connection_id::uuid/);
  assert.doesNotMatch(sql, /USING NULLIF\(connection_id, ''\)::uuid/);
  assert.match(sql, /billing_connection_upgrade/);
  assert.match(sql, /connection_id mapping is ambiguous/);
  assert.match(sql, /btrim\(provider\) <> ''/);
});

test("P?: resolveSubject sees conflict rows not only active", () => {
  const postgres = requireSrc("billing/subject/postgres.ts");
  assert.match(postgres, /status <> 'revoked'/);
  assert.doesNotMatch(postgres, /AND status = 'active'/);
});

test("P?: self list limits are clamped to 1..100", () => {
  assert.equal(clampSelfListLimit(undefined), 50);
  assert.equal(clampSelfListLimit(0), 1);
  assert.equal(clampSelfListLimit(1000), 100);
  assert.match(
    requireSrc("billing/runtime/self/invoices.ts"),
    /clampSelfListLimit/
  );
  assert.match(
    requireSrc("billing/runtime/self/payments.ts"),
    /clampSelfListLimit/
  );
});

test("P?: self cancel and checkout go through the provider", () => {
  assert.match(
    requireSrc("billing/runtime/self/subscriptions.ts"),
    /executeLocalBillingSubscriptionCancel/
  );
  assert.match(
    requireSrc("billing/runtime/self/checkout.ts"),
    /requireProviderPaymentFromCheckoutSnapshot/
  );
});

test("P?: self operations require dialect Rights not auth-only", () => {
  assert.match(
    readSrc("billing/runtime/rights.ts"),
    /billing\.self\.invoices\.read/
  );
  assert.match(
    readSrc("billing/runtime/rights.ts"),
    /billing\.self\.checkout\.write/
  );
  assert.ok(
    authorizeBillingSubjectBinding(
      sessionUser("user_a"),
      "self.invoices.list"
    ) == null
  );
});

function binding(
  overrides: Partial<BillingSubjectBindingRecord>
): BillingSubjectBindingRecord {
  return {
    connectionId: "conn",
    emailSnapshot: null,
    id: "bind",
    isPrimary: true,
    providerSubjectId: "cst_1",
    providerSubjectKind: "customer",
    source: "created",
    status: "active",
    subjectId: "user_a",
    subjectKind: "user",
    ...overrides,
  };
}

test("P?: pending-only bindings stay unbound; conflict status fails closed", async () => {
  const pendingOnly = {
    async getBinding() {},
    async listActiveBindings() {
      return [binding({ status: "pending" })];
    },
    async reserve() {
      return {
        binding: binding({ status: "pending" }),
        inserted: false,
      };
    },
  };
  assert.equal(
    (
      await resolveSubject({
        athenaUserId: "user_a",
        connectionId: "conn",
        provider: "mollie",
        repository: pendingOnly,
      })
    ).status,
    "unbound"
  );

  const conflicted = {
    ...pendingOnly,
    async listActiveBindings() {
      return [binding({ status: "conflict" })];
    },
  };
  assert.equal(
    (
      await resolveSubject({
        athenaUserId: "user_a",
        connectionId: "conn",
        provider: "mollie",
        repository: conflicted,
      })
    ).status,
    "conflict"
  );
});
