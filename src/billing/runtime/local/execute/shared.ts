import type { AthenaPrincipal } from "../../../../runtime/data/principal.ts";
import { AthenaBillingCapabilityError } from "../../../errors.ts";
import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import type { BillingExecutionTarget } from "../../../types.ts";
import { readBillingCredentialAuthority } from "../../authority.ts";
import type { BillingOperation } from "../../capabilities.ts";
import { availableBillingCredentialEnvironments } from "../../credentials.ts";
import { resolveBillingEnvironment } from "../../environment.ts";
import type { BillingInvocationAuthority } from "../../invocation-authority.ts";
import {
  isProcessBillingInvocation,
  resolveBillingInvocationAuthority,
  SESSION_BILLING_INVOCATION,
} from "../../invocation-authority.ts";
import {
  authorizeBillingOperation,
  denyBillingInvocation,
  PROCESS_OWNED_BILLING_PRINCIPAL,
} from "../../rights.ts";

import {
  decideLocalBillingOperationCapability,
  selectedModeAllowedForCapability,
} from "../capability-decision.ts";
import { createConfiguredProviderBinding } from "../providers/binding.ts";
import { createBillingProviderExecutionContext } from "../providers/execution-context.ts";
import { mollieOperationScopeFor } from "../providers/operation-scope.ts";
import type { BillingProviderRegistry } from "../providers/registry.ts";
import { resolveBillingExecutionTarget } from "../providers/resolve-target.ts";
import type {
  BillingProviderExecutionContext,
  BillingProviderPortCapabilities,
  BillingProviderPortMap,
  BillingProviderPortName,
  BillingProviderRuntime,
  ConfiguredBillingProviderBinding,
} from "../providers/types.ts";

export interface PreparedBillingInvocation {
  readonly authority: BillingInvocationAuthority;
  readonly binding: ConfiguredBillingProviderBinding;
  readonly context: BillingProviderExecutionContext;
  readonly operation: BillingOperation;
  readonly principal: AthenaPrincipal;
  readonly runtime: BillingProviderRuntime;
  readonly target: Extract<
    ReturnType<typeof resolveBillingExecutionTarget>,
    { kind: "configured" }
  >;
}

export interface ResolvedLocalBillingProviderExecution {
  context: BillingProviderExecutionContext;
  runtime: BillingProviderRuntime;
}

export function rejectUnsupportedListOffset(
  operation: BillingOperation,
  offset?: number
): void {
  if (offset == null) {
    return;
  }
  throw new AthenaBillingCapabilityError({
    operation,
    reason: "unsupported_operation",
  });
}

export function rejectUnsupportedLocalPaymentListSource(source?: string): void {
  if (source == null || source === "provider") {
    return;
  }
  throw new AthenaBillingCapabilityError({
    operation: "payments.list",
    reason: "unsupported_operation",
  });
}

function isBillingProviderPortName(
  name: string
): name is BillingProviderPortName {
  switch (name) {
    case "checkout":
    case "customers":
    case "invoices":
    case "paymentLinks":
    case "payments":
    case "prices":
    case "products":
    case "relations":
    case "refunds":
    case "subscriptions":
    case "webhooks":
      return true;
    default:
      return false;
  }
}

function providerPortIsAvailable(
  runtime: BillingProviderRuntime,
  advertised: BillingProviderPortCapabilities,
  operation: BillingOperation
): boolean {
  const name = operation.split(".")[0] ?? "";
  if (!isBillingProviderPortName(name)) {
    return false;
  }
  const ports: BillingProviderPortMap = runtime;
  return ports[name] != null && advertised[name] === true;
}

export function requireProviderPort<T>(
  port: T | null | undefined,
  operation: BillingOperation
): NonNullable<T> {
  if (port == null) {
    throw new AthenaBillingCapabilityError({
      operation,
      reason:
        operation === "products.list" ||
          operation === "prices.list" ||
          operation === "relations.list"
          ? "missing_catalog"
          : "unsupported_operation",
    });
  }
  return port;
}

export async function prepareLocalBillingInvocation(input: {
  authority: BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  idempotencyKey?: string;
  operation: BillingOperation;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  target: BillingExecutionTarget;
  testMode?: boolean;
}): Promise<PreparedBillingInvocation> {
  const target = resolveBillingExecutionTarget({
    configuredProviders: input.configuredProviders,
    registry: input.registry,
    target: input.target,
  });
  if (target.kind === "connection") {
    throw new AthenaBillingCapabilityError({
      operation: input.operation,
      reason: "missing_connection",
    });
  }
  const binding = createConfiguredProviderBinding({
    configuredProviders: input.configuredProviders,
    provider: target.provider,
  });
  const authority = resolveBillingInvocationAuthority({
    authority: input.authority,
  });
  const principal =
    input.principal ??
    (isProcessBillingInvocation(authority)
      ? PROCESS_OWNED_BILLING_PRINCIPAL
      : undefined);
  if (!principal && authority.kind === SESSION_BILLING_INVOCATION.kind) {
    throw new AthenaBillingCapabilityError({
      operation: input.operation,
      reason: "runtime_unavailable",
    });
  }
  if (!principal) {
    throw new AthenaBillingCapabilityError({
      operation: input.operation,
      reason: "runtime_unavailable",
    });
  }
  await decideBillingCapability({
    binding,
    operation: input.operation,
    requestedProfileId: input.target.profileId,
    runtime: target.runtime,
    testMode: input.testMode,
  });
  authorizeBillingInvocation(principal, input.operation, authority);
  const context = createBillingProviderExecutionContext({
    binding,
    idempotencyKey: input.idempotencyKey,
    ingress: input.registry.ingress,
    operationScope: mollieOperationScopeFor(input.operation),
    target: {
      profileId: input.target.profileId,
    },
    testMode: input.testMode,
  });
  return {
    authority,
    binding,
    context,
    operation: input.operation,
    principal,
    runtime: target.runtime,
    target,
  };
}

export async function resolveLocalBillingProviderExecution(input: {
  authority?: BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  idempotencyKey?: string;
  operation: BillingOperation;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  target: BillingExecutionTarget;
  testMode?: boolean;
}): Promise<ResolvedLocalBillingProviderExecution> {
  const prepared = await prepareLocalBillingInvocation({
    ...input,
    authority: input.authority ?? SESSION_BILLING_INVOCATION,
  });
  return {
    context: prepared.context,
    runtime: prepared.runtime,
  };
}

async function decideBillingCapability(input: {
  binding: ConfiguredBillingProviderBinding;
  operation: BillingOperation;
  requestedProfileId?: string;
  runtime: BillingProviderRuntime;
  testMode?: boolean;
}): Promise<void> {
  const providerCapabilities = await input.runtime.getCapabilities(
    input.binding
  );
  const authority = readBillingCredentialAuthority(
    input.binding.providerConfig
  );
  const environment = resolveBillingEnvironment({
    testMode: input.testMode,
  });
  const capability = decideLocalBillingOperationCapability({
    anyCredentialConfigured:
      availableBillingCredentialEnvironments(input.binding.credentials).length >
      0,
    authority,
    operation: input.operation,
    portAvailable: providerPortIsAvailable(
      input.runtime,
      providerCapabilities.ports,
      input.operation
    ),
    provider: input.binding.provider,
    providerConfig: input.binding.providerConfig,
    providerOperationEnabled:
      providerCapabilities.operations[input.operation] === true,
    requestedProfileId: input.requestedProfileId,
    selectedModeAllowed: selectedModeAllowedForCapability({
      authority,
      selectedCredentialConfigured:
        input.binding.credentials[environment.name] != null,
      selectedEnvironment: environment.name,
    }),
  });
  if (capability.available !== true) {
    throw new AthenaBillingCapabilityError({
      operation: input.operation,
      reason: capability.reason ?? "unsupported_operation",
    });
  }
}

function authorizeBillingInvocation(
  principal: AthenaPrincipal,
  operation: BillingOperation,
  authority: BillingInvocationAuthority
): void {
  const denied =
    authorizeBillingOperation(principal, operation) ??
    denyBillingInvocation(principal, operation, authority);
  if (denied) {
    throw denied;
  }
}
