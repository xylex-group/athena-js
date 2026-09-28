import type {
  AthenaDevtoolsBillingConnectionInspector,
  AthenaDevtoolsBillingWebhookInspector,
} from "../../protocol/billing.ts";
import { billingWebhookUrlTemplate } from "../../../billing/ingestion/urls.ts";
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

export function produceBillingWebhooks(
  input: ProduceBillingInspectorInput,
  connections: AthenaDevtoolsBillingConnectionInspector[]
): AthenaDevtoolsBillingWebhookInspector {
  const billing = nested(input.config, "billing");
  const ingestion = nested(billing, "ingestion");
  const webhooks = nested(ingestion, "webhooks");
  const mollie = nested(nested(webhooks, "providers"), "mollie");
  const classic = nested(mollie, "classic");
  const nextGen = nested(mollie, "nextGen");
  const ingress = input.internals?.billingProviderRegistry?.ingress;
  const publicUrl =
    typeof ingress?.classicWebhookUrl === "string"
      ? billingWebhookUrlTemplate(ingress.classicWebhookUrl)
      : null;
  const hasConnection = connections.some(
    (row) => typeof row.id === "string" && row.id.length > 0
  );
  const classicEnabled =
    classic?.enabled !== false && webhooks?.enabled !== false;
  const nextGenEnabled = nextGen?.enabled === true;
  const signingConfigured = Boolean(
    nested(nextGen, "signingSecret") ||
      typeof nextGen?.signingSecret === "string"
  );
  return {
    desired: {
      classicEnabled: Boolean(webhooks) && classicEnabled,
      connectionId: null,
      nextGenEnabled,
      publicUrl,
    },
    ingress: {
      bindingToken: { configured: hasConnection, kind: "secret" },
      duplicateCount: null,
      lastReceivedAt: null,
      lastRejectedAt: null,
      lastVerifiedAt: null,
      signingSecret: signingConfigured
        ? { configured: true, kind: "secret" }
        : { kind: "unset" },
    },
    provider: {
      providerWebhookId: null,
      registration: "unknown",
      status: null,
      target: publicUrl,
    },
  };
}
