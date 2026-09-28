import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { asSelfPaymentView } from "../../src/billing/runtime/self/payments.ts";
import { resumeSelfCheckout } from "../../src/billing/runtime/self/resume.ts";
import {
  ATHENA_BILLING_RETURN_QUERY,
  appendBillingReturnToken,
  createBillingReturnNonce,
  hashBillingReturnNonce,
} from "../../src/billing/runtime/self/return-token.ts";
import { AthenaBillingSubjectError } from "../../src/billing/subject/errors.ts";
import type { BillingSqlExecutor } from "../../src/billing/subject/repository.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";
import {
  BUILTIN_AUTHORIZATION_ROLES,
  PLATFORM_CUSTOMER_ROLE,
} from "../../src/runtime/authorization/templates.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const selfDir = join(pkgRoot, "src", "billing", "runtime", "self");
const authUiBilling = join(
  pkgRoot,
  "..",
  "athena-auth-ui",
  "src",
  "components",
  "auth",
  "billing"
);

test("T-RETURN-001: customer payment view omits raw and unrestricted metadata", () => {
  const view = asSelfPaymentView({
    amount_currency: "EUR",
    amount_value: "12.00",
    created_at: "2026-08-01T12:00:00.000Z",
    description: "Starter",
    id: "pay_1",
    ingested_at: "2026-08-01T12:00:01.000Z",
    metadata: { foo: "secret", priceId: "price_starter" },
    paid_at: "2026-08-01T12:01:00.000Z",
    provider: "mollie",
    provider_payment_id: "tr_paid",
    raw: { metadata: { internal: true }, resource: "payment" },
    status: "paid",
  });
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes("secret"), false);
  assert.equal(serialized.includes("internal"), false);
  assert.equal(serialized.includes('"raw"'), false);
  assert.equal("raw" in view, false);
  assert.equal("metadata" in view, false);
  assert.equal(view.priceId, "price_starter");
  assert.equal(view.reference, "tr_paid");
  assert.equal(view.status, "paid");
});

test("T-RETURN-002: list SQL selects customer-safe columns only", () => {
  const src = readFileSync(join(selfDir, "payments.ts"), "utf8");
  assert.equal(src.includes("SELECT *"), false);
  assert.match(src, /metadata->>'priceId' AS price_id/);
  assert.match(src, /ownership_status = 'resolved'/);
  assert.match(src, /subject_kind = \$1/);
});

test("T-RETURN-002b: persistOwnedPayment uses connection-scoped uniqueness", () => {
  const persist = readFileSync(
    join(selfDir, "persist-owned-payment.ts"),
    "utf8"
  );
  assert.match(
    persist,
    /ON CONFLICT \(connection_id, provider_payment_id\) WHERE connection_id IS NOT NULL/
  );
  assert.equal(
    persist.includes("ON CONFLICT (provider, provider_payment_id)"),
    false
  );
});

test("T-RETURN-003: return token is hashed and query-correlated", () => {
  const nonce = createBillingReturnNonce();
  assert.equal(hashBillingReturnNonce(nonce.token), nonce.hash);
  assert.notEqual(nonce.token, nonce.hash);
  const url = appendBillingReturnToken(
    "https://app.example/dashboard",
    nonce.token
  );
  assert.match(url, new RegExp(`${ATHENA_BILLING_RETURN_QUERY}=`));
  assert.equal(url.includes(nonce.hash), false);
});

test("T-RETURN-004: resume of unknown token is 404", async () => {
  const sql: BillingSqlExecutor = {
    async query() {
      return { rows: [] };
    },
  };
  await assert.rejects(
    () =>
      resumeSelfCheckout({
        principal: {
          authenticated: true,
          grants: [],
          rights: [],
          userId: "user_a",
        },
        returnToken: "tampered-token",
        sql,
      }),
    (error: unknown) =>
      error instanceof AthenaBillingSubjectError &&
      error.code === "ATHENA_BILLING_NOT_FOUND" &&
      error.status === 404
  );
});

test("T-RETURN-005: checkout create persists attempt metadata before provider payment", () => {
  const checkout = readFileSync(join(selfDir, "checkout.ts"), "utf8");
  const insertIdx = checkout.lastIndexOf("insertCheckoutSession");
  const paymentIdx = checkout.lastIndexOf(
    "requireProviderPaymentFromCheckoutSnapshot"
  );
  assert.ok(insertIdx >= 0 && paymentIdx > insertIdx);
  assert.match(checkout, /athenaCheckoutSessionId/);
  assert.match(checkout, /appendBillingReturnToken/);
  const enroll = readFileSync(join(selfDir, "enroll.ts"), "utf8");
  const enrollInsert = enroll.lastIndexOf("insertCheckoutSession");
  const enrollPayment = enroll.lastIndexOf(
    "requireProviderPaymentFromCheckoutSnapshot",
  );
  assert.ok(enrollInsert >= 0 && enrollPayment > enrollInsert);
  assert.equal(enroll.includes("executeLocalBillingPaymentCreate"), false);
});

test("T-RETURN-006: platform customer role does not duplicate operation aliases", () => {
  const customer = BUILTIN_AUTHORIZATION_ROLES.find(
    (role) => role.key === PLATFORM_CUSTOMER_ROLE
  );
  assert.ok(customer);
  assert.equal(
    customer.rights.includes(parseAthenaRightKey("billing.self.payments.read")),
    true
  );
  assert.equal(
    customer.rights.some(
      (key) => key === "self.payments.list" || key === "self.payments.get"
    ),
    false
  );
});

test("T-RETURN-007: Auth UI queries payments and coordinates checkout return", () => {
  const hooks = readFileSync(
    join(authUiBilling, "use-customer-billing.ts"),
    "utf8"
  );
  assert.match(hooks, /export function useCustomerPayments/);
  assert.match(hooks, /self\.payments\.list/);
  const settings = readFileSync(
    join(authUiBilling, "customer-billing-settings.tsx"),
    "utf8"
  );
  assert.match(settings, /function PaymentsSection/);
  assert.match(settings, /useBillingCheckoutReturn/);
  assert.match(settings, /Confirming payment/);
  assert.equal(settings.includes("function PaymentSection"), false);
  const coordinator = readFileSync(
    join(authUiBilling, "use-billing-checkout-return.ts"),
    "utf8"
  );
  assert.match(coordinator, /checkout\?\.resume/);
  assert.match(coordinator, /ATHENA_BILLING_RETURN_QUERY/);
  assert.match(coordinator, /1000, 2000, 4000, 8000/);
});
