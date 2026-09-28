import { resolveBillingEnvironment } from "../../../billing/runtime/environment.ts";
import { billingWebhookUrlTemplate } from "../../../billing/ingestion/urls.ts";
import { MOLLIE_BILLING_PROVIDER_CAPABILITIES } from "../../../billing/runtime/local/providers/mollie/capabilities.ts";
import type {
  AthenaDevtoolsBillingCapabilityInspector,
  AthenaDevtoolsBillingConnectionInspector,
} from "../../protocol/billing.ts";
import type { ProduceBillingInspectorInput } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nested(
  input: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> | undefined {
  const value = input?.[key];
  return isRecord(value) ? value : undefined;
}

function secretConfigured(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return false;
}

function mollieCredentialKind(mollie: Record<string, unknown>): string | null {
  if (typeof mollie.credentialKind === "string") {
    return mollie.credentialKind;
  }
  if (secretConfigured(mollie.accessToken)) {
    return "advanced_access_token";
  }
  if (secretConfigured(mollie.testKey) || secretConfigured(mollie.liveKey)) {
    return "api_key";
  }
  return null;
}

function mollieHasCredential(mollie: Record<string, unknown>): boolean {
  return (
    secretConfigured(mollie.accessToken) ||
    secretConfigured(mollie.testKey) ||
    secretConfigured(mollie.liveKey) ||
    secretConfigured(mollie.apiKey)
  );
}

function authorityFromMollie(mollie: Record<string, unknown>): {
  liveAllowed: boolean;
  scopeKind: string | null;
  testAllowed: boolean;
} {
  const authority = nested(mollie, "authority");
  const modes = nested(authority, "modes");
  const scope = nested(mollie, "scope") ?? nested(authority, "scope");
  const kind = typeof scope?.kind === "string" ? scope.kind : "organization";
  if (modes) {
    return {
      liveAllowed: modes.live === true,
      scopeKind: kind,
      testAllowed: modes.test === true,
    };
  }
  const environment = resolveBillingEnvironment({
    testMode:
      typeof mollie.apiMode === "string"
        ? mollie.apiMode !== "live"
        : undefined,
  }).name;
  return {
    liveAllowed: environment === "live",
    scopeKind: kind,
    testAllowed: environment === "test",
  };
}

function staticCapabilities(
  catalog: Record<string, unknown> | undefined
): AthenaDevtoolsBillingCapabilityInspector[] {
  const operations = {
    ...MOLLIE_BILLING_PROVIDER_CAPABILITIES.operations,
    "prices.list": Boolean(catalog?.prices),
    "products.list": Boolean(catalog?.products),
  };
  return Object.entries(operations).map(([operation, available]) => ({
    available: available === true,
    operation,
  }));
}

export function produceBillingConnections(
  input: ProduceBillingInspectorInput
): AthenaDevtoolsBillingConnectionInspector[] {
  const billing = nested(input.config, "billing");
  const providers = nested(billing, "providers");
  const catalog = nested(billing, "catalog");
  const environment = resolveBillingEnvironment({
    testMode:
      typeof billing?.testMode === "boolean" ? billing.testMode : undefined,
  }).name;
  const materialized = input.internals?.billingMaterializedConnections ?? [];
  const rows: AthenaDevtoolsBillingConnectionInspector[] = [];
  const mollieSlots: { key: string; config: Record<string, unknown> }[] = [];
  const primary = nested(providers, "mollie") ?? nested(billing, "mollie");
  if (primary) {
    mollieSlots.push({ config: primary, key: "mollie" });
  }
  const accounts = nested(providers, "mollieAccounts");
  if (accounts) {
    for (const [key, value] of Object.entries(accounts)) {
      if (isRecord(value)) {
        mollieSlots.push({ config: value, key });
      }
    }
  }
  for (const slot of mollieSlots) {
    const match =
      materialized.find(
        (row) =>
          row.credentialReference.endsWith(`:${slot.key}`) ||
          row.accountReference === slot.key
      ) ??
      (materialized.length === 1 && slot.key === "mollie"
        ? materialized[0]
        : undefined);
    const configured = mollieHasCredential(slot.config);
    const kind = mollieCredentialKind(slot.config);
    rows.push({
      accountReference: match?.accountReference ?? slot.key,
      authority: authorityFromMollie(slot.config),
      capabilities: staticCapabilities(catalog),
      credential: {
        configured: { configured, kind: "secret" },
        kind,
        secret: configured
          ? { configured: true, kind: "secret" }
          : { kind: "unset" },
      },
      credentialReference:
        match?.credentialReference ?? `providers.mollie:${slot.key}`,
      environment,
      id: match?.id ?? null,
      provider: "mollie",
      providerAccountId: null,
      providerProfileId:
        typeof slot.config.profileId === "string"
          ? slot.config.profileId
          : null,
      source: match ? "materialized" : "application_config",
      status: match ? "active" : configured ? "configured" : "pending",
      ...(match?.classicWebhookUrl && match.eventsWebhookUrl
        ? {
            webhookUrlTemplates: {
              classic: billingWebhookUrlTemplate(match.classicWebhookUrl),
              events: billingWebhookUrlTemplate(match.eventsWebhookUrl),
            },
          }
        : {}),
    });
  }
  if (rows.length === 0 && materialized.length > 0) {
    for (const match of materialized) {
      rows.push({
        accountReference: match.accountReference,
        authority: {
          liveAllowed: environment === "live",
          scopeKind: "organization",
          testAllowed: environment === "test",
        },
        capabilities: staticCapabilities(catalog),
        credential: {
          configured: { configured: true, kind: "secret" },
          kind: null,
          secret: { configured: true, kind: "secret" },
        },
        credentialReference: match.credentialReference,
        environment,
        id: match.id,
        provider: match.provider,
        providerAccountId: null,
        providerProfileId: null,
        source: "materialized",
        status: "active",
        ...(match.classicWebhookUrl && match.eventsWebhookUrl
          ? {
              webhookUrlTemplates: {
                classic: billingWebhookUrlTemplate(match.classicWebhookUrl),
                events: billingWebhookUrlTemplate(match.eventsWebhookUrl),
              },
            }
          : {}),
      });
    }
  } else {
    const seen = new Set(rows.map((row) => row.id).filter(Boolean));
    for (const match of materialized) {
      if (seen.has(match.id)) {
        continue;
      }
      rows.push({
        accountReference: match.accountReference,
        authority: {
          liveAllowed: environment === "live",
          scopeKind: "organization",
          testAllowed: environment === "test",
        },
        capabilities: staticCapabilities(catalog),
        credential: {
          configured: { configured: true, kind: "secret" },
          kind: null,
          secret: { configured: true, kind: "secret" },
        },
        credentialReference: match.credentialReference,
        environment,
        id: match.id,
        provider: match.provider,
        providerAccountId: null,
        providerProfileId: null,
        source: "materialized",
        status: "active",
        ...(match.classicWebhookUrl && match.eventsWebhookUrl
          ? {
              webhookUrlTemplates: {
                classic: billingWebhookUrlTemplate(match.classicWebhookUrl),
                events: billingWebhookUrlTemplate(match.eventsWebhookUrl),
              },
            }
          : {}),
      });
    }
  }
  return rows;
}
