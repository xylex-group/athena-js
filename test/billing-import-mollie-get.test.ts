import assert from "node:assert/strict";
import test from "node:test";
import { createMollieBillingCustomerImportPort } from "../src/billing/import/providers/mollie.ts";
import { BillingSecret } from "../src/billing/runtime/credentials.ts";
import { createBillingProviderExecutionContext } from "../src/billing/runtime/local/providers/execution-context.ts";
import { MollieSdkClientPool } from "../src/billing/runtime/local/providers/mollie/sdk/client-factory.ts";

function unusedMollieResource(): Record<string, () => Promise<unknown>> {
  return {
    cancel: async () => ({}),
    create: async () => ({}),
    delete: async () => ({}),
    get: async () => ({}),
    list: async () => ({}),
    update: async () => ({}),
  };
}

test("targeted customer import calls customers.get with customerId", async () => {
  const captured: Record<string, unknown>[] = [];
  const customers = unusedMollieResource();
  customers.get = async (request: Record<string, unknown>) => {
    captured.push(request);
    return { id: "cst_test" };
  };
  const pool = new MollieSdkClientPool({
    adapter: () => ({
      customers,
      invoices: unusedMollieResource(),
      paymentLinks: unusedMollieResource(),
      payments: unusedMollieResource(),
      refunds: unusedMollieResource(),
      salesInvoices: unusedMollieResource(),
      subscriptions: unusedMollieResource(),
      webhooks: unusedMollieResource(),
    }),
    apiBaseUrl: "https://api.mollie.com",
    credentialKind: "api_key",
    sdk: class { },
  } as never);
  const context = createBillingProviderExecutionContext({
    binding: {
      credentials: {
        test: {
          kind: "api_key",
          secret: new BillingSecret("test_import_key"),
        },
      },
      kind: "configured",
      provider: "mollie",
      providerConfig: {},
    },
    testMode: true,
  });
  const port = createMollieBillingCustomerImportPort({ context, pool });
  const customer = await port.getCustomer({ customerId: "cst_test" });
  assert.equal(customer.providerCustomerId, "cst_test");
  assert.deepEqual(captured, [{ customerId: "cst_test" }]);
  assert.equal("id" in captured[0], false);
});
