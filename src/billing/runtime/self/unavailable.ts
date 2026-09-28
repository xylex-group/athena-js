import { AthenaBillingCapabilityError } from "../../errors.ts";
import type { BillingSelfPort } from "../types.ts";

export function createUnavailableBillingSelfPort(): BillingSelfPort {
  const fail = (operation: string) => (): Promise<never> => {
    throw new AthenaBillingCapabilityError({
      operation,
      reason: "runtime_unavailable",
    });
  };
  return {
    checkout: {
      create: fail("self.checkout.create"),
      resume: fail("self.checkout.resume"),
    },
    customer: {
      get: fail("self.customer.get"),
    },
    entitlements: fail("self.entitlements"),
    invoices: {
      get: fail("self.invoices.get"),
      list: fail("self.invoices.list"),
    },
    payments: {
      get: fail("self.payments.get"),
      list: fail("self.payments.list"),
    },
    subscription: {
      cancel: fail("self.subscription.cancel"),
      change: fail("self.subscription.change"),
      enroll: fail("self.subscription.enroll"),
      get: fail("self.subscription.get"),
    },
  };
}
