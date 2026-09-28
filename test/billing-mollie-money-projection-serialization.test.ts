import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { isAthenaBillingProviderRequestError } from "../src/billing/errors.ts";
import { projectMolliePayment } from "../src/billing/runtime/local/providers/mollie/projection.ts";

test("P2: Wrap money projection failures as serialization errors", () => {
  assert.throws(
    () =>
      projectMolliePayment({
        amount: { currency: "EUR", value: "10.001" },
        id: "tr_local_1",
        status: "paid",
      }),
    (error: unknown) =>
      isAthenaBillingProviderRequestError(error) &&
      error.kind === "serialization" &&
      error.provider === "mollie" &&
      error.message === "ATHENA_BILLING_MONEY_SCALE_INVALID" &&
      error.retry === "never"
  );
});
