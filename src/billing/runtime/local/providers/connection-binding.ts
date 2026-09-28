import {
  ATHENA_BILLING_PROVIDER_NOT_CONFIGURED,
  AthenaBillingProviderError,
} from "../../../errors.ts";
import type {
  BillingProviderConfigMap,
  MollieBillingProviderConfig,
} from "../../../providers/types.ts";
import type { ResolvedBillingProviderConnection } from "../../../reconciliation/types.ts";
import { createConfiguredProviderBinding } from "./binding.ts";
import {
  configuredProviderSlot,
  normalizeBillingProviderConfiguration,
  rawMollieConfig,
  rawStripeConfig,
} from "./configuration/index.ts";
import { createBillingProviderExecutionContext } from "./execution-context.ts";
import { normalizeBillingProviderName } from "./registry.ts";
import type {
  BillingProviderExecutionContext,
  PersistedBillingProviderBinding,
} from "./types.ts";

export function defaultBillingCredentialReference(
  provider: string,
  environment?: "test" | "live"
): string {
  const name = normalizeBillingProviderName(provider);
  if (environment === "live") {
    return `providers.${name}-live`;
  }
  return `providers.${name}`;
}

/** Declared credential_reference values for a provider + environment. */
export function configuredBillingCredentialReferences(input: {
  configuredProviders?: BillingProviderConfigMap;
  environment: "test" | "live";
  provider: string;
}): string[] {
  const configured = input.configuredProviders;
  if (configured == null) {
    return [];
  }
  const provider = normalizeBillingProviderName(input.provider);
  const normalized = normalizeBillingProviderConfiguration({
    configuredProviders: configured,
    environment: input.environment,
  });
  const providerConfig = normalized.providers.get(provider);
  if (providerConfig == null) {
    return [];
  }
  return [
    ...(providerConfig.defaultSlot == null
      ? []
      : [providerConfig.defaultSlot.credentialReference]),
    ...[...providerConfig.slots.values()].map(
      (slot) => slot.credentialReference,
    ),
  ];
}

function billingProviderFromCredentialPart(
  providerPart: string,
  trimmed: string
): "mollie" | "stripe" {
  const base = providerPart.replace(/-(test|live)$/, "");
  if (base !== "mollie" && base !== "stripe") {
    throw new AthenaBillingProviderError({
      code: ATHENA_BILLING_PROVIDER_NOT_CONFIGURED,
      message: `Billing credential_reference "${trimmed}" is not a mollie or stripe slot.`,
    });
  }
  return base;
}

export function parseBillingCredentialReference(raw: string): {
  accountId?: string;
  provider: "mollie" | "stripe";
} {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new AthenaBillingProviderError({
      code: ATHENA_BILLING_PROVIDER_NOT_CONFIGURED,
      message: "Billing connection credential_reference is empty.",
    });
  }
  const body = trimmed.startsWith("providers.")
    ? trimmed.slice("providers.".length)
    : trimmed;
  const colon = body.indexOf(":");
  const providerPart = (
    colon === -1 ? body : body.slice(0, colon)
  ).toLowerCase();
  const accountId = colon === -1 ? undefined : body.slice(colon + 1).trim();
  const provider = billingProviderFromCredentialPart(providerPart, trimmed);
  if (colon !== -1 && (accountId == null || accountId.length === 0)) {
    throw new AthenaBillingProviderError({
      code: ATHENA_BILLING_PROVIDER_NOT_CONFIGURED,
      message: `Billing credential_reference "${trimmed}" is missing an account slot.`,
    });
  }
  return accountId === null ? { provider } : { accountId, provider };
}

export function mollieConfigForCredentialReference(
  configured: BillingProviderConfigMap | undefined,
  reference: string
): MollieBillingProviderConfig | undefined {
  const parsed = parseBillingCredentialReference(reference);
  if (parsed.provider !== "mollie") {
    return;
  }
  const normalized = normalizeBillingProviderConfiguration({
    configuredProviders: configured,
    environment: "test",
  });
  const slot = configuredProviderSlot(
    normalized,
    "mollie",
    parsed.accountId ?? null,
  );
  return slot == null ? undefined : rawMollieConfig(slot);
}

export function firstConfiguredMollieProvider(
  configured?: BillingProviderConfigMap
): MollieBillingProviderConfig | undefined {
  const normalized = normalizeBillingProviderConfiguration({
    configuredProviders: configured,
    environment: "test",
  });
  const provider = normalized.providers.get("mollie");
  const slot = provider?.defaultSlot ?? provider?.slots.values().next().value;
  return slot == null ? undefined : rawMollieConfig(slot);
}

/**
 * Process `billing.testMode` defaults to test (`undefined` / `true`).
 * Leftover DB rows in the other environment must not be scheduled.
 */
export function billingConnectionMatchesProcessTestMode(
  connectionTestMode: boolean,
  processTestMode: boolean | undefined
): boolean {
  return connectionTestMode === (processTestMode !== false);
}

/** True when process config has a credential for this connection's environment. */
export function billingConnectionHasConfiguredCredential(input: {
  configuredProviders?: BillingProviderConfigMap;
  connection: Pick<
    ResolvedBillingProviderConnection,
    "credentialReference" | "provider" | "testMode"
  >;
}): boolean {
  try {
    const binding = createPersistedProviderBinding({
      configuredProviders: input.configuredProviders,
      connectionId: input.connection.credentialReference,
      credentialReference: input.connection.credentialReference,
      provider: input.connection.provider,
    });
    return input.connection.testMode
      ? binding.credentials.test != null
      : binding.credentials.live != null;
  } catch {
    return false;
  }
}

/** Active rows that match this process environment and have a usable credential. */
export function eligibleBillingConnectionsForProcess<
  T extends Pick<
    ResolvedBillingProviderConnection,
    "credentialReference" | "provider" | "testMode"
  >,
>(input: {
  configuredProviders?: BillingProviderConfigMap;
  connections: readonly T[];
  processTestMode?: boolean;
}): T[] {
  return input.connections.filter(
    (connection) =>
      billingConnectionMatchesProcessTestMode(
        connection.testMode,
        input.processTestMode
      ) &&
      billingConnectionHasConfiguredCredential({
        configuredProviders: input.configuredProviders,
        connection,
      })
  );
}

/**
 * Classic Mollie webhooks have no connectionId. Prefer the unique default
 * `providers.mollie` slot when more than one eligible row remains.
 */
export function pickSoleEligibleBillingConnection<
  T extends Pick<ResolvedBillingProviderConnection, "credentialReference">,
>(eligible: readonly T[]): T | undefined {
  if (eligible.length === 0) {
    return;
  }
  if (eligible.length === 1) {
    return eligible[0];
  }
  const defaults = eligible.filter(
    (connection) => connection.credentialReference === "providers.mollie"
  );
  return defaults.length === 1 ? defaults[0] : undefined;
}

export function createPersistedProviderBinding(input: {
  configuredProviders?: BillingProviderConfigMap;
  connectionId: string;
  credentialReference: string;
  provider: string;
}): PersistedBillingProviderBinding {
  const parsed = parseBillingCredentialReference(input.credentialReference);
  const connectionProvider = normalizeBillingProviderName(input.provider);
  if (parsed.provider !== connectionProvider) {
    throw new AthenaBillingProviderError({
      code: ATHENA_BILLING_PROVIDER_NOT_CONFIGURED,
      message: `Connection provider "${connectionProvider}" does not match credential_reference "${input.credentialReference}".`,
    });
  }
  const slotMap = slotConfigMap(
    parsed.provider,
    parsed.accountId,
    input.configuredProviders,
    input.credentialReference
  );
  const configured = createConfiguredProviderBinding({
    configuredProviders: slotMap,
    provider: parsed.provider,
  });
  return {
    connectionId: input.connectionId,
    credentialReference: input.credentialReference,
    credentials: configured.credentials,
    kind: "connection",
    provider: configured.provider,
    providerConfig: configured.providerConfig,
  };
}

export function createConnectionProviderExecutionContext(input: {
  configuredProviders?: BillingProviderConfigMap;
  connection: ResolvedBillingProviderConnection;
  ingress?: {
    classicWebhookUrl?: string;
    classicWebhookUrlsByConnectionId?: Readonly<Record<string, string>>;
  };
  operationScope?: "organization" | "profile" | "automatic";
}): BillingProviderExecutionContext {
  const binding = createPersistedProviderBinding({
    configuredProviders: input.configuredProviders,
    connectionId: input.connection.id,
    credentialReference: input.connection.credentialReference,
    provider: input.connection.provider,
  });
  return createBillingProviderExecutionContext({
    binding,
    ...(input.ingress ? { ingress: input.ingress } : {}),
    ...(input.operationScope === null
      ? {}
      : { operationScope: input.operationScope }),
    testMode: input.connection.testMode,
  });
}

function slotConfigMap(
  provider: "mollie" | "stripe",
  accountId: string | undefined,
  configured: BillingProviderConfigMap | undefined,
  reference: string
): BillingProviderConfigMap {
  const normalized = normalizeBillingProviderConfiguration({
    configuredProviders: configured,
    environment: "test",
  });
  const slot = configuredProviderSlot(
    normalized,
    provider,
    accountId ?? null,
  );
  if (slot == null) {
    throw missingSlot(reference);
  }
  return provider === "mollie"
    ? { mollie: rawMollieConfig(slot) }
    : { stripe: rawStripeConfig(slot) };
}

function missingSlot(reference: string): AthenaBillingProviderError {
  return new AthenaBillingProviderError({
    code: ATHENA_BILLING_PROVIDER_NOT_CONFIGURED,
    message: `No billing provider config is registered for credential_reference "${reference}".`,
  });
}
