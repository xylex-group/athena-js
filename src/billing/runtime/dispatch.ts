import type { AthenaPrincipal } from "../../runtime/data/principal.ts";
import { AthenaBillingCapabilityError } from "../errors.ts";
import type { BillingExecutionTarget } from "../types.ts";
import type { BillingAdminPort } from "./admin/types.ts";
import type {
  AthenaBillingRuntime,
  BillingRuntimeDispatchOperation,
} from "./types.ts";

export type { BillingRuntimeDispatchOperation };

export interface AthenaBillingRuntimeDispatch extends AthenaBillingRuntime {
  readonly admin: BillingAdminPort;
  execute(
    operation: BillingRuntimeDispatchOperation,
    payload: unknown,
    principal: AthenaPrincipal
  ): Promise<unknown>;
}

type BillingRuntimeDispatchHandler = (
  runtime: AthenaBillingRuntime,
  payload: unknown
) => Promise<unknown>;

function body(payload: unknown): never {
  return (
    payload != null && typeof payload === "object" ? payload : {}
  ) as never;
}

const BILLING_RUNTIME_DISPATCH = {
  "admin.conflicts.list": (runtime, payload) =>
    runtime.admin.conflicts.list(body(payload)),
  "admin.conflicts.resolve": (runtime, payload) =>
    runtime.admin.conflicts.resolve(body(payload)),
  "admin.connections.materialize": (runtime, payload) =>
    runtime.admin.connections.materialize(body(payload)),
  "admin.bootstrap.retry": (runtime) => runtime.admin.bootstrap.retry(),
  "admin.ingestion.health": (runtime, payload) =>
    runtime.admin.ingestion.health(body(payload)),
  "admin.reconciliation.retry": (runtime, payload) =>
    runtime.admin.reconciliation.retry(body(payload)),
  "admin.reconciliation.run": (runtime, payload) =>
    runtime.admin.reconciliation.run(body(payload)),
  "admin.webhooks.reconcile": (runtime, payload) =>
    runtime.admin.webhooks.reconcile(body(payload)),
  "admin.webhooks.status": (runtime, payload) =>
    runtime.admin.webhooks.status(body(payload)),
  "admin.webhooks.verify": (runtime, payload) =>
    runtime.admin.webhooks.verify(body(payload)),
  "checkout.create": (runtime, payload) =>
    runtime.checkout.create(body(payload)),
  "customers.create": (runtime, payload) =>
    runtime.customers.create(body(payload)),
  "customers.delete": (runtime, payload) =>
    runtime.customers.delete(body(payload)),
  "customers.get": (runtime, payload) => runtime.customers.get(body(payload)),
  "customers.list": (runtime, payload) => runtime.customers.list(body(payload)),
  "customers.update": (runtime, payload) =>
    runtime.customers.update(body(payload)),
  getCapabilities: (runtime, payload) =>
    runtime.getCapabilities(body(payload) as BillingExecutionTarget),
  "invoices.get": (runtime, payload) => runtime.invoices.get(body(payload)),
  "invoices.list": (runtime, payload) => runtime.invoices.list(body(payload)),
  "paymentLinks.create": (runtime, payload) =>
    runtime.paymentLinks.create(body(payload)),
  "paymentLinks.delete": (runtime, payload) =>
    runtime.paymentLinks.delete(body(payload)),
  "paymentLinks.get": (runtime, payload) =>
    runtime.paymentLinks.get(body(payload)),
  "paymentLinks.list": (runtime, payload) =>
    runtime.paymentLinks.list(body(payload)),
  "paymentLinks.update": (runtime, payload) =>
    runtime.paymentLinks.update(body(payload)),
  "payments.cancel": (runtime, payload) =>
    runtime.payments.cancel(body(payload)),
  "payments.create": (runtime, payload) =>
    runtime.payments.create(body(payload)),
  "payments.get": (runtime, payload) => runtime.payments.get(body(payload)),
  "payments.list": (runtime, payload) => runtime.payments.list(body(payload)),
  "prices.list": (runtime, payload) => runtime.prices.list(body(payload)),
  "products.list": (runtime, payload) => runtime.products.list(body(payload)),
  "relations.list": (runtime, payload) =>
    runtime.relations.list(body(payload)),
  "refunds.cancel": (runtime, payload) => runtime.refunds.cancel(body(payload)),
  "refunds.create": (runtime, payload) => runtime.refunds.create(body(payload)),
  "refunds.get": (runtime, payload) => runtime.refunds.get(body(payload)),
  "refunds.list": (runtime, payload) => runtime.refunds.list(body(payload)),
  "self.checkout.create": (runtime, payload) =>
    runtime.self.checkout.create(body(payload)),
  "self.checkout.resume": (runtime, payload) =>
    runtime.self.checkout.resume(body(payload)),
  "self.customer.get": (runtime, payload) =>
    runtime.self.customer.get(body(payload)),
  "self.entitlements": (runtime, payload) =>
    runtime.self.entitlements(body(payload)),
  "self.invoices.get": (runtime, payload) =>
    runtime.self.invoices.get(body(payload)),
  "self.invoices.list": (runtime, payload) =>
    runtime.self.invoices.list(body(payload)),
  "self.payments.get": (runtime, payload) =>
    runtime.self.payments.get(body(payload)),
  "self.payments.list": (runtime, payload) =>
    runtime.self.payments.list(body(payload)),
  "self.subscription.cancel": (runtime, payload) =>
    runtime.self.subscription.cancel(body(payload)),
  "self.subscription.change": (runtime, payload) =>
    runtime.self.subscription.change(body(payload)),
  "self.subscription.enroll": (runtime, payload) =>
    runtime.self.subscription.enroll(body(payload)),
  "self.subscription.get": (runtime, payload) =>
    runtime.self.subscription.get(body(payload)),
  "subscriptions.cancel": (runtime, payload) =>
    runtime.subscriptions.cancel(body(payload)),
  "subscriptions.create": (runtime, payload) =>
    runtime.subscriptions.create(body(payload)),
  "subscriptions.get": (runtime, payload) =>
    runtime.subscriptions.get(body(payload)),
  "subscriptions.list": (runtime, payload) =>
    runtime.subscriptions.list(body(payload)),
  "subscriptions.update": (runtime, payload) =>
    runtime.subscriptions.update(body(payload)),
  "webhooks.create": (runtime, payload) =>
    runtime.webhooks.create(body(payload)),
  "webhooks.delete": (runtime, payload) =>
    runtime.webhooks.delete(body(payload)),
  "webhooks.get": (runtime, payload) => runtime.webhooks.get(body(payload)),
  "webhooks.list": (runtime, payload) => runtime.webhooks.list(body(payload)),
  "webhooks.test": (runtime, payload) => runtime.webhooks.test(body(payload)),
  "webhooks.update": (runtime, payload) =>
    runtime.webhooks.update(body(payload)),
} as const satisfies Record<
  BillingRuntimeDispatchOperation,
  BillingRuntimeDispatchHandler
>;

export async function invokeBillingRuntimePort(
  runtime: AthenaBillingRuntime,
  operation: BillingRuntimeDispatchOperation,
  payload: unknown
): Promise<unknown> {
  const handler: BillingRuntimeDispatchHandler | undefined =
    BILLING_RUNTIME_DISPATCH[operation];
  if (handler == null) {
    throw new AthenaBillingCapabilityError({
      operation,
      reason: "unsupported_operation",
    });
  }
  return handler(runtime, payload);
}
