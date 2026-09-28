/**
 * Webhook ownership identity is an installation id, not a display name.
 * `app.name` must never enter `athena:{id}:{connection}:billing`.
 */
export function resolveBillingWebhookApplicationId(input: {
  app?: { id?: string | null; name?: string | null } | null;
  client?: string | null;
}): string | undefined {
  const fromApp = trimId(input.app?.id);
  if (fromApp != null) {
    return fromApp;
  }
  return trimId(input.client);
}

function trimId(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
