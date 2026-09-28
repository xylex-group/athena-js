import { strict as assert } from "node:assert";
import { test } from "node:test";

import { AthenaBillingCapabilityError } from "../../src/billing/errors.ts";
import { executeSelfBillingOperation } from "../../src/billing/runtime/self/runtime.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";
import type { AthenaPrincipal } from "../../src/runtime/data/principal.ts";

const principal: AthenaPrincipal = {
  authenticated: true,
  grants: [],
  rights: [
    "billing.self.invoices.read",
    "billing.self.payments.read",
    "billing.self.subscription.read",
    "billing.self.subscription.write",
    "billing.self.checkout.write",
  ].map(parseAthenaRightKey),
  userId: "self-validation-user",
};

const sql = {
  async query() {
    return { rows: [] };
  },
};

test("self validation reports the operation that rejected its required string", async () => {
  const cases = [
    ["self.invoices.get", "invoiceId"],
    ["self.payments.get", "paymentId"],
    ["self.subscription.cancel", "subscriptionId"],
    ["self.subscription.enroll", "idempotencyKey"],
    ["self.subscription.change", "idempotencyKey"],
    ["self.checkout.create", "idempotencyKey"],
    ["self.checkout.resume", "returnToken"],
  ] as const;

  for (const [operation, key] of cases) {
    await assert.rejects(
      () =>
        executeSelfBillingOperation({
          operation,
          payload: { [key]: "" },
          principal,
          sql,
        }),
      (error: unknown) => {
        assert.ok(error instanceof AthenaBillingCapabilityError);
        assert.equal(error.operation, operation);
        assert.equal(error.reason, "unsupported_operation");
        assert.match(error.message, new RegExp(operation.replaceAll(".", "\\.")));
        return true;
      }
    );
  }
});
