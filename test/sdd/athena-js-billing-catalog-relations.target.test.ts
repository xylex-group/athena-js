import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AthenaBillingProviderError, isAthenaBillingCapabilityError } from "../../src/billing/errors.ts";
import { PROCESS_BILLING_INVOCATION } from "../../src/billing/runtime/invocation-authority.ts";
import { normalizeAthenaBillingCatalog } from "../../src/billing/runtime/local/catalog/normalize.ts";
import { createBillingProviderRegistry } from "../../src/billing/runtime/local/providers/create-registry.ts";
import { createLocalBillingRuntime } from "../../src/billing/runtime/local/runtime.ts";
import { hashCheckoutIntent } from "../../src/billing/runtime/self/checkout-intent-hash.ts";
import { resolveCheckoutSettlement } from "../../src/billing/runtime/self/checkout-settlement.ts";
import { paymentAmountFromCheckoutSnapshot } from "../../src/billing/runtime/self/checkout-snapshot.ts";
import {
  checkoutSessionKindForWorkflow,
  resolveCheckoutWorkflow,
} from "../../src/billing/runtime/self/checkout-workflow.ts";
import { planSelfCheckoutComposition } from "../../src/billing/runtime/self/composition.ts";
import { requireBillingSqlTransaction } from "../../src/billing/runtime/self/enrollment-session.ts";
import type { BillingCatalogRelation, BillingPrice } from "../../src/billing/types.ts";
import { FetchMollieSdk } from "../helpers/fetch-mollie-sdk.ts";

test("catalog relations normalize referential integrity", () => {
  assert.throws(
    () =>
      normalizeAthenaBillingCatalog({
        products: [{ id: "starter", name: "Starter" }],
        relations: [
          {
            id: "rel_1",
            sourceProductId: "starter",
            targetProductId: "missing",
            type: "addon",
          },
        ],
      }),
    AthenaBillingProviderError
  );
  assert.throws(
    () =>
      normalizeAthenaBillingCatalog({
        products: [{ id: "starter", name: "Starter" }],
        relations: [
          {
            id: "rel_self",
            sourceProductId: "starter",
            targetProductId: "starter",
            type: "addon",
          },
        ],
      }),
    AthenaBillingProviderError
  );
  const catalog = normalizeAthenaBillingCatalog({
    products: [
      { id: "starter", name: "Starter" },
      { id: "support", name: "Support" },
    ],
    relations: [
      {
        id: "rel_addon",
        sourceProductId: "starter",
        targetProductId: "support",
        type: "addon",
      },
    ],
  });
  assert.equal(catalog?.relations?.length, 1);
  assert.equal(catalog?.relations?.[0]?.type, "addon");
});

const prices: BillingPrice[] = [
  {
    amount: { currency: "EUR", value: "99.00" },
    id: "starter-once",
    metadata: {},
    productId: "starter",
    raw: {},
  },
  {
    amount: { currency: "EUR", value: "15.00" },
    id: "support-once",
    metadata: {},
    productId: "support",
    raw: {},
  },
  {
    amount: { currency: "EUR", value: "9.00" },
    id: "starter-monthly",
    interval: "month",
    metadata: {},
    productId: "starter",
    raw: {},
  },
];

const relations: BillingCatalogRelation[] = [
  {
    id: "rel_addon",
    metadata: {},
    raw: {},
    sourceProductId: "starter",
    targetProductId: "support",
    type: "addon",
  },
];

test("checkout composition aggregates one-off lines and rejects two recurring", () => {
  const planned = planSelfCheckoutComposition({
    lines: [
      { priceId: "starter-once", quantity: 1 },
      { priceId: "support-once", quantity: 1 },
    ],
    prices,
    relations,
  });
  assert.equal(planned.oneOffLines.length, 2);
  assert.equal(planned.oneOffTotal?.value, "114.00");
  assert.equal(planned.recurringLine, null);
  assert.equal(resolveCheckoutSettlement(planned)?.model, "one_off_lines");
  assert.equal(
    resolveCheckoutSettlement(planned)?.providerPaymentAmount.value,
    "114.00"
  );

  assert.throws(() =>
    planSelfCheckoutComposition({
      lines: [
        { priceId: "starter-monthly", quantity: 1 },
        { priceId: "starter-monthly", quantity: 1 },
      ],
      prices,
      relations: [],
    })
  );
});

test("checkout composition accepts one recurring line with related one-off add-ons", () => {
  const planned = planSelfCheckoutComposition({
    lines: [
      { priceId: "starter-monthly", quantity: 1 },
      { priceId: "support-once", quantity: 1 },
    ],
    prices,
    relations,
  });
  assert.equal(planned.oneOffLines.length, 1);
  assert.equal(planned.oneOffTotal?.value, "15.00");
  assert.equal(planned.recurringLine?.price.id, "starter-monthly");
  const settlement = resolveCheckoutSettlement(planned);
  assert.equal(settlement?.model, "setup_addons_only");
  assert.equal(settlement?.includesRecurringFirstInstallment, false);
  assert.equal(settlement?.providerPaymentAmount.value, "15.00");
  assert.notEqual(settlement?.providerPaymentAmount.value, "24.00");
  assert.equal(resolveCheckoutWorkflow(planned), "composed");
  assert.equal(
    checkoutSessionKindForWorkflow("composed"),
    "subscription_enrollment"
  );
});

test("composed checkout does not create a subscription before payment finality", () => {
  const checkout = readFileSync(
    new URL("../../src/billing/runtime/self/checkout.ts", import.meta.url),
    "utf8"
  );
  const advance = readFileSync(
    new URL(
      "../../src/billing/runtime/self/advance-enrollment.ts",
      import.meta.url
    ),
    "utf8"
  );
  const resume = readFileSync(
    new URL("../../src/billing/runtime/self/resume.ts", import.meta.url),
    "utf8"
  );
  assert.equal(checkout.includes("createRecurringSubscriptionForPrice"), false);
  assert.equal(checkout.includes("markEnrollmentActive"), false);
  const body = checkout.slice(checkout.indexOf("export async function createSelfCheckout"));
  const linesIdx = body.indexOf("insertCheckoutSessionLines");
  const lastPaymentIdx = body.lastIndexOf(
    "requireProviderPaymentFromCheckoutSnapshot"
  );
  assert.ok(linesIdx >= 0 && lastPaymentIdx >= 0);
  assert.ok(linesIdx < lastPaymentIdx);
  assert.match(advance, /claimed\.priceId/);
  assert.match(resume, /checkoutSessionNeedsEnrollmentAdvance/);
  assert.equal(resume.includes("executeLocalBillingPriceList"), false);
  assert.match(resume, /createProviderPaymentFromCheckoutSnapshot/);
  assert.equal(resume.includes('if (session.kind !== "one_off")'), false);
  assert.match(checkout, /assertMatchingCheckoutIntent/);
  assert.match(checkout, /resolveCheckoutSettlement/);
  assert.match(checkout, /checkoutSettlement/);
  assert.match(checkout, /requireProviderPaymentFromCheckoutSnapshot/);
  assert.match(checkout, /assertMatchingCheckoutRequest/);
  assert.equal(checkout.includes("executeLocalBillingPaymentCreate"), false);
  assert.equal(advance.includes("executeLocalBillingPriceList"), false);
  assert.match(advance, /recurringPriceFromCheckoutSnapshot/);
  assert.match(resume, /createProviderPaymentFromCheckoutSnapshot/);
  const composition = readFileSync(
    new URL("../../src/billing/runtime/self/composition.ts", import.meta.url),
    "utf8"
  );
  assert.match(composition, /sourceProductId === input.primaryProductId/);
  assert.match(composition, /const COMPOSITION_EDGES = new Set\(\["addon"\]\)/);
  assert.match(checkout, /requireBillingSqlTransaction/);
  const sessionLines = readFileSync(
    new URL("../../src/billing/runtime/self/enrollment-session.ts", import.meta.url),
    "utf8"
  );
  const insertLines = sessionLines.slice(
    sessionLines.indexOf("export async function insertCheckoutSessionLines")
  );
  assert.equal(insertLines.includes("for (const line of input.lines)"), false);
  assert.match(insertLines, /VALUES \$\{values\.join/);
  assert.match(sessionLines, /AthenaBillingCapabilityError/);
  const localRuntime = readFileSync(
    new URL("../../src/billing/runtime/local/runtime.ts", import.meta.url),
    "utf8"
  );
  assert.match(localRuntime, /sqlTransactional/);
  assert.match(localRuntime, /operation === "self.checkout.create"/);
});

test("checkout composition rejects transitive addon walks and upsell upgrades", () => {
  const chain: BillingCatalogRelation[] = [
    {
      id: "rel_addon",
      metadata: {},
      raw: {},
      sourceProductId: "starter",
      targetProductId: "support",
      type: "addon",
    },
    {
      id: "rel_nested",
      metadata: {},
      raw: {},
      sourceProductId: "support",
      targetProductId: "extra",
      type: "addon",
    },
  ];
  const chainPrices: BillingPrice[] = [
    ...prices,
    {
      amount: { currency: "EUR", value: "5.00" },
      id: "extra-once",
      metadata: {},
      productId: "extra",
      raw: {},
    },
  ];
  assert.throws(() =>
    planSelfCheckoutComposition({
      lines: [
        { priceId: "starter-monthly", quantity: 1 },
        { priceId: "support-once", quantity: 1 },
        { priceId: "extra-once", quantity: 1 },
      ],
      prices: chainPrices,
      relations: chain,
    })
  );
  assert.throws(() =>
    planSelfCheckoutComposition({
      lines: [
        { priceId: "starter-once", quantity: 1 },
        { priceId: "support-once", quantity: 1 },
      ],
      prices,
      relations: [
        {
          id: "rel_upsell",
          metadata: {},
          raw: {},
          sourceProductId: "starter",
          targetProductId: "support",
          type: "upsell",
        },
      ],
    })
  );
  assert.throws(() =>
    planSelfCheckoutComposition({
      lines: [
        { priceId: "starter-once", quantity: 1 },
        { priceId: "support-once", quantity: 1 },
      ],
      prices,
      relations: [
        {
          id: "rel_upgrade",
          metadata: {},
          raw: {},
          sourceProductId: "starter",
          targetProductId: "support",
          type: "upgrade",
        },
      ],
    })
  );
});

test("payment recovery totals only one-off snapshot lines", () => {
  const amount = paymentAmountFromCheckoutSnapshot([
    {
      amountCurrency: "EUR",
      amountValue: "99.00",
      checkoutSessionId: "sess",
      id: "l1",
      interval: null,
      ordinal: 0,
      priceId: "starter-once",
      productId: "starter",
      quantity: 1,
      relationId: null,
    },
    {
      amountCurrency: "EUR",
      amountValue: "15.00",
      checkoutSessionId: "sess",
      id: "l2",
      interval: null,
      ordinal: 1,
      priceId: "support-once",
      productId: "support",
      quantity: 1,
      relationId: "rel_addon",
    },
    {
      amountCurrency: "EUR",
      amountValue: "9.00",
      checkoutSessionId: "sess",
      id: "l3",
      interval: "month",
      ordinal: 2,
      priceId: "starter-monthly",
      productId: "starter",
      quantity: 1,
      relationId: null,
    },
  ]);
  assert.equal(amount?.value, "114.00");
});

test("mixed snapshot recovery settles add-ons only", () => {
  const amount = paymentAmountFromCheckoutSnapshot([
    {
      amountCurrency: "EUR",
      amountValue: "9.00",
      checkoutSessionId: "sess",
      id: "l1",
      interval: "month",
      ordinal: 0,
      priceId: "starter-monthly",
      productId: "starter",
      quantity: 1,
      relationId: null,
    },
    {
      amountCurrency: "EUR",
      amountValue: "15.00",
      checkoutSessionId: "sess",
      id: "l2",
      interval: null,
      ordinal: 1,
      priceId: "support-once",
      productId: "support",
      quantity: 1,
      relationId: "rel_addon",
    },
  ]);
  assert.equal(amount?.value, "15.00");
});

test("checkout intent hash is order-stable and changes with composition", () => {
  const starter = {
    amountCurrency: "EUR",
    amountValue: "99.00",
    interval: null,
    priceId: "starter-once",
    productId: "starter",
    quantity: 1,
    relationId: null,
  };
  const support = {
    amountCurrency: "EUR",
    amountValue: "15.00",
    interval: null,
    priceId: "support-once",
    productId: "support",
    quantity: 1,
    relationId: "rel_addon",
  };
  const extra = {
    ...support,
    priceId: "extra-once",
    productId: "extra",
    relationId: "rel_extra",
    amountValue: "20.00",
  };
  assert.equal(
    hashCheckoutIntent([starter, support]),
    hashCheckoutIntent([support, starter])
  );
  assert.notEqual(
    hashCheckoutIntent([starter, support]),
    hashCheckoutIntent([starter, extra])
  );
});

test("self.checkout.create is unavailable without a transactional SQL executor", async () => {
  await assert.rejects(
    () =>
      requireBillingSqlTransaction(
        { query: async () => ({ rows: [] }) },
        async () => undefined
      ),
    (error: unknown) =>
      isAthenaBillingCapabilityError(error) &&
      error.operation === "self.checkout.create" &&
      error.reason === "runtime_unavailable"
  );
  const catalog = {
    prices: [
      {
        amount: { currency: "EUR", value: "9.00" },
        id: "price_once",
        productId: "starter",
      },
    ],
    products: [{ id: "starter", name: "Starter" }],
  };
  const configured = {
    mollie: { sdk: FetchMollieSdk, testKey: "test_checkout_txn" },
  };
  const queryOnly = createLocalBillingRuntime({
    configuredProviders: configured,
    invocation: PROCESS_BILLING_INVOCATION,
    registry: createBillingProviderRegistry(configured, catalog),
    sql: { query: async () => ({ rows: [] }) },
    testMode: true,
  });
  const queryOnlyCaps = await queryOnly.getCapabilities({ provider: "mollie" });
  assert.equal(queryOnlyCaps.operations["self.checkout.create"]?.available, false);
  assert.equal(
    queryOnlyCaps.operations["self.checkout.create"]?.reason,
    "runtime_unavailable"
  );
  const sql = {
    query: async () => ({ rows: [] }),
    async transaction<T>(fn: (tx: typeof sql) => Promise<T>) {
      return fn(sql);
    },
  };
  const transactional = createLocalBillingRuntime({
    configuredProviders: configured,
    invocation: PROCESS_BILLING_INVOCATION,
    registry: createBillingProviderRegistry(configured, catalog),
    sql,
    testMode: true,
  });
  const transactionalCaps = await transactional.getCapabilities({
    provider: "mollie",
  });
  assert.equal(transactionalCaps.connected, false);
  assert.equal(
    transactionalCaps.operations["self.checkout.create"]?.available,
    false
  );
  assert.equal(
    transactionalCaps.operations["self.checkout.create"]?.reason,
    "provider_connection_missing"
  );
});
