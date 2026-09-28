import { AthenaConfigurationError } from "../../config/errors.ts";
import type { BillingCredentialKind } from "../runtime/credentials.ts";
import {
  type AthenaBillingIngestionConfig,
  type AthenaBillingWebhooksConfig,
  type BillingManagedWebhookEnablement,
  type BillingSigningSecretSet,
  DEFAULT_MOLLIE_NEXT_GEN_EVENT_TYPES,
  type NormalizedAthenaBillingIngestionConfig,
  type NormalizedAthenaBillingWebhooksConfig,
  type NormalizedMollieWebhookProviderConfig,
} from "./types.ts";
import { assertStableHttpsBillingPublicUrl } from "./urls.ts";

const DEFAULT_MOLLIE: NormalizedMollieWebhookProviderConfig = {
  classic: { enabled: true },
  nextGen: {
    enabled: "auto",
    eventTypes: DEFAULT_MOLLIE_NEXT_GEN_EVENT_TYPES,
    previousSigningSecrets: [],
  },
  strategy: "hybrid",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizeEnablement(value: unknown): BillingManagedWebhookEnablement {
  if (value === false) {
    return false;
  }
  if (value === "required") {
    return "required";
  }
  return "auto";
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim() !== ""
  );
}

function normalizeMollieProvider(
  raw: unknown
): NormalizedMollieWebhookProviderConfig {
  if (!isRecord(raw)) {
    return { ...DEFAULT_MOLLIE, nextGen: { ...DEFAULT_MOLLIE.nextGen } };
  }
  const classic = isRecord(raw.classic) ? raw.classic : {};
  const nextGen = isRecord(raw.nextGen) ? raw.nextGen : {};
  const strategy =
    raw.strategy === "classic" || raw.strategy === "next_gen"
      ? raw.strategy
      : "hybrid";
  const eventTypes = stringList(nextGen.eventTypes);
  return {
    classic: { enabled: classic.enabled !== false },
    nextGen: {
      enabled: normalizeEnablement(nextGen.enabled),
      eventTypes:
        eventTypes.length > 0
          ? eventTypes
          : DEFAULT_MOLLIE_NEXT_GEN_EVENT_TYPES,
      previousSigningSecrets: stringList(nextGen.previousSigningSecrets),
      ...(typeof nextGen.signingSecret === "string" &&
      nextGen.signingSecret.length > 0
        ? { signingSecret: nextGen.signingSecret }
        : {}),
    },
    strategy,
  };
}

export function normalizeAthenaBillingWebhooks(
  input?: AthenaBillingWebhooksConfig
): NormalizedAthenaBillingWebhooksConfig {
  if (input === true) {
    return {
      enabled: true,
      execution: "embedded",
      management: "automatic",
      providers: { mollie: normalizeMollieProvider(undefined) },
    };
  }
  if (input === false || input === undefined) {
    return {
      enabled: false,
      execution: "embedded",
      management: "manual",
      providers: { mollie: normalizeMollieProvider(undefined) },
    };
  }
  const publicBaseUrl =
    typeof input.publicBaseUrl === "string" && input.publicBaseUrl.trim()
      ? input.publicBaseUrl.trim()
      : undefined;
  const secretMasterKey =
    typeof input.secretMasterKey === "string" && input.secretMasterKey.trim()
      ? input.secretMasterKey.trim()
      : undefined;
  return {
    enabled: input.enabled !== false,
    execution: input.execution === "external" ? "external" : "embedded",
    management: input.management === "manual" ? "manual" : "automatic",
    providers: {
      mollie: normalizeMollieProvider(input.providers?.mollie),
    },
    ...(publicBaseUrl ? { publicBaseUrl } : {}),
    ...(secretMasterKey ? { secretMasterKey } : {}),
  };
}

export function normalizeAthenaBillingIngestion(
  input?: AthenaBillingIngestionConfig
): NormalizedAthenaBillingIngestionConfig {
  return {
    webhooks: normalizeAthenaBillingWebhooks(input?.webhooks),
  };
}

export function signingSecretsFromWebhookConfig(
  webhooks: NormalizedAthenaBillingWebhooksConfig
): BillingSigningSecretSet {
  const nextGen = webhooks.providers.mollie.nextGen;
  return {
    current:
      typeof nextGen.signingSecret === "string"
        ? nextGen.signingSecret.trim() || undefined
        : nextGen.signingSecret,
    previous: nextGen.previousSigningSecrets
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  };
}

export function flattenSigningSecrets(
  secrets: BillingSigningSecretSet
): readonly string[] {
  const values = [
    ...(secrets.current ? [secrets.current] : []),
    ...secrets.previous,
  ];
  return [...new Set(values)];
}

export function mollieCredentialSupportsManagedNextGen(
  kind?: BillingCredentialKind
): boolean {
  return (
    kind === "advanced_access_token" ||
    kind === "organization_access_token" ||
    kind === "oauth_access_token"
  );
}

export function assertAthenaBillingIngestion(input: {
  appUrl?: string | null;
  credentialKind?: BillingCredentialKind;
  ingestion?: AthenaBillingIngestionConfig;
  live?: boolean;
}): NormalizedAthenaBillingIngestionConfig {
  const normalized = normalizeAthenaBillingIngestion(input.ingestion);
  const webhooks = normalized.webhooks;
  if (!webhooks.enabled) {
    return normalized;
  }
  assertStableHttpsBillingPublicUrl({
    appUrl: input.appUrl,
    live: input.live,
    management: webhooks.management,
    publicBaseUrl: webhooks.publicBaseUrl,
    webhooksEnabled: webhooks.enabled,
  });
  if (
    webhooks.providers.mollie.nextGen.enabled === "required" &&
    !mollieCredentialSupportsManagedNextGen(input.credentialKind)
  ) {
    throw new AthenaConfigurationError(
      "ATHENA_BILLING_INGESTION_NEXT_GEN_REQUIRED",
      'billing.ingestion.webhooks Mollie nextGen.enabled is "required" but the configured credential cannot register managed Next-gen webhooks (API keys are Classic-only).',
      "billing"
    );
  }
  if (
    webhooks.providers.mollie.strategy === "next_gen" &&
    webhooks.providers.mollie.nextGen.enabled === false
  ) {
    throw new AthenaConfigurationError(
      "ATHENA_BILLING_INGESTION_CONFIG_INVALID",
      "Mollie webhook strategy next_gen cannot disable nextGen.",
      "billing"
    );
  }
  return normalized;
}
