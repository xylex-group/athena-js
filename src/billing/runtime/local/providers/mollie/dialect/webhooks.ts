import { billingWebhookUrlIsLoopback } from "../../../../../ingestion/urls.ts";
import type {
  BillingProviderCreateWebhookInput,
  BillingProviderUpdateWebhookInput,
} from "../../types.ts";
import { createMollieProviderRequestError } from "../errors.ts";

/** Same bound as {@link MOLLIE_WEBHOOK_OWNERSHIP_NAME_MAX}. */
const MOLLIE_WEBHOOK_NAME_MAX = 30;

/**
 * mollie-api-typescript `webhooks.create` outbound `eventTypes` is
 * `string[] | WebhookEventTypes` (one enum value). Mollie `POST /v2/webhooks`
 * treats a JSON array as unset and returns 422 "No event types were set".
 * The wire value is a comma-separated string (same as Mollie's curl sample).
 * Do not send that string through Speakeasy `webhooks.create` — Zod drops it.
 */
export function encodeMollieWebhookEventTypes(
  eventTypes: readonly string[]
): string {
  const encoded = eventTypes
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .join(",");
  if (encoded.length === 0) {
    throw new Error("Mollie webhook create requires at least one event type.");
  }
  return encoded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** Mollie returns `webhookSecret` only on create (and sometimes update). */
export function readMollieWebhookSigningSecret(
  raw: unknown
): string | undefined {
  if (!isRecord(raw)) {
    return;
  }
  const secret = raw.webhookSecret ?? raw.webhook_secret;
  if (typeof secret !== "string") {
    return;
  }
  const trimmed = secret.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function decodeMollieWebhookEventTypes(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

function rejectLoopbackMollieWebhookUrl(
  url: string | undefined,
  operation: "webhooks.create" | "webhooks.update"
): void {
  if (url == null || url.trim().length === 0) {
    return;
  }
  if (!billingWebhookUrlIsLoopback(url)) {
    return;
  }
  throw createMollieProviderRequestError({
    fallbackMessage:
      "Mollie cannot deliver webhooks to a loopback URL. Set APP_URL or billing.ingestion.webhooks.publicBaseUrl to a publicly reachable HTTPS origin, then register the webhook again.",
    kind: "invalid_request",
    operation,
    requestDispatchState: "not_dispatched",
    status: 422,
  });
}

export function mapCreateWebhookToMollieSdk(input: {
  input: BillingProviderCreateWebhookInput;
  testMode: boolean;
}): Record<string, unknown> {
  const name = input.input.name.trim();
  if (name.length === 0 || name.length > MOLLIE_WEBHOOK_NAME_MAX) {
    throw new Error(
      `Mollie webhook name must be 1–${MOLLIE_WEBHOOK_NAME_MAX} characters.`
    );
  }
  rejectLoopbackMollieWebhookUrl(input.input.url, "webhooks.create");
  return {
    idempotencyKey: input.input.idempotencyKey,
    requestBody: {
      eventTypes: encodeMollieWebhookEventTypes(input.input.eventTypes),
      name,
      testmode: input.testMode,
      url: input.input.url,
    },
  };
}

export function mapUpdateWebhookToMollieSdk(input: {
  input: BillingProviderUpdateWebhookInput;
  testMode: boolean;
}): Record<string, unknown> {
  const requestBody: Record<string, unknown> = {
    testmode: input.testMode,
  };
  if (input.input.eventTypes) {
    requestBody.eventTypes = encodeMollieWebhookEventTypes(
      input.input.eventTypes
    );
  }
  if (input.input.name) {
    requestBody.name = input.input.name;
  }
  if (input.input.url) {
    rejectLoopbackMollieWebhookUrl(input.input.url, "webhooks.update");
    requestBody.url = input.input.url;
  }
  return {
    requestBody,
    webhookId: input.input.id,
  };
}
