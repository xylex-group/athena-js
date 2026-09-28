import type { AthenaPrincipal } from "../../../runtime/data/principal.ts";
import { AthenaBillingCapabilityError } from "../../errors.ts";
import type { BillingProviderConfigMap } from "../../providers/types.ts";
import type { BillingSelfEnrollmentSetting } from "../../self-enrollment.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import type { BillingProviderRegistry } from "../local/providers/registry.ts";
import { denyBillingInvocation } from "../rights.ts";
import type { BillingSelfPort } from "../types.ts";
import { changeSelfSubscription } from "./change.ts";
import { createSelfCheckout } from "./checkout.ts";
import { getSelfCustomer } from "./customer.ts";
import {
  isSelfBillingOperation,
  rejectSelfPayloadSelectors,
  type SelfBillingOperation,
} from "./dispatch.ts";
import { enrollSelfSubscription } from "./enroll.ts";
import { getSelfEntitlements } from "./entitlements.ts";
import { getSelfInvoice, listSelfInvoices } from "./invoices.ts";
import { getSelfPayment, listSelfPayments } from "./payments.ts";
import { billingRedirectAllowlistFromAppUrl } from "./redirect-url.ts";
import { resumeSelfCheckout } from "./resume.ts";
import {
  cancelSelfSubscription,
  getSelfSubscription,
} from "./subscriptions.ts";
import { getSelfSubscriptionChangeOperation } from "../../workflows/plan-change/change-operation.ts";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  operation: SelfBillingOperation
): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new AthenaBillingCapabilityError({
      operation,
      reason: "unsupported_operation",
    });
  }
  return value;
}

export async function executeSelfBillingOperation(input: {
  appUrl?: string | null;
  applicationId?: string;
  configuredProviders?: BillingProviderConfigMap;
  operation: SelfBillingOperation;
  payload: unknown;
  principal: AthenaPrincipal;
  registry?: BillingProviderRegistry;
  selfEnrollmentEnabled?: BillingSelfEnrollmentSetting;
  sql?: BillingSqlExecutor;
  testMode?: boolean;
}): Promise<unknown> {
  rejectSelfPayloadSelectors(input.payload);
  const denied = denyBillingInvocation(input.principal, input.operation, {
    kind: "session",
  });
  if (denied) {
    throw denied;
  }
  if (!input.sql) {
    throw new AthenaBillingCapabilityError({
      operation: input.operation,
      reason: "runtime_unavailable",
    });
  }
  const payload = asRecord(input.payload);
  const allowedRedirectOrigins = billingRedirectAllowlistFromAppUrl(
    input.appUrl
  );
  switch (input.operation) {
    case "self.customer.get":
      return getSelfCustomer({
        principal: input.principal,
        sql: input.sql,
      });
    case "self.entitlements":
      return getSelfEntitlements({
        principal: input.principal,
        sql: input.sql,
      });
    case "self.invoices.list":
      return listSelfInvoices({
        limit: typeof payload.limit === "number" ? payload.limit : undefined,
        principal: input.principal,
        sql: input.sql,
      });
    case "self.invoices.get":
      return getSelfInvoice({
        invoiceId: requireString(payload, "invoiceId", "self.invoices.get"),
        principal: input.principal,
        sql: input.sql,
      });
    case "self.payments.list":
      return listSelfPayments({
        limit: typeof payload.limit === "number" ? payload.limit : undefined,
        principal: input.principal,
        sql: input.sql,
      });
    case "self.payments.get":
      return getSelfPayment({
        paymentId: requireString(payload, "paymentId", "self.payments.get"),
        principal: input.principal,
        sql: input.sql,
      });
    case "self.subscription.get":
      if (typeof payload.operationId === "string") {
        return getSelfSubscriptionChangeOperation({
          operationId: payload.operationId,
          principal: input.principal,
          sql: input.sql,
        });
      }
      return getSelfSubscription({
        principal: input.principal,
        sql: input.sql,
        subscriptionId:
          typeof payload.subscriptionId === "string"
            ? payload.subscriptionId
            : undefined,
      });
    case "self.subscription.cancel":
      return cancelSelfSubscription({
        configuredProviders: input.configuredProviders,
        principal: input.principal,
        registry: input.registry,
        sql: input.sql,
        subscriptionId: requireString(
          payload,
          "subscriptionId",
          "self.subscription.cancel"
        ),
        testMode: input.testMode,
      });
    case "self.subscription.enroll":
      return enrollSelfSubscription({
        allowedRedirectOrigins,
        applicationId: input.applicationId,
        cancelUrl:
          typeof payload.cancelUrl === "string" ? payload.cancelUrl : undefined,
        configuredProviders: input.configuredProviders,
        idempotencyKey: requireString(
          payload,
          "idempotencyKey",
          "self.subscription.enroll"
        ),
        priceId: requireString(payload, "priceId", "self.subscription.enroll"),
        principal: input.principal,
        registry: input.registry,
        selfEnrollmentEnabled: input.selfEnrollmentEnabled,
        sql: input.sql,
        successUrl:
          typeof payload.successUrl === "string"
            ? payload.successUrl
            : undefined,
        testMode: input.testMode,
      });
    case "self.subscription.change":
      return changeSelfSubscription({
        applicationId: input.applicationId,
        configuredProviders: input.configuredProviders,
        currentVersion:
          typeof payload.currentVersion === "string"
            ? payload.currentVersion
            : undefined,
        idempotencyKey: requireString(
          payload,
          "idempotencyKey",
          "self.subscription.change"
        ),
        planChangeEnabled: input.selfEnrollmentEnabled,
        priceId: requireString(payload, "priceId", "self.subscription.change"),
        principal: input.principal,
        proration:
          payload.proration === "immediate" || payload.proration === "none"
            ? payload.proration
            : undefined,
        registry: input.registry,
        sql: input.sql,
        subscriptionId:
          typeof payload.subscriptionId === "string"
            ? payload.subscriptionId
            : undefined,
        testMode: input.testMode,
      });
    case "self.checkout.create":
      return createSelfCheckout({
        allowedRedirectOrigins,
        applicationId: input.applicationId,
        cancelUrl:
          typeof payload.cancelUrl === "string" ? payload.cancelUrl : undefined,
        configuredProviders: input.configuredProviders,
        idempotencyKey: requireString(
          payload,
          "idempotencyKey",
          "self.checkout.create"
        ),
        lines: Array.isArray(payload.lines)
          ? (payload.lines as { priceId: string; quantity?: number }[])
          : undefined,
        priceId:
          typeof payload.priceId === "string" ? payload.priceId : undefined,
        principal: input.principal,
        registry: input.registry,
        selfEnrollmentEnabled: input.selfEnrollmentEnabled,
        sql: input.sql,
        successUrl:
          typeof payload.successUrl === "string"
            ? payload.successUrl
            : undefined,
        testMode: input.testMode,
      });
    case "self.checkout.resume":
      return resumeSelfCheckout({
        configuredProviders: input.configuredProviders,
        principal: input.principal,
        registry: input.registry,
        returnToken: requireString(payload, "returnToken", "self.checkout.resume"),
        sql: input.sql,
        testMode: input.testMode,
      });
    default: {
      const _exhaustive: never = input.operation;
      return _exhaustive;
    }
  }
}

export { createUnavailableBillingSelfPort } from "./unavailable.ts";

export function createSelfBillingPort(input: {
  appUrl?: string | null;
  applicationId?: string;
  configuredProviders?: BillingProviderConfigMap;
  principal: AthenaPrincipal;
  registry?: BillingProviderRegistry;
  selfEnrollmentEnabled?: BillingSelfEnrollmentSetting;
  sql?: BillingSqlExecutor;
  testMode?: boolean;
}): BillingSelfPort {
  const run = async (
    operation: SelfBillingOperation,
    payload: unknown
  ): Promise<unknown> =>
    executeSelfBillingOperation({
      appUrl: input.appUrl,
      applicationId: input.applicationId,
      configuredProviders: input.configuredProviders,
      operation,
      payload,
      principal: input.principal,
      registry: input.registry,
      selfEnrollmentEnabled: input.selfEnrollmentEnabled,
      sql: input.sql,
      testMode: input.testMode,
    });
  return {
    checkout: {
      create: (payload) =>
        run("self.checkout.create", payload) as ReturnType<
          BillingSelfPort["checkout"]["create"]
        >,
      resume: (payload) =>
        run("self.checkout.resume", payload) as ReturnType<
          BillingSelfPort["checkout"]["resume"]
        >,
    },
    customer: {
      get: (payload) =>
        run("self.customer.get", payload ?? {}) as ReturnType<
          BillingSelfPort["customer"]["get"]
        >,
    },
    entitlements: (payload) =>
      run("self.entitlements", payload ?? {}) as ReturnType<
        BillingSelfPort["entitlements"]
      >,
    invoices: {
      get: (payload) =>
        run("self.invoices.get", payload) as ReturnType<
          BillingSelfPort["invoices"]["get"]
        >,
      list: (payload) =>
        run("self.invoices.list", payload ?? {}) as ReturnType<
          BillingSelfPort["invoices"]["list"]
        >,
    },
    payments: {
      get: (payload) =>
        run("self.payments.get", payload) as ReturnType<
          BillingSelfPort["payments"]["get"]
        >,
      list: (payload) =>
        run("self.payments.list", payload ?? {}) as ReturnType<
          BillingSelfPort["payments"]["list"]
        >,
    },
    subscription: {
      cancel: (payload) =>
        run("self.subscription.cancel", payload) as ReturnType<
          BillingSelfPort["subscription"]["cancel"]
        >,
      change: (payload) =>
        run("self.subscription.change", payload) as ReturnType<
          BillingSelfPort["subscription"]["change"]
        >,
      enroll: (payload) =>
        run("self.subscription.enroll", payload) as ReturnType<
          BillingSelfPort["subscription"]["enroll"]
        >,
      get: (payload) =>
        run("self.subscription.get", payload ?? {}) as ReturnType<
          BillingSelfPort["subscription"]["get"]
        >,
      getChangeOperation: (payload) =>
        run("self.subscription.get", payload) as ReturnType<
          NonNullable<BillingSelfPort["subscription"]["getChangeOperation"]>
        >,
    },
  };
}

export { isSelfBillingOperation };
