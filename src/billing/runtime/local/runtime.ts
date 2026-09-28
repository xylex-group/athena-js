import type { AthenaPrincipal } from "../../../runtime/data/principal.ts";
// Preflight lives in execute/invoke.ts: prepareBillingCommand (src/billing/safety).
import {
  AthenaBillingCapabilityError,
  isAthenaBillingCredentialError,
} from "../../errors.ts";
import { billingWebhookUrlTemplate } from "../../ingestion/urls.ts";
import {
  type BillingSelfEnrollmentSetting,
  isBillingSelfEnrollmentEnabled,
  isBillingSelfPlanChangeEnabled,
} from "../../self-enrollment.ts";
import {
  type BillingConnectionAffinityInspection,
  billingConfiguredConnectionOwner,
  configuredProvidersForBillingConnection,
  inspectBillingConnectionAffinity,
} from "../../subject/connection-affinity.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import type {
  BillingCancelPaymentInput,
  BillingCancelRefundInput,
  BillingCancelSubscriptionInput,
  BillingCreateCustomerInput,
  BillingCreatePaymentInput,
  BillingCreatePaymentLinkInput,
  BillingCreateRefundInput,
  BillingCreateSubscriptionInput,
  BillingDeleteCustomerInput,
  BillingDeletePaymentLinkInput,
  BillingExecutionTarget,
  BillingGetCustomerInput,
  BillingGetInvoiceInput,
  BillingGetPaymentInput,
  BillingGetPaymentLinkInput,
  BillingGetRefundInput,
  BillingGetSubscriptionInput,
  BillingListCustomersInput,
  BillingListInvoicesInput,
  BillingListPaymentLinksInput,
  BillingListPaymentsInput,
  BillingListRefundsInput,
  BillingListSubscriptionsInput,
  BillingPayment,
  BillingUpdateCustomerInput,
  BillingUpdatePaymentLinkInput,
  BillingUpdateSubscriptionInput,
} from "../../types.ts";
import {
  type BillingAdminRuntimeOptions,
  createBillingAdminPort,
  executeAdminBillingOperation,
} from "../admin/execute.ts";
import type { BillingAdminBootstrapRetryResult } from "../admin/types.ts";
import { isAdminBillingOperation } from "../admin/operations.ts";
import {
  type BillingCredentialAuthority,
  readBillingCredentialAuthority,
} from "../authority.ts";
import type {
  BillingCapabilities,
  BillingOperation,
  BillingOperationCapability,
  BillingOperationSafety,
  BillingPortName,
} from "../capabilities.ts";
import {
  availableBillingCredentialEnvironments,
  type BillingCredentialKind,
  resolveBillingCredential,
} from "../credentials.ts";
import {
  type AthenaBillingRuntimeDispatch,
  invokeBillingRuntimePort,
} from "../dispatch.ts";
import { resolveBillingEnvironment } from "../environment.ts";
import { projectAthenaBillingHealth } from "../health.ts";
import {
  type BillingInvocationAuthority,
  isProcessBillingInvocation,
  PROCESS_BILLING_INVOCATION,
  resolveBillingInvocationAuthority,
  SESSION_BILLING_INVOCATION,
} from "../invocation-authority.ts";
import {
  denyBillingInvocation,
  isProcessOwnedBillingPrincipal,
  overlayCallerBillingCapabilities,
  PROCESS_OWNED_BILLING_PRINCIPAL,
} from "../rights.ts";
import {
  createSelfBillingPort,
  executeSelfBillingOperation,
  isSelfBillingOperation,
} from "../self/runtime.ts";
import type {
  BillingCheckoutPort,
  BillingCustomerPort,
  BillingInvoicePort,
  BillingPage,
  BillingPaymentLinkPort,
  BillingPaymentPort,
  BillingPricePort,
  BillingProductPort,
  BillingRefundPort,
  BillingRelationPort,
  BillingSubscriptionPort,
  BillingWebhookPort,
} from "../types.ts";
import {
  decideLocalBillingOperationCapability,
  selectedModeAllowedForCapability,
} from "./capability-decision.ts";
import type { MaterializedBillingConnection } from "./connections/materialize.ts";
import {
  executeLocalBillingCustomerCreate,
  executeLocalBillingCustomerDelete,
  executeLocalBillingCustomerGet,
  executeLocalBillingCustomerList,
  executeLocalBillingCustomerUpdate,
  executeLocalBillingInvoiceGet,
  executeLocalBillingInvoiceList,
  executeLocalBillingPaymentCancel,
  executeLocalBillingPaymentCreate,
  executeLocalBillingPaymentGet,
  executeLocalBillingPaymentLinkCreate,
  executeLocalBillingPaymentLinkDelete,
  executeLocalBillingPaymentLinkGet,
  executeLocalBillingPaymentLinkList,
  executeLocalBillingPaymentLinkUpdate,
  executeLocalBillingPaymentList,
  executeLocalBillingPriceList,
  executeLocalBillingProductList,
  executeLocalBillingRefundCancel,
  executeLocalBillingRefundCreate,
  executeLocalBillingRefundGet,
  executeLocalBillingRefundList,
  executeLocalBillingRelationList,
  executeLocalBillingSubscriptionCancel,
  executeLocalBillingSubscriptionCreate,
  executeLocalBillingSubscriptionGet,
  executeLocalBillingSubscriptionList,
  executeLocalBillingSubscriptionUpdate,
  executeLocalBillingWebhookCreate,
  executeLocalBillingWebhookDelete,
  executeLocalBillingWebhookList,
  executeLocalBillingWebhookUpdate,
} from "./execute/index.ts";
import { createConfiguredProviderBinding } from "./providers/binding.ts";
import { resolveBillingExecutionTarget } from "./providers/resolve-target.ts";
import type { BillingProviderCapabilities } from "./providers/types.ts";

const BILLING_OPERATIONS: BillingOperation[] = [
  "payments.list",
  "payments.create",
  "payments.get",
  "payments.cancel",
  "customers.list",
  "customers.create",
  "customers.get",
  "customers.update",
  "customers.delete",
  "refunds.list",
  "refunds.create",
  "refunds.get",
  "refunds.cancel",
  "paymentLinks.list",
  "paymentLinks.create",
  "paymentLinks.get",
  "paymentLinks.update",
  "paymentLinks.delete",
  "subscriptions.list",
  "subscriptions.create",
  "subscriptions.get",
  "subscriptions.update",
  "subscriptions.cancel",
  "invoices.list",
  "invoices.get",
  "webhooks.list",
  "webhooks.create",
  "webhooks.get",
  "webhooks.update",
  "webhooks.delete",
  "webhooks.test",
  "products.list",
  "prices.list",
  "relations.list",
  "checkout.create",
  "self.invoices.list",
  "self.invoices.get",
  "self.payments.list",
  "self.payments.get",
  "self.subscription.get",
  "self.subscription.cancel",
  "self.subscription.enroll",
  "self.subscription.change",
  "self.checkout.create",
  "self.checkout.resume",
  "self.customer.get",
  "self.entitlements",
  "admin.connections.materialize",
  "admin.bootstrap.retry",
  "admin.reconciliation.run",
  "admin.reconciliation.retry",
  "admin.webhooks.reconcile",
  "admin.webhooks.verify",
  "admin.webhooks.status",
  "admin.ingestion.health",
  "admin.conflicts.resolve",
  "admin.conflicts.list",
];

function sanitizeBillingInitializationMessage(error: unknown): string {
  const raw =
    error instanceof Error && error.message.trim().length > 0
      ? error.message.trim()
      : "billing initialization failed";
  if (/access_|live_|test_|sk_|secret|password|token/i.test(raw)) {
    return "billing initialization failed";
  }
  return raw.length > 240 ? `${raw.slice(0, 237)}...` : raw;
}

function bootstrapFailedBillingCapabilities(input: {
  bootstrapRetryAvailable: boolean;
  error: unknown;
  sqlPresent: boolean;
  target: BillingExecutionTarget;
}): BillingCapabilities {
  const operations = Object.fromEntries(
    BILLING_OPERATIONS.map((operation) => [
      operation,
      { available: false, reason: "bootstrap_failed" as const },
    ]),
  ) as BillingCapabilities["operations"];
  if (input.bootstrapRetryAvailable) {
    operations["admin.bootstrap.retry"] = {
      available: true,
      authorized: true,
      effectiveAvailable: true,
      providerSupported: true,
      runtimeAvailable: true,
      safety: "stable",
    };
  }
  const provider =
    typeof input.target.provider === "string" ? input.target.provider : "";
  return {
    connected: false,
    diagnostics: {
      initializationFailed: true,
      initializationMessage: sanitizeBillingInitializationMessage(input.error),
      runtimeSource: "local",
    },
    initialized: false,
    operations,
    ports: {
      checkout: false,
      customers: false,
      invoices: false,
      paymentLinks: false,
      payments: false,
      prices: false,
      products: false,
      relations: false,
      refunds: false,
      self: input.sqlPresent,
      subscriptions: false,
      webhooks: false,
    },
    provider,
    runtime: "local",
    target: {
      kind: input.target.connectionId ? "connection" : "configured",
      provider,
      ...(typeof input.target.connectionId === "string"
        ? { connectionId: input.target.connectionId }
        : {}),
    },
  };
}

function omitUndefinedKeys<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => omitUndefinedKeys(entry)) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === undefined) {
      continue;
    }
    out[key] = omitUndefinedKeys(entry);
  }
  return out as T;
}

function unavailable(
  operation: BillingOperation,
  reason: BillingOperationCapability["reason"] = "unsupported_operation",
): never {
  throw new AthenaBillingCapabilityError({
    operation,
    reason: reason ?? "unsupported_operation",
  });
}

function createUnsupportedPort<T extends object>(
  methods: Record<keyof T, BillingOperation>,
  principal: AthenaPrincipal,
  authority: BillingInvocationAuthority,
): T {
  const port = {} as T;
  for (const [method, operation] of Object.entries(methods) as [
    keyof T,
    BillingOperation,
  ][]) {
    port[method] = ((..._args: unknown[]) => {
      const denied = denyBillingInvocation(principal, operation, authority);
      if (denied) {
        throw denied;
      }
      return unavailable(operation);
    }) as T[keyof T];
  }
  return port;
}

function athenaInfrastructureOperationCapability(
  sqlPresent: boolean,
): BillingOperationCapability {
  return sqlPresent
    ? { available: true }
    : { available: false, reason: "runtime_unavailable" };
}

function billingSqlSupportsTransactions(
  sql: BillingSqlExecutor | undefined,
): boolean {
  return sql != null && typeof sql.transaction === "function";
}

function operationsFromProviderCapabilities(input: {
  anyCredentialConfigured: boolean;
  authority?: BillingCredentialAuthority;
  configuredProfileId?: string | null;
  credentialKind?: string;
  missingReason?: BillingOperationCapability["reason"];
  ports: BillingCapabilities["ports"];
  provider: string;
  providerOperations?: BillingProviderCapabilities["operations"];
  requestedProfileId?: string | null;
  selectedCredentialConfigured?: boolean;
  selectedEnvironment: "test" | "live";
  selfEnrollmentEnabled?: BillingSelfEnrollmentSetting;
  planChangeReady?: boolean;
  sqlPresent?: boolean;
  sqlTransactional?: boolean;
  connectionAffinityReason?: BillingOperationCapability["reason"];
}): BillingCapabilities["operations"] {
  const operations: BillingCapabilities["operations"] = {};
  const selectedModeAllowed = selectedModeAllowedForCapability({
    authority: input.authority,
    selectedCredentialConfigured:
      input.selectedCredentialConfigured ?? input.anyCredentialConfigured,
    selectedEnvironment: input.selectedEnvironment,
  });
  const providerConfig = {
    credentialKind: input.credentialKind,
    profileId: input.configuredProfileId,
  };
  const decideBase = {
    anyCredentialConfigured: input.anyCredentialConfigured,
    authority: input.authority,
    provider: input.provider,
    providerConfig,
    requestedProfileId: input.requestedProfileId,
    selectedModeAllowed,
  };
  for (const operation of BILLING_OPERATIONS) {
    if (
      input.missingReason != null &&
      !isSelfBillingOperation(operation) &&
      !isAdminBillingOperation(operation)
    ) {
      operations[operation] = {
        available: false,
        reason: input.missingReason,
      };
      continue;
    }
    if (isAdminBillingOperation(operation)) {
      operations[operation] = athenaInfrastructureOperationCapability(
        input.sqlPresent === true,
      );
      continue;
    }
    if (isSelfBillingOperation(operation)) {
      const sqlPresent = input.sqlPresent === true;
      if (
        operation === "self.invoices.list" ||
        operation === "self.invoices.get" ||
        operation === "self.payments.list" ||
        operation === "self.payments.get" ||
        operation === "self.subscription.get" ||
        operation === "self.customer.get" ||
        operation === "self.entitlements"
      ) {
        operations[operation] =
          athenaInfrastructureOperationCapability(sqlPresent);
      } else if (operation === "self.subscription.cancel") {
        operations[operation] = decideLocalBillingOperationCapability({
          ...decideBase,
          operation,
          portAvailable: sqlPresent && input.ports.subscriptions === true,
          providerOperationEnabled:
            input.providerOperations?.["subscriptions.cancel"] === true,
          unimplementedReason: sqlPresent
            ? "unsupported_operation"
            : "runtime_unavailable",
        });
      } else if (
        operation === "self.subscription.enroll" ||
        operation === "self.subscription.change"
      ) {
        const enrollEnabled = isBillingSelfEnrollmentEnabled(
          input.selfEnrollmentEnabled,
        );
        const changeEnabled = isBillingSelfPlanChangeEnabled(
          input.selfEnrollmentEnabled,
        );
        const capability = decideLocalBillingOperationCapability({
          ...decideBase,
          operation,
          portAvailable:
            (operation === "self.subscription.change"
              ? changeEnabled
              : enrollEnabled) &&
            sqlPresent &&
            input.ports.prices === true &&
            input.ports.payments === true &&
            input.ports.subscriptions === true &&
            input.ports.customers === true,
          providerOperationEnabled:
            operation === "self.subscription.change"
              ? changeEnabled &&
              input.providerOperations?.["subscriptions.update"] === true
              : enrollEnabled &&
              input.providerOperations?.["payments.create"] === true &&
              input.providerOperations?.["subscriptions.create"] === true &&
              input.providerOperations?.["customers.create"] === true,
          unimplementedReason: (
            operation === "self.subscription.change"
              ? changeEnabled
              : enrollEnabled
          )
            ? sqlPresent
              ? "unsupported_operation"
              : "runtime_unavailable"
            : "self_enrollment_disabled",
        });
        if (operation === "self.subscription.change") {
          const safety: BillingOperationSafety =
            capability.available &&
              input.sqlPresent === true &&
              input.planChangeReady === true
              ? "stable"
              : "disabled";
          operations[operation] = { ...capability, safety };
        } else {
          operations[operation] = capability;
        }
      } else if (operation === "self.checkout.resume") {
        operations[operation] = decideLocalBillingOperationCapability({
          ...decideBase,
          operation,
          portAvailable: sqlPresent && input.ports.payments === true,
          providerOperationEnabled:
            input.providerOperations?.["payments.get"] === true,
          unimplementedReason: sqlPresent
            ? "unsupported_operation"
            : "runtime_unavailable",
        });
      } else if (operation === "self.checkout.create") {
        const transactional = input.sqlTransactional === true;
        operations[operation] = decideLocalBillingOperationCapability({
          ...decideBase,
          operation,
          portAvailable:
            sqlPresent &&
            transactional &&
            input.ports.prices === true &&
            input.ports.payments === true,
          providerOperationEnabled:
            input.providerOperations?.["payments.create"] === true,
          unimplementedReason:
            sqlPresent && transactional
              ? input.ports.prices === true
                ? "unsupported_operation"
                : "missing_catalog"
              : "runtime_unavailable",
        });
      } else {
        const exhaustive: never = operation;
        void exhaustive;
      }
      continue;
    }
    const portName = operation.split(".")[0] as BillingPortName;
    operations[operation] = decideLocalBillingOperationCapability({
      ...decideBase,
      operation,
      portAvailable: input.ports[portName] === true,
      providerOperationEnabled: input.providerOperations?.[operation] === true,
    });
  }
  overlaySelfConnectionAffinity(operations, input.connectionAffinityReason);
  return operations;
}

function overlaySelfConnectionAffinity(
  operations: BillingCapabilities["operations"],
  reason: BillingOperationCapability["reason"] | undefined,
): void {
  if (reason == null) {
    return;
  }
  for (const operation of [
    "self.checkout.create",
    "self.subscription.enroll",
    "self.subscription.change",
  ] as const) {
    const current = operations[operation];
    if (current?.available !== true) {
      continue;
    }
    operations[operation] = { available: false, reason };
  }
}

function connectionAffinityCapabilityReason(
  inspection: BillingConnectionAffinityInspection,
): BillingOperationCapability["reason"] | undefined {
  if (inspection.state === "resolved") {
    return;
  }
  return inspection.state === "ambiguous"
    ? "provider_connection_ambiguous"
    : "provider_connection_missing";
}

export interface CreateLocalBillingRuntimeInput
  extends BillingAdminRuntimeOptions {
  connectionState?: {
    bootstrapRetry?: () => Promise<BillingAdminBootstrapRetryResult>;
    connections: readonly MaterializedBillingConnection[];
    initializationFailed?: boolean;
    initializationMessage?: string;
    initialized: boolean;
    recoveryCoordinatorEnabled?: boolean;
  };
  invocation: BillingInvocationAuthority;
  principal?: AthenaPrincipal;
  ready?: Promise<void>;
  waitForOperational?: () => Promise<void>;
}

export function createLocalBillingRuntime(
  input: CreateLocalBillingRuntimeInput,
): AthenaBillingRuntimeDispatch {
  const invocation = resolveBillingInvocationAuthority({
    authority: input.invocation,
  });
  const principal =
    input.principal ??
    (isProcessBillingInvocation(invocation)
      ? PROCESS_OWNED_BILLING_PRINCIPAL
      : undefined);
  if (principal == null) {
    throw new AthenaBillingCapabilityError({
      operation: "payments.list",
      reason: "runtime_unavailable",
    });
  }
  const ready = input.ready ?? Promise.resolve();
  const waitForOperational = input.waitForOperational ?? (() => ready);
  const gate = <T>(run: () => Promise<T>): Promise<T> =>
    waitForOperational().then(run);
  const gatePort = <T extends object>(port: T): T => {
    const wrapped = {} as T;
    for (const [key, value] of Object.entries(port)) {
      if (typeof value === "function") {
        (wrapped as Record<string, unknown>)[key] = (...args: unknown[]) =>
          gate(() =>
            (value as (...inner: unknown[]) => Promise<unknown>)(...args),
          );
        continue;
      }
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        (wrapped as Record<string, unknown>)[key] = gatePort(value as object);
        continue;
      }
      (wrapped as Record<string, unknown>)[key] = value;
    }
    return wrapped;
  };

  const payments: BillingPaymentPort = {
    cancel: (payload: BillingCancelPaymentInput): Promise<BillingPayment> =>
      executeLocalBillingPaymentCancel({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
    create: (payload: BillingCreatePaymentInput): Promise<BillingPayment> =>
      executeLocalBillingPaymentCreate({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
    get: (payload: BillingGetPaymentInput): Promise<BillingPayment> =>
      executeLocalBillingPaymentGet({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
    list: (
      payload: BillingListPaymentsInput,
    ): Promise<BillingPage<BillingPayment>> =>
      executeLocalBillingPaymentList({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
  };

  const customers: BillingCustomerPort = {
    create: (payload: BillingCreateCustomerInput) =>
      executeLocalBillingCustomerCreate({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
    delete: (payload: BillingDeleteCustomerInput) =>
      executeLocalBillingCustomerDelete({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
    get: (payload: BillingGetCustomerInput) =>
      executeLocalBillingCustomerGet({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
    list: (payload: BillingListCustomersInput) =>
      executeLocalBillingCustomerList({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
    update: (payload: BillingUpdateCustomerInput) =>
      executeLocalBillingCustomerUpdate({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
  };
  const refunds: BillingRefundPort = {
    cancel: (payload: BillingCancelRefundInput) =>
      executeLocalBillingRefundCancel({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
    create: (payload: BillingCreateRefundInput) =>
      executeLocalBillingRefundCreate({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
    get: (payload: BillingGetRefundInput) =>
      executeLocalBillingRefundGet({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
    list: (payload: BillingListRefundsInput) =>
      executeLocalBillingRefundList({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
  };
  const paymentLinks: BillingPaymentLinkPort = {
    create: (payload: BillingCreatePaymentLinkInput) =>
      executeLocalBillingPaymentLinkCreate({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
    delete: (payload: BillingDeletePaymentLinkInput) =>
      executeLocalBillingPaymentLinkDelete({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
    get: (payload: BillingGetPaymentLinkInput) =>
      executeLocalBillingPaymentLinkGet({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
    list: (payload: BillingListPaymentLinksInput) =>
      executeLocalBillingPaymentLinkList({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
    update: (payload: BillingUpdatePaymentLinkInput) =>
      executeLocalBillingPaymentLinkUpdate({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
  };
  const subscriptions: BillingSubscriptionPort = {
    cancel: (payload: BillingCancelSubscriptionInput) =>
      executeLocalBillingSubscriptionCancel({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
    create: (payload: BillingCreateSubscriptionInput) =>
      executeLocalBillingSubscriptionCreate({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
    get: (payload: BillingGetSubscriptionInput) =>
      executeLocalBillingSubscriptionGet({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
    list: (payload: BillingListSubscriptionsInput) =>
      executeLocalBillingSubscriptionList({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
    update: (payload: BillingUpdateSubscriptionInput) =>
      executeLocalBillingSubscriptionUpdate({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
  };
  const invoices: BillingInvoicePort = {
    get: (payload: BillingGetInvoiceInput) =>
      executeLocalBillingInvoiceGet({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
    list: (payload: BillingListInvoicesInput) =>
      executeLocalBillingInvoiceList({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
  };
  const unsupportedWebhooks = createUnsupportedPort<BillingWebhookPort>(
    {
      create: "webhooks.create",
      delete: "webhooks.delete",
      get: "webhooks.get",
      list: "webhooks.list",
      test: "webhooks.test",
      update: "webhooks.update",
    },
    principal,
    invocation,
  );
  const webhooks: BillingWebhookPort = {
    ...unsupportedWebhooks,
    create: (payload) =>
      executeLocalBillingWebhookCreate({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
    delete: (payload) =>
      executeLocalBillingWebhookDelete({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
    list: (payload) =>
      executeLocalBillingWebhookList({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
    update: (payload) =>
      executeLocalBillingWebhookUpdate({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
  };
  const products: BillingProductPort = {
    list: (payload) =>
      executeLocalBillingProductList({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
  };
  const prices: BillingPricePort = {
    list: (payload) =>
      executeLocalBillingPriceList({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
  };
  const relations: BillingRelationPort = {
    list: (payload) =>
      executeLocalBillingRelationList({
        authority: invocation,
        configuredProviders: input.configuredProviders,
        payload,
        principal,
        registry: input.registry,
        testMode: input.testMode,
      }),
  };
  const checkout = createUnsupportedPort<BillingCheckoutPort>(
    { create: "checkout.create" },
    principal,
    invocation,
  );
  const adminOptions = {
    applicationId: input.applicationId,
    appUrl: input.appUrl,
    configuredProviders: input.configuredProviders,
    customerImport: input.customerImport,
    ingestion: input.ingestion,
    observability: input.observability,
    registry: input.registry,
    sql: input.sql,
    testMode: input.testMode,
    bootstrapRetry: async () => {
      const retry = input.connectionState?.bootstrapRetry;
      if (retry == null) {
        throw new AthenaBillingCapabilityError({
          operation: "admin.bootstrap.retry",
          reason: "runtime_unavailable",
        });
      }
      return retry();
    },
  };
  const admin = createBillingAdminPort({
    authority: invocation,
    options: adminOptions,
    principal,
  });
  const gatedAdmin = gatePort(admin);
  const controlPlaneAdmin = {
    ...gatedAdmin,
    bootstrap: admin.bootstrap,
  };

  return {
    admin: controlPlaneAdmin,
    checkout: gatePort(checkout),
    // Shared src/billing/safety preflight is applied in execute/* create paths.
    customers: gatePort(customers),
    async execute(operation, payload, requestPrincipal) {
      if (operation === "admin.bootstrap.retry") {
        const denied = denyBillingInvocation(
          requestPrincipal,
          operation,
          PROCESS_BILLING_INVOCATION
        );
        if (denied) {
          throw denied;
        }
        return omitUndefinedKeys(await admin.bootstrap.retry());
      }
      if (operation === "getCapabilities") {
        const capabilities = await this.getCapabilities(
          (payload ?? {}) as BillingExecutionTarget,
          requestPrincipal,
        );
        return omitUndefinedKeys(
          overlayCallerBillingCapabilities(capabilities, requestPrincipal),
        );
      }
      const sessionDenied = denyBillingInvocation(
        requestPrincipal,
        operation,
        SESSION_BILLING_INVOCATION,
      );
      if (sessionDenied) {
        throw sessionDenied;
      }
      await waitForOperational();
      if (isSelfBillingOperation(operation)) {
        return omitUndefinedKeys(
          await executeSelfBillingOperation({
            appUrl: input.appUrl,
            applicationId: input.applicationId,
            configuredProviders: input.configuredProviders,
            operation,
            payload,
            principal: requestPrincipal,
            registry: input.registry,
            selfEnrollmentEnabled: input.selfEnrollmentEnabled,
            sql: input.sql,
            testMode: input.testMode,
          }),
        );
      }
      if (isAdminBillingOperation(operation)) {
        return omitUndefinedKeys(
          await executeAdminBillingOperation({
            authority: PROCESS_BILLING_INVOCATION,
            operation,
            options: adminOptions,
            payload,
            principal: requestPrincipal,
          }),
        );
      }
      const scoped = createLocalBillingRuntime({
        applicationId: input.applicationId,
        appUrl: input.appUrl,
        configuredProviders: input.configuredProviders,
        connectionState: input.connectionState,
        customerImport: input.customerImport,
        ingestion: input.ingestion,
        invocation: SESSION_BILLING_INVOCATION,
        observability: input.observability,
        principal: requestPrincipal,
        ready,
        registry: input.registry,
        selfEnrollmentEnabled: input.selfEnrollmentEnabled,
        sql: input.sql,
        testMode: input.testMode,
      });
      return omitUndefinedKeys(
        await invokeBillingRuntimePort(scoped, operation, payload),
      );
    },
    async getCapabilities(
      target: BillingExecutionTarget,
      requestPrincipal?: AthenaPrincipal,
    ): Promise<BillingCapabilities> {
      if (input.connectionState?.initializationFailed) {
        return bootstrapFailedBillingCapabilities({
          error:
            input.connectionState.initializationMessage ??
            "billing initialization failed",
          bootstrapRetryAvailable:
            input.connectionState.bootstrapRetry != null &&
            input.sql != null,
          sqlPresent: input.sql != null,
          target,
        });
      }
      try {
        await waitForOperational();
      } catch (error) {
        return bootstrapFailedBillingCapabilities({
          error,
          bootstrapRetryAvailable:
            input.connectionState?.bootstrapRetry != null &&
            input.sql != null,
          sqlPresent: input.sql != null,
          target,
        });
      }
      const resolved = resolveBillingExecutionTarget({
        configuredProviders: input.configuredProviders,
        registry: input.registry,
        target,
      });
      if (resolved.kind === "connection") {
        const emptyPorts = {
          checkout: false,
          customers: false,
          invoices: false,
          paymentLinks: false,
          payments: false,
          prices: false,
          products: false,
          relations: false,
          refunds: false,
          self: input.sql != null,
          subscriptions: false,
          webhooks: false,
        };
        return {
          connected: false,
          connectionId: resolved.connectionId,
          initialized: input.connectionState?.initialized !== false,
          operations: operationsFromProviderCapabilities({
            anyCredentialConfigured: false,
            missingReason: "missing_connection",
            ports: emptyPorts,
            provider: resolved.provider ?? "",
            selectedEnvironment: "test",
            selfEnrollmentEnabled: input.selfEnrollmentEnabled,
            planChangeReady: false,
            sqlPresent: input.sql != null,
            sqlTransactional: billingSqlSupportsTransactions(input.sql),
          }),
          ports: emptyPorts,
          provider: resolved.provider ?? "",
          runtime: "local",
          target: {
            connectionId: resolved.connectionId,
            kind: "connection",
            provider: resolved.provider ?? "",
          },
        };
      }
      const environment = resolveBillingEnvironment({
        testMode: input.testMode,
      });
      const inspectPrincipal = requestPrincipal ?? principal;
      const sessionSubject = isProcessOwnedBillingPrincipal(inspectPrincipal)
        ? undefined
        : (() => {
          const subjectId = inspectPrincipal.userId?.trim();
          return subjectId
            ? { subjectId, subjectKind: "user" as const }
            : undefined;
        })();
      let connectionInspection: Awaited<
        ReturnType<typeof inspectBillingConnectionAffinity>
      > | undefined;
      if (input.sql != null) {
        try {
          connectionInspection = await inspectBillingConnectionAffinity({
            configuredProviders: input.configuredProviders,
            environment: environment.name,
            provider: resolved.provider === "stripe" ? "stripe" : "mollie",
            sql: input.sql,
            testMode: input.testMode,
            ...(billingConfiguredConnectionOwner(input.applicationId) ?? {}),
            ...(sessionSubject ?? {}),
          });
        } catch (error) {
          return bootstrapFailedBillingCapabilities({
            error,
            bootstrapRetryAvailable:
              input.connectionState?.bootstrapRetry != null &&
              input.sql != null,
            sqlPresent: input.sql != null,
            target,
          });
        }
      }
      const configuredForCapabilities =
        connectionInspection?.state === "resolved"
          ? configuredProvidersForBillingConnection({
            affinity: connectionInspection.connection,
            configuredProviders: input.configuredProviders,
            operation: "self.checkout.create",
          })
          : input.configuredProviders;
      const binding = createConfiguredProviderBinding({
        configuredProviders: configuredForCapabilities,
        provider: resolved.provider,
      });
      const providerCapabilities =
        await resolved.runtime.getCapabilities(binding);
      const providerPorts = providerCapabilities.ports;
      const ports = {
        checkout: resolved.runtime.checkout != null && providerPorts.checkout,
        customers:
          resolved.runtime.customers != null && providerPorts.customers,
        invoices: resolved.runtime.invoices != null && providerPorts.invoices,
        paymentLinks:
          resolved.runtime.paymentLinks != null && providerPorts.paymentLinks,
        payments: resolved.runtime.payments != null && providerPorts.payments,
        prices: resolved.runtime.prices != null && providerPorts.prices,
        products: resolved.runtime.products != null && providerPorts.products,
        relations:
          resolved.runtime.relations != null && providerPorts.relations,
        refunds: resolved.runtime.refunds != null && providerPorts.refunds,
        self: input.sql != null,
        subscriptions:
          resolved.runtime.subscriptions !== null &&
          providerPorts.subscriptions,
        webhooks: resolved.runtime.webhooks != null && providerPorts.webhooks,
      };
      const availableEnvironments = availableBillingCredentialEnvironments(
        binding.credentials,
      );
      const authority = readBillingCredentialAuthority(binding.providerConfig);
      let credentialKind: BillingCredentialKind | undefined =
        typeof binding.providerConfig.credentialKind === "string"
          ? (binding.providerConfig.credentialKind as BillingCredentialKind)
          : undefined;
      try {
        const selection = resolveBillingCredential({
          binding,
          provider: resolved.provider,
          testMode: environment.testMode,
        });
        credentialKind = selection.credentialKind;
      } catch (error) {
        if (!isAthenaBillingCredentialError(error)) {
          throw error;
        }
      }
      const configuredProfileId = binding.providerConfig.profileId;
      const operations = operationsFromProviderCapabilities({
        anyCredentialConfigured: availableEnvironments.length > 0,
        authority,
        configuredProfileId:
          typeof configuredProfileId === "string" ||
            configuredProfileId === null
            ? configuredProfileId
            : undefined,
        credentialKind,
        ...(connectionInspection == null
          ? {}
          : {
            connectionAffinityReason:
              connectionAffinityCapabilityReason(connectionInspection),
          }),
        ports,
        provider: resolved.provider,
        providerOperations: providerCapabilities.operations,
        requestedProfileId: target.profileId,
        selectedCredentialConfigured:
          binding.credentials[environment.name] != null,
        selectedEnvironment: environment.name,
        selfEnrollmentEnabled: input.selfEnrollmentEnabled,
        planChangeReady:
          input.connectionState?.recoveryCoordinatorEnabled === true,
        sqlPresent: input.sql != null,
        sqlTransactional: billingSqlSupportsTransactions(input.sql),
      });
      const inspectedConnection =
        connectionInspection?.state === "resolved"
          ? connectionInspection.connection
          : undefined;
      const materialized = input.connectionState?.connections.find(
        (connection) => connection.provider === resolved.provider,
      );
      const publicConnectionId = inspectedConnection?.connectionId;
      const webhookConfig =
        input.ingestion?.webhooks != null &&
          typeof input.ingestion.webhooks === "object"
          ? input.ingestion.webhooks
          : undefined;
      const nextGenWebhooks = webhookConfig?.providers?.mollie?.nextGen;
      const webhooksEnabled =
        input.ingestion?.webhooks === true ||
        (webhookConfig != null && webhookConfig.enabled !== false);
      const planChangeCapability = operations["self.subscription.change"];
      const ingressAdmissionControl: "disabled" | "enabled" = webhooksEnabled
        ? "enabled"
        : "disabled";
      const verifiedBillingContact: "available" | "unknown" = input.sql
        ? "available"
        : "unknown";
      const webhookSecretLifecycle: "healthy" | "unknown" =
        nextGenWebhooks?.enabled === false || !webhooksEnabled
          ? "unknown"
          : typeof webhookConfig?.secretMasterKey === "string"
            ? "healthy"
            : "unknown";
      const webhookIngressUrlTemplates = (
        input.connectionState?.connections ?? []
      )
        .filter(
          (
            connection,
          ): connection is MaterializedBillingConnection & {
            classicWebhookUrl: string;
            eventsWebhookUrl: string;
          } =>
            connection.classicWebhookUrl != null &&
            connection.eventsWebhookUrl != null,
        )
        .map((connection) => ({
          classic: billingWebhookUrlTemplate(connection.classicWebhookUrl),
          connectionId: connection.id,
          events: billingWebhookUrlTemplate(connection.eventsWebhookUrl),
        }));
      const developmentDiagnostics =
        process.env.NODE_ENV === "production"
          ? undefined
          : {
            billingSchemaReady:
              input.sql != null &&
              input.connectionState?.initialized !== false,
            connectionSource: "application_config",
            connectionAffinitySource:
              inspectedConnection?.source ??
              (materialized?.id ? "materialized" : "application_config"),
            eligibleConnectionCount:
              connectionInspection?.state === "resolved"
                ? 1
                : connectionInspection?.state === "ambiguous"
                  ? 2
                  : input.sql == null
                    ? (input.connectionState?.connections.length ?? 0)
                    : 0,
            ingressAdmissionControl,
            planChangeConfigured: isBillingSelfPlanChangeEnabled(
              input.selfEnrollmentEnabled,
            ),
            planChangeSafety: planChangeCapability?.safety ?? "disabled",
            providerRegistrationSource: "createClient",
            recoveryCoordinatorEnabled:
              input.connectionState?.recoveryCoordinatorEnabled === true,
            runtimeSource: "local",
            selectedConnectionId: publicConnectionId ?? materialized?.id ?? null,
            verifiedBillingContact,
            ...(webhookIngressUrlTemplates.length > 0
              ? { webhookIngressUrlTemplates }
              : {}),
            webhookSecretLifecycle,
          };
      return omitUndefinedKeys({
        authority:
          authority == null
            ? undefined
            : {
              modes: authority.modes,
              permissions: { ...authority.permissions },
              scope: authority.scope,
              source: authority.source,
            },
        connected: inspectedConnection != null,
        ...(publicConnectionId == null
          ? {}
          : { connectionId: publicConnectionId }),
        credentials: {
          availableEnvironments,
          configured: true,
          credentialKind,
          selectedEnvironment: environment.name,
        },
        ...(developmentDiagnostics === null
          ? {}
          : { diagnostics: developmentDiagnostics }),
        environment: environment.name,
        initialized: input.connectionState?.initialized !== false,
        operations,
        ports,
        provider: resolved.provider,
        runtime: "local",
        target: {
          kind: "configured",
          provider: resolved.provider,
          ...(publicConnectionId == null
            ? {}
            : { connectionId: publicConnectionId }),
        },
        testMode: environment.testMode,
      });
    },
    async health() {
      const ingestion = await admin.ingestion.health();
      return projectAthenaBillingHealth(ingestion);
    },
    invoices: gatePort(invoices),
    mode: "local",
    paymentLinks: gatePort(paymentLinks),
    payments: gatePort(payments),
    prices: gatePort(prices),
    products: gatePort(products),
    relations: gatePort(relations),
    refunds: gatePort(refunds),
    self: gatePort(
      createSelfBillingPort({
        appUrl: input.appUrl,
        applicationId: input.applicationId,
        configuredProviders: input.configuredProviders,
        principal,
        registry: input.registry,
        selfEnrollmentEnabled: input.selfEnrollmentEnabled,
        sql: input.sql,
        testMode: input.testMode,
      }),
    ),
    subscriptions: gatePort(subscriptions),
    webhooks: gatePort(webhooks),
  };
}
