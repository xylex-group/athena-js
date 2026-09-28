import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { normalizeBillingMoney } from "../src/billing/safety/money.ts";

test("P2: Support all ISO currency exponents", () => {
  assert.deepEqual(
    normalizeBillingMoney({ currency: "CLF", value: "1.2345" }),
    {
      currency: "CLF",
      value: "1.2345",
    }
  );
  assert.deepEqual(normalizeBillingMoney({ currency: "UYW", value: "2.5" }), {
    currency: "UYW",
    value: "2.5000",
  });
  assert.deepEqual(normalizeBillingMoney({ currency: "ISK", value: "100" }), {
    currency: "ISK",
    value: "100",
  });
  assert.throws(
    () => normalizeBillingMoney({ currency: "CLF", value: "1.23456" }),
    { message: "ATHENA_BILLING_MONEY_SCALE_INVALID" }
  );
  assert.deepEqual(normalizeBillingMoney({ currency: "EUR", value: "007.5" }), {
    currency: "EUR",
    value: "7.50",
  });
  assert.throws(
    () =>
      normalizeBillingMoney({
        currency: "EUR",
        value: `${"1".repeat(13)}.00`,
      }),
    { message: "ATHENA_BILLING_MONEY_VALUE_INVALID" }
  );
});
