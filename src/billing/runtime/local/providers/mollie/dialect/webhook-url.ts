import type { BillingProviderExecutionContext } from "../../types.ts";

export function trustedClassicWebhookUrl(
  context: BillingProviderExecutionContext
): string | undefined {
  const url = context.ingress?.classicWebhookUrl?.trim();
  return url && url.length > 0 ? url : undefined;
}

export function applyTrustedClassicWebhookUrl(
  body: Record<string, unknown>,
  context: BillingProviderExecutionContext
): Record<string, unknown> {
  const url = trustedClassicWebhookUrl(context);
  if (url) {
    body.webhookUrl = url;
  }
  return body;
}
