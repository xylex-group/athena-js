import { AthenaConfigurationError } from "../../config/errors.ts";
import { AthenaBillingCapabilityError } from "../errors.ts";
import type { AthenaBillingModule } from "../module.ts";
import {
  invokeBillingRuntimePort,
  type AthenaBillingRuntimeDispatch,
  type BillingRuntimeDispatchOperation,
} from "./dispatch.ts";

type FlatMember =
  | "cancelPayment"
  | "cancelRefund"
  | "cancelSubscription"
  | "createCheckout"
  | "createConnection"
  | "createCustomer"
  | "createPayment"
  | "createPaymentLink"
  | "createRefund"
  | "createSubscription"
  | "createWebhook"
  | "deleteConnection"
  | "deleteCustomer"
  | "deletePaymentLink"
  | "deleteWebhook"
  | "getConnection"
  | "getCustomer"
  | "getDebugBilling"
  | "getInvoice"
  | "getPayment"
  | "getPaymentLink"
  | "getRefund"
  | "getSubscription"
  | "getWebhook"
  | "ingestProviderWebhook"
  | "listConnections"
  | "listCustomers"
  | "listGrants"
  | "listInvoices"
  | "listPaymentLinks"
  | "listPayments"
  | "listPrices"
  | "listProducts"
  | "listProviders"
  | "listRefunds"
  | "listSinkHelpers"
  | "listSubscriptions"
  | "listWebhookEvents"
  | "listWebhooks"
  | "provisionWebhookSinks"
  | "reconcileDocument"
  | "testWebhook"
  | "updateConnection"
  | "updateCustomer"
  | "updatePaymentLink"
  | "updateSubscription"
  | "updateWebhook";

type FlatDisposition =
  | BillingRuntimeDispatchOperation
  | "compound_identity"
  | "unsupported";

const FLAT_OPERATIONS: Record<FlatMember, FlatDisposition> = {
  cancelPayment: "payments.cancel",
  cancelRefund: "refunds.cancel",
  cancelSubscription: "compound_identity",
  createCheckout: "checkout.create",
  createConnection: "unsupported",
  createCustomer: "customers.create",
  createPayment: "payments.create",
  createPaymentLink: "paymentLinks.create",
  createRefund: "refunds.create",
  createSubscription: "subscriptions.create",
  createWebhook: "webhooks.create",
  deleteConnection: "unsupported",
  deleteCustomer: "customers.delete",
  deletePaymentLink: "paymentLinks.delete",
  deleteWebhook: "webhooks.delete",
  getConnection: "unsupported",
  getCustomer: "customers.get",
  getDebugBilling: "unsupported",
  getInvoice: "invoices.get",
  getPayment: "payments.get",
  getPaymentLink: "paymentLinks.get",
  getRefund: "refunds.get",
  getSubscription: "compound_identity",
  getWebhook: "webhooks.get",
  ingestProviderWebhook: "unsupported",
  listConnections: "unsupported",
  listCustomers: "customers.list",
  listGrants: "unsupported",
  listInvoices: "invoices.list",
  listPaymentLinks: "paymentLinks.list",
  listPayments: "payments.list",
  listPrices: "prices.list",
  listProducts: "products.list",
  listProviders: "unsupported",
  listRefunds: "refunds.list",
  listSinkHelpers: "unsupported",
  listSubscriptions: "subscriptions.list",
  listWebhookEvents: "unsupported",
  listWebhooks: "webhooks.list",
  provisionWebhookSinks: "unsupported",
  reconcileDocument: "unsupported",
  testWebhook: "webhooks.test",
  updateConnection: "unsupported",
  updateCustomer: "customers.update",
  updatePaymentLink: "paymentLinks.update",
  updateSubscription: "compound_identity",
  updateWebhook: "webhooks.update",
};

function isFlatMember(value: string): value is FlatMember {
  return value in FLAT_OPERATIONS;
}

function withId(id: unknown, input: unknown): Record<string, unknown> {
  return {
    ...(input != null && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {}),
    id,
  };
}

function unsupportedFlatOperation(name: string): never {
  throw new AthenaBillingCapabilityError({
    message: `Billing compatibility operation ${name} cannot be losslessly adapted to the selected runtime.`,
    operation: name,
    reason: "unsupported_operation",
  });
}

function withSubscriptionId(
  id: unknown,
  input: unknown,
  operation: string
): Record<string, unknown> {
  const record =
    input != null && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : undefined;
  if (
    record == null ||
    typeof record.customerId !== "string" ||
    record.customerId.length === 0
  ) {
    return unsupportedFlatOperation(operation);
  }
  return {
    ...record,
    subscriptionId: id,
  };
}

function flatPayload(name: string, args: readonly unknown[]): unknown {
  switch (name) {
    case "cancelPayment":
    case "cancelRefund":
    case "deleteCustomer":
    case "deletePaymentLink":
    case "getCustomer":
    case "getInvoice":
    case "getPayment":
    case "getPaymentLink":
    case "getRefund":
    case "getWebhook":
    case "testWebhook":
      return withId(args[0], args[1]);
    case "cancelSubscription":
      return withSubscriptionId(args[0], args[1], "subscriptions.cancel");
    case "getSubscription":
      return withSubscriptionId(args[0], args[1], "subscriptions.get");
    case "createWebhook":
      return {
        ...(args[0] != null && typeof args[0] === "object"
          ? (args[0] as Record<string, unknown>)
          : {}),
        ...(args[1] != null && typeof args[1] === "object"
          ? (args[1] as Record<string, unknown>)
          : {}),
      };
    case "updateWebhook":
      return {
        ...withId(args[0], args[1]),
        ...(args[2] != null && typeof args[2] === "object"
          ? (args[2] as Record<string, unknown>)
          : {}),
      };
    case "updateSubscription":
      return withSubscriptionId(args[0], args[1], "subscriptions.update");
    case "createCheckout":
    case "createCustomer":
    case "createPayment":
    case "createPaymentLink":
    case "createRefund":
    case "createSubscription":
    case "listCustomers":
    case "listInvoices":
    case "listPaymentLinks":
    case "listPayments":
    case "listPrices":
    case "listProducts":
    case "listRefunds":
    case "listSubscriptions":
    case "listWebhooks":
      return args[0] ?? {};
    case "updateCustomer":
    case "updatePaymentLink":
      return withId(args[0], args[1]);
    default:
      return args[0] ?? {};
  }
}

export function createBillingRuntimeFacade(
  runtime: AthenaBillingRuntimeDispatch,
  compatibility?: AthenaBillingModule
): AthenaBillingModule {
  const canonical = {
    ...(compatibility ?? {}),
    admin: runtime.admin,
    catalog: {
      prices: runtime.prices,
      products: runtime.products,
      relations: runtime.relations,
    },
    checkout: runtime.checkout,
    customers: runtime.customers,
    getCapabilities: runtime.getCapabilities,
    health: runtime.health,
    invoices: runtime.invoices,
    paymentLinks: runtime.paymentLinks,
    payments: runtime.payments,
    refunds: runtime.refunds,
    self: runtime.self,
    subscriptions: runtime.subscriptions,
    webhooks: runtime.webhooks,
  };

  return new Proxy(canonical, {
    get(target, property, receiver) {
      if (typeof property !== "string") {
        return Reflect.get(target, property, receiver);
      }

      const existing = Reflect.get(target, property, receiver);
      if (existing !== undefined) {
        return existing;
      }
      if (!isFlatMember(property)) {
        return undefined;
      }
      const operation = FLAT_OPERATIONS[property];
      if (operation === "unsupported") {
        return async (..._args: readonly unknown[]) =>
          unsupportedFlatOperation(property);
      }
      if (operation === "compound_identity") {
        return async (...args: readonly unknown[]) =>
          invokeBillingRuntimePort(
            runtime,
            property === "cancelSubscription"
              ? "subscriptions.cancel"
              : property === "getSubscription"
                ? "subscriptions.get"
                : "subscriptions.update",
            flatPayload(property, args)
          );
      }
      return (...args: readonly unknown[]) =>
        invokeBillingRuntimePort(
          runtime,
          operation,
          flatPayload(property, args)
        );
    },
  }) as AthenaBillingModule;
}

export function createUnavailableBillingFacade(
  reason = "Athena billing is not configured."
): AthenaBillingModule {
  const fail = (): never => {
    throw new AthenaConfigurationError(
      "ATHENA_SERVICE_NOT_CONFIGURED",
      reason,
      "billing"
    );
  };
  const namespace = (): unknown =>
    new Proxy(fail, {
      apply: fail,
      get: () => namespace(),
    });
  return namespace() as AthenaBillingModule;
}
