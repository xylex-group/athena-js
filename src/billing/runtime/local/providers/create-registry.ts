import type {
  BillingProviderConfigMap,
} from "../../../providers/types.ts";
import {
  ATHENA_BILLING_PROVIDER_NOT_CONFIGURED,
  AthenaBillingProviderError,
} from "../../../errors.ts";
import type { AthenaBillingCatalogConfig } from "../../../types.ts";
import { normalizeAthenaBillingCatalog } from "../catalog/normalize.ts";
import { normalizeBillingProviderConfiguration } from "./configuration/index.ts";
import { createBillingProviderDefinitionRegistry } from "./definition-registry.ts";
import { BillingProviderRegistry } from "./registry.ts";
import type { BillingProviderRuntime } from "./types.ts";

function createSlotAwareProviderRuntime(
  provider: string,
  runtimes: ReadonlyMap<string, BillingProviderRuntime>,
  fallback: BillingProviderRuntime,
): BillingProviderRuntime {
  const isConnectionBinding = (context: unknown): boolean =>
    context != null &&
    typeof context === "object" &&
    "binding" in context &&
    (context as { binding?: { kind?: unknown } }).binding?.kind ===
      "connection";
  const delegateFor = (context: unknown): BillingProviderRuntime => {
    if (
      context != null &&
      typeof context === "object" &&
      "binding" in context
    ) {
      const binding = (context as {
        binding?: { credentialReference?: unknown; kind?: unknown };
      }).binding;
      if (typeof binding?.credentialReference === "string") {
        const runtime = runtimes.get(binding.credentialReference);
        if (runtime != null) {
          return runtime;
        }
        if (binding.kind === "connection") {
          throw new AthenaBillingProviderError({
            code: ATHENA_BILLING_PROVIDER_NOT_CONFIGURED,
            message: `No provider runtime is registered for credential_reference "${binding.credentialReference}".`,
          });
        }
      }
    }
    return fallback;
  };
  const routePort = <T extends object>(port: keyof BillingProviderRuntime) => {
    const fallbackPort = fallback[port];
    if (fallbackPort == null || typeof fallbackPort !== "object") {
      return undefined;
    }
    return new Proxy(fallbackPort, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== "function") {
          return value;
        }
        return (...args: unknown[]) => {
          const runtime = delegateFor(args[0]);
          const portValue = runtime[port];
          const method =
            portValue != null && typeof portValue === "object"
              ? (portValue as unknown as Record<PropertyKey, unknown>)[property]
              : undefined;
          if (typeof method !== "function") {
            if (isConnectionBinding(args[0])) {
              throw new AthenaBillingProviderError({
                code: ATHENA_BILLING_PROVIDER_NOT_CONFIGURED,
                message: `The selected provider runtime does not support "${String(property)}".`,
              });
            }
            return value(...args);
          }
          return method.apply(portValue, args);
        };
      },
    }) as T;
  };
  return {
    checkout: routePort("checkout"),
    customers: routePort("customers"),
    getCapabilities: (binding) =>
      delegateFor({ binding }).getCapabilities(binding),
    invoices: routePort("invoices"),
    paymentLinks: routePort("paymentLinks"),
    payments: routePort("payments"),
    prices: routePort("prices"),
    products: routePort("products"),
    provider: provider as BillingProviderRuntime["provider"],
    refunds: routePort("refunds"),
    subscriptions: routePort("subscriptions"),
    webhooks: routePort("webhooks"),
    relations: routePort("relations"),
  };
}

export function createBillingProviderRegistry(
  configured?: BillingProviderConfigMap,
  catalog?: AthenaBillingCatalogConfig
): BillingProviderRegistry {
  const normalizedSlots = normalizeBillingProviderConfiguration({
    configuredProviders: configured,
    environment: "test",
  });
  const athenaCatalog = normalizeAthenaBillingCatalog(catalog);
  const definitions = createBillingProviderDefinitionRegistry();
  const runtimes = [];
  for (const [provider, configured] of normalizedSlots.providers) {
    const definition = definitions.require(provider);
    const slots = [
      ...(configured.defaultSlot == null ? [] : [configured.defaultSlot]),
      ...configured.slots.values(),
    ];
    if (slots.length === 0) {
      continue;
    }
    const slotRuntimes = new Map<string, BillingProviderRuntime>();
    for (const slot of slots) {
      const normalized = definition.configuration.normalize(slot.rawConfig);
      const runtime = definition.runtime.create(normalized, {
        catalog: athenaCatalog,
      });
      slotRuntimes.set(slot.credentialReference, runtime);
      if (slot.slotKey == null) {
        slotRuntimes.set(`providers.${provider}-live`, runtime);
      }
    }
    const fallback = slotRuntimes.get(
      configured.defaultSlot?.credentialReference ?? slots[0].credentialReference,
    );
    if (fallback == null) {
      continue;
    }
    runtimes.push(
      createSlotAwareProviderRuntime(provider, slotRuntimes, fallback),
    );
  }
  return new BillingProviderRegistry(runtimes);
}
