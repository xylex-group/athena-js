import type { AthenaBillingModule } from "../../module.ts";
import type { AthenaPrincipal } from "../../../runtime/data/principal.ts";
import type { BillingSelfPort } from "../types.ts";
import type { AthenaBillingRuntimeDispatch } from "../dispatch.ts";
import type { SelfBillingOperation } from "./dispatch.ts";
import { selfDelegatedBillingPrincipal } from "./delegated-principal.ts";

/**
 * Rebind only customer self-service Billing for a request view.
 *
 * Local Billing is materialized once for the process, so its ordinary ports
 * retain process ownership. Self operations already have a principal-aware
 * execute boundary; this adapter uses that boundary without changing the
 * process-owned module or its merchant/admin ports.
 */
export function createRequestScopedBillingFacade(input: {
  base: AthenaBillingModule;
  runtime: AthenaBillingRuntimeDispatch;
  userId: string;
  organizationId?: string;
}): AthenaBillingModule {
  const subject: AthenaPrincipal = {
    authenticated: true,
    grants: [],
    rights: [],
    userId: input.userId,
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
  };

  const execute = <T>(operation: SelfBillingOperation) =>
    (payload: unknown): Promise<T> =>
      input.runtime.execute(
        operation,
        payload,
        selfDelegatedBillingPrincipal(subject, [operation]),
      ) as Promise<T>;

  const self = {
    checkout: {
      create: execute("self.checkout.create"),
      resume: execute("self.checkout.resume"),
    },
    customer: {
      get: execute("self.customer.get"),
    },
    entitlements: execute("self.entitlements"),
    invoices: {
      get: execute("self.invoices.get"),
      list: execute("self.invoices.list"),
    },
    payments: {
      get: execute("self.payments.get"),
      list: execute("self.payments.list"),
    },
    subscription: {
      cancel: execute("self.subscription.cancel"),
      change: execute("self.subscription.change"),
      enroll: execute("self.subscription.enroll"),
      get: execute("self.subscription.get"),
      getChangeOperation: execute("self.subscription.get"),
    },
  } as unknown as BillingSelfPort;

  return new Proxy(input.base, {
    get(target, property, receiver) {
      return property === "self"
        ? self
        : Reflect.get(target, property, receiver);
    },
  });
}
