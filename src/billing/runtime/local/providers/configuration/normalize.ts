import type {
  BillingProviderConfigMap,
  MollieBillingProviderConfig,
  StripeBillingProviderConfig,
} from "../../../../providers/types.ts";
import {
  ATHENA_BILLING_PROVIDER_SLOT_CONFLICT,
  AthenaBillingProviderError,
} from "../../../../errors.ts";
import type { BillingProviderName } from "../../../../types.ts";
import {
  credentialReferenceForConfiguredSlot,
} from "./slots.ts";
import type {
  BillingConfiguredProvider,
  BillingConfiguredProviderSlot,
  BillingConfiguredProviders,
} from "./ir.ts";
import { validateBillingConfiguredProviders } from "./validate.ts";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function credentialKind(provider: BillingProviderName, config: unknown): string {
  if (isRecord(config) && typeof config.credentialKind === "string") {
    return config.credentialKind;
  }
  if (
    provider === "mollie" &&
    isRecord(config) &&
    typeof config.accessToken === "string"
  ) {
    return "advanced_access_token";
  }
  return provider === "stripe" ? "secret_key" : "api_key";
}

function slot(
  provider: BillingProviderName,
  slotKey: string | null,
  config: unknown,
  environment: "test" | "live"
): BillingConfiguredProviderSlot {
  return {
    credentialKind: credentialKind(provider, config),
    credentialReference: credentialReferenceForConfiguredSlot({
      environment,
      provider,
      slotKey,
    }),
    provider,
    rawConfig: config,
    slotKey,
  };
}

function providerEntry(
  provider: BillingProviderName,
  value: unknown,
  sidecar: unknown,
  environment: "test" | "live"
): BillingConfiguredProvider | undefined {
  const canonical = isRecord(value) ? value : undefined;
  const isCanonical =
    canonical != null &&
    (Object.hasOwn(canonical, "default") || Object.hasOwn(canonical, "accounts"));
  const canonicalDefault =
    isCanonical
      ? canonical.default
      : value;
  const canonicalAccounts =
    canonical && isRecord(canonical.accounts) ? canonical.accounts : undefined;
  const sidecarAccounts = isRecord(sidecar) ? sidecar : undefined;
  const defaultSlot =
    canonicalDefault == null
      ? undefined
      : slot(provider, null, canonicalDefault, environment);
  const slots = new Map<string, BillingConfiguredProviderSlot>();
  if (canonicalAccounts) {
    for (const [key, config] of Object.entries(canonicalAccounts)) {
      const trimmed = key.trim();
      if (trimmed.length > 0 && config != null) {
        if (slots.has(trimmed)) {
          throw new AthenaBillingProviderError({
            code: ATHENA_BILLING_PROVIDER_SLOT_CONFLICT,
            message: `Billing provider slot "${provider}:${trimmed}" is declared more than once.`,
          });
        }
        slots.set(trimmed, slot(provider, trimmed, config, environment));
      }
    }
  }
  if (sidecarAccounts) {
    for (const [key, config] of Object.entries(sidecarAccounts)) {
      const trimmed = key.trim();
      if (trimmed.length === 0 || config == null) {
        continue;
      }
      if (slots.has(trimmed)) {
        throw new AthenaBillingProviderError({
          code: ATHENA_BILLING_PROVIDER_SLOT_CONFLICT,
          message: `Billing provider slot "${provider}:${trimmed}" is declared in both canonical and legacy configuration.`,
        });
      }
      slots.set(trimmed, slot(provider, trimmed, config, environment));
    }
  }
  if (defaultSlot == null && slots.size === 0) {
    return undefined;
  }
  return {
    ...(defaultSlot == null ? {} : { defaultSlot }),
    provider,
    slots,
  };
}

export function normalizeBillingProviderConfiguration(input: {
  configuredProviders?: BillingProviderConfigMap;
  environment: "test" | "live";
}): BillingConfiguredProviders {
  const raw = input.configuredProviders as RecordValue | undefined;
  const providers = new Map<BillingProviderName, BillingConfiguredProvider>();
  if (raw == null) {
    return { providers };
  }

  const providerNames = new Set<string>();
  for (const key of Object.keys(raw)) {
    if (key.endsWith("Accounts")) {
      providerNames.add(key.slice(0, -"Accounts".length));
      continue;
    }
    providerNames.add(key);
  }
  for (const name of providerNames) {
    const value = raw[name];
    const sidecar = raw[`${name}Accounts`];
    const entry = providerEntry(name, value, sidecar, input.environment);
    if (entry) {
      providers.set(name, entry);
    }
  }
  return validateBillingConfiguredProviders({ providers });
}

export function configuredProviderSlot(
  configured: BillingConfiguredProviders,
  provider: BillingProviderName,
  slotKey: string | null
): BillingConfiguredProviderSlot | undefined {
  const entry = configured.providers.get(provider);
  if (entry == null) {
    return;
  }
  return slotKey == null ? entry.defaultSlot : entry.slots.get(slotKey);
}

export function rawMollieConfig(
  slot: BillingConfiguredProviderSlot
): MollieBillingProviderConfig {
  return slot.rawConfig as MollieBillingProviderConfig;
}

export function rawStripeConfig(
  slot: BillingConfiguredProviderSlot
): StripeBillingProviderConfig {
  return slot.rawConfig as StripeBillingProviderConfig;
}

export function configuredProviderNames(
  configured: BillingConfiguredProviders
): readonly BillingProviderName[] {
  return [...configured.providers.keys()];
}

export function configuredProviderSlotEntries(
  configured: BillingConfiguredProviders
): readonly BillingConfiguredProviderSlot[] {
  return [...configured.providers.values()].flatMap((provider) => [
    ...(provider.defaultSlot == null ? [] : [provider.defaultSlot]),
    ...provider.slots.values(),
  ]);
}
