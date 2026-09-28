import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { billingErrorFromTransport } from "../../src/billing/runtime/http-error.ts";
import { paymentCreateBody } from "../../src/billing/runtime/local/providers/mollie/dialect/payments.ts";
import { mollieLinkHref } from "../../src/billing/runtime/local/providers/mollie/projection/links.ts";
import { projectMolliePaymentLink } from "../../src/billing/runtime/local/providers/mollie/projection/payment-link.ts";
import { freezeBillingPaymentPresentation } from "../../src/billing/runtime/self/checkout-presentation.ts";
import { resolveBillingCheckoutIntent } from "../../src/billing/runtime/self/checkout-intent.ts";
import { getSelfSubscription } from "../../src/billing/runtime/self/subscriptions.ts";
import { BILLING_OPERATION_SAFETY } from "../../src/billing/safety/registry.ts";
import { validateBillingOperationPayload } from "../../src/billing/safety/validators.ts";
import { AthenaBillingSubjectError } from "../../src/billing/subject/errors.ts";
import type { BillingSqlExecutor } from "../../src/billing/subject/repository.ts";
import type { BillingPrice } from "../../src/billing/types.ts";
import type { AthenaPrincipal } from "../../src/runtime/data/principal.ts";

const CHECKOUT_HREF = "https://www.mollie.com/checkout/select-method/abc";

function price(interval?: string | null): BillingPrice {
  return {
    amount: { currency: "EUR", value: "10.00" },
    id: "price_monthly",
    interval,
    metadata: {},
    productId: "prod_1",
    raw: {},
  };
}

function principal(): AthenaPrincipal {
  return {
    authenticated: true,
    grants: [],
    rights: [],
    userId: "user_1",
  };
}

test("T-CHK-001: HAL _links.checkout.href projects checkoutUrl", () => {
  assert.equal(
    mollieLinkHref(
      { _links: { checkout: { href: CHECKOUT_HREF } } },
      "checkout"
    ),
    CHECKOUT_HREF
  );
});

test("T-CHK-002: SDK links.checkout.href projects checkoutUrl", () => {
  assert.equal(
    mollieLinkHref(
      { links: { checkout: { href: CHECKOUT_HREF } } },
      "checkout"
    ),
    CHECKOUT_HREF
  );
});

test("T-CHK-003: missing, empty, and invalid hrefs are null", () => {
  assert.equal(mollieLinkHref({}, "checkout"), null);
  assert.equal(
    mollieLinkHref({ links: { checkout: { href: "" } } }, "checkout"),
    null
  );
  assert.equal(
    mollieLinkHref(
      { links: { checkout: { href: "javascript:alert(1)" } } },
      "checkout"
    ),
    null
  );
});

test("T-CHK-004: catalog interval is recurring intent", () => {
  const intent = resolveBillingCheckoutIntent(price("month"));
  assert.equal(intent.kind, "recurring");
  if (intent.kind === "recurring") {
    assert.equal(intent.interval, "month");
  }
});

test("T-CHK-005: absent interval is one_time", () => {
  assert.equal(resolveBillingCheckoutIntent(price()).kind, "one_time");
  assert.equal(resolveBillingCheckoutIntent(price("  ")).kind, "one_time");
  assert.equal(resolveBillingCheckoutIntent(price(null)).kind, "one_time");
});

test("T-CHK-005b: explicit one-off interval tokens are one_time", () => {
  assert.equal(resolveBillingCheckoutIntent(price("one-off")).kind, "one_time");
  assert.equal(resolveBillingCheckoutIntent(price("once")).kind, "one_time");
});

test("T-CHK-006: missing subscription is ATHENA_BILLING_NOT_FOUND", async () => {
  const sql = {
    async query() {
      return { rows: [] };
    },
  } as unknown as BillingSqlExecutor;
  await assert.rejects(
    () => getSelfSubscription({ principal: principal(), sql }),
    (error: unknown) => {
      assert.ok(error instanceof AthenaBillingSubjectError);
      assert.equal(error.code, "ATHENA_BILLING_NOT_FOUND");
      assert.equal(error.status, 404);
      return true;
    }
  );
});

test("T-CHK-007: invalid subscription id does not query Postgres", async () => {
  let queried = false;
  const sql = {
    async query() {
      queried = true;
      return { rows: [] };
    },
  } as unknown as BillingSqlExecutor;
  await assert.rejects(
    () =>
      getSelfSubscription({
        principal: principal(),
        sql,
        subscriptionId: "not-a-uuid",
      }),
    (error: unknown) => {
      assert.ok(error instanceof AthenaBillingSubjectError);
      assert.equal(error.status, 404);
      return true;
    }
  );
  assert.equal(queried, false);
});

test("T-CHK-008: transport reconstructs NOT_FOUND as subject error", () => {
  const revived = billingErrorFromTransport({
    code: "ATHENA_BILLING_NOT_FOUND",
    message: "Billing document not found.",
    status: 404,
  });
  assert.ok(revived instanceof AthenaBillingSubjectError);
  assert.equal(revived.code, "ATHENA_BILLING_NOT_FOUND");
  assert.equal(revived.status, 404);
});

test("T-CHK-009: payment link projection accepts SDK links bag", () => {
  const link = projectMolliePaymentLink({
    id: "pl_1",
    links: {
      paymentLink: { href: "https://paymentlink.mollie.com/payment/abc" },
    },
  });
  assert.equal(link.checkoutUrl, "https://paymentlink.mollie.com/payment/abc");
});

test("T-CHK-010: freezes every payable line into a payment presentation", () => {
  const presentation = freezeBillingPaymentPresentation({
    kind: "checkout",
    lines: [
      { interval: null, priceId: "price_pro", productId: "prod_pro", quantity: 1 },
      {
        interval: null,
        priceId: "price_addon",
        productId: "prod_addon",
        quantity: 2,
      },
    ],
    operation: "self.checkout.create",
    products: [
      { id: "prod_pro", name: "Pro Plan" },
      { id: "prod_addon", name: "Analytics Add-on" },
    ],
  });

  assert.deepEqual(presentation, {
    description: "Athena checkout Pro Plan + 2 x Analytics Add-on",
    lines: [
      {
        priceId: "price_pro",
        productId: "prod_pro",
        productName: "Pro Plan",
        quantity: 1,
      },
      {
        priceId: "price_addon",
        productId: "prod_addon",
        productName: "Analytics Add-on",
        quantity: 2,
      },
    ],
  });
});

test("T-CHK-010b: mixed recurring and one-off lines stay visible", () => {
  const presentation = freezeBillingPaymentPresentation({
    kind: "checkout",
    lines: [
      {
        interval: "month",
        priceId: "price_pro",
        productId: "prod_pro",
        quantity: 1,
      },
      {
        interval: null,
        priceId: "price_addon",
        productId: "prod_addon",
        quantity: 1,
      },
    ],
    operation: "self.checkout.create",
    products: [
      { id: "prod_pro", name: "Pro Plan" },
      { id: "prod_addon", name: "Analytics Add-on" },
    ],
  });

  assert.deepEqual(
    presentation.lines.map((line) => line.productName),
    ["Pro Plan", "Analytics Add-on"]
  );
  assert.equal(
    presentation.description,
    "Athena checkout Pro Plan + Analytics Add-on"
  );
});

test("T-CHK-011: missing accepted product names fail closed", () => {
  assert.throws(
    () =>
      freezeBillingPaymentPresentation({
        kind: "first_payment",
        lines: [
          {
            interval: "month",
            priceId: "price_pro",
            productId: "prod_missing",
            quantity: 1,
          },
        ],
        operation: "self.subscription.enroll",
        products: [],
      }),
    (error: unknown) => {
      assert.equal((error as { reason?: string }).reason, "missing_catalog");
      return true;
    },
  );
});

test("T-CHK-012: cancel-only checkout return targets are valid", () => {
  const payload = validateBillingOperationPayload({
    operation: "self.checkout.create",
    payload: {
      cancelUrl: "https://merchant.example/canceled",
      idempotencyKey: "checkout_cancel_only",
      priceId: "price_addon",
    },
    profile: BILLING_OPERATION_SAFETY["self.checkout.create"],
  });

  assert.equal(payload.cancelUrl, "https://merchant.example/canceled");
});

test("T-CHK-013: Mollie receives distinct success and cancel targets", () => {
  const body = paymentCreateBody({
    amount: { currency: "EUR", value: "49.00" },
    cancelUrl: "https://merchant.example/canceled",
    description: "Athena checkout Pro Plan",
    idempotencyKey: "payment_1",
    metadata: { priceIds: ["price_pro"] },
    redirectUrl: "https://merchant.example/success",
  });

  assert.equal(body.redirectUrl, "https://merchant.example/success");
  assert.equal(body.cancelUrl, "https://merchant.example/canceled");
  assert.deepEqual(body.metadata, { priceIds: ["price_pro"] });
});
