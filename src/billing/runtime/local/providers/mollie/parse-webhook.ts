import {
  ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID,
  AthenaEventIngressError,
} from "../../../../../runtime/ingress/errors.ts";
import { mollieWebhookChannel } from "./channel.ts";
import { MOLLIE_WEBHOOK_MAX_BODY_BYTES } from "./verify-webhook.ts";

/** Observability threshold only. Next-gen ingest must not reject on age. */
export const MOLLIE_WEBHOOK_MAX_AGE_MS = 15 * 60 * 1000;

export interface MollieClassicWebhookEnvelope {
  id: string;
  kind: "classic";
  resourceId: string;
}

export interface MollieNextGenWebhookEnvelope {
  createdAt: string;
  entityId: string;
  eventId: string;
  eventType: string;
  id: string;
  kind: "next_gen";
  resource: string;
  type: string;
}

export type MollieWebhookEnvelope =
  | MollieClassicWebhookEnvelope
  | MollieNextGenWebhookEnvelope;

export type MollieWebhookBodyKind = "empty" | "json" | "form" | "unknown";

export interface MollieWebhookEnvelopeDiagnostics {
  bodyBytes: number;
  bodyKind: MollieWebhookBodyKind;
  contentType?: string;
}

export interface MollieWebhookExpectedEnvelope {
  contentType: string;
  example: string;
  fields: Record<string, string>;
  kind: "classic" | "next_gen";
}

export const MOLLIE_CLASSIC_WEBHOOK_EXPECTED_ENVELOPE: MollieWebhookExpectedEnvelope =
  {
    contentType: "application/x-www-form-urlencoded",
    example: "id=tr_xxxxxxxxxxx",
    fields: {
      id: "resource id (payment, subscription, or invoice)",
    },
    kind: "classic",
  };

export const MOLLIE_NEXT_GEN_WEBHOOK_EXPECTED_ENVELOPE: MollieWebhookExpectedEnvelope =
  {
    contentType: "application/json",
    example: JSON.stringify({
      createdAt: "2026-08-30T00:00:00.000Z",
      entityId: "tr_xxxxxxxxxxx",
      id: "event_xxxxxxxxxxx",
      resource: "event",
      type: "payment.paid",
    }),
    fields: {
      createdAt: "ISO-8601 timestamp (delivery-lag observability only)",
      entityId: "resource id",
      id: "event id",
      resource: "optional resource name",
      type: "optional event type",
    },
    kind: "next_gen",
  };

export function expectedMollieWebhookEnvelope(
  operation?: string
): MollieWebhookExpectedEnvelope {
  const channel = operation ? mollieWebhookChannel(operation) : undefined;
  if (channel?.kind === "classic") {
    return MOLLIE_CLASSIC_WEBHOOK_EXPECTED_ENVELOPE;
  }
  return MOLLIE_NEXT_GEN_WEBHOOK_EXPECTED_ENVELOPE;
}

export function decodeMollieWebhookAttemptedBody(body: Uint8Array): string {
  return new TextDecoder().decode(body);
}

export function formatMollieWebhookAttemptedBody(
  body: Uint8Array,
  bodyKind: MollieWebhookBodyKind
): string {
  const text = decodeMollieWebhookAttemptedBody(body);
  if (bodyKind !== "json") {
    return text;
  }
  try {
    return JSON.stringify(JSON.parse(text) as unknown, null, 2);
  } catch {
    return text;
  }
}

function decodeBody(body: Uint8Array): string {
  return new TextDecoder().decode(body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function classifyMollieWebhookBody(
  body: Uint8Array,
  contentType?: string
): MollieWebhookEnvelopeDiagnostics {
  const text = decodeBody(body).trim();
  let bodyKind: MollieWebhookBodyKind = "unknown";
  if (text.length === 0) {
    bodyKind = "empty";
  } else if (text.startsWith("{") || text.startsWith("[")) {
    bodyKind = "json";
  } else if (text.includes("=")) {
    bodyKind = "form";
  }
  return {
    bodyBytes: body.byteLength,
    bodyKind,
    ...(contentType ? { contentType } : {}),
  };
}

function envelopeError(
  message: string,
  diagnostics: MollieWebhookEnvelopeDiagnostics
): AthenaEventIngressError {
  return new AthenaEventIngressError({
    code: ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID,
    diagnostics,
    domain: "billing",
    message,
    provider: "mollie",
    retryable: false,
  });
}

function assertMollieWebhookBodySize(
  body: Uint8Array,
  diagnostics: MollieWebhookEnvelopeDiagnostics
): void {
  if (body.byteLength > MOLLIE_WEBHOOK_MAX_BODY_BYTES) {
    throw envelopeError(
      "Mollie webhook payload exceeds size limit.",
      diagnostics
    );
  }
}

function assertMollieWebhookCreatedAtSyntax(
  createdAt: string | undefined,
  diagnostics: MollieWebhookEnvelopeDiagnostics
): asserts createdAt is string {
  if (createdAt == null || createdAt.trim() === "") {
    throw envelopeError("Mollie webhook createdAt is required.", diagnostics);
  }
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) {
    throw envelopeError("Mollie webhook createdAt is invalid.", diagnostics);
  }
}

export function mollieWebhookDeliveryLagMs(
  createdAt: string,
  receivedAt: Date
): number {
  return receivedAt.getTime() - Date.parse(createdAt);
}

export function parseClassicMollieWebhook(
  body: Uint8Array,
  contentType?: string
): MollieClassicWebhookEnvelope {
  const diagnostics = classifyMollieWebhookBody(body, contentType);
  assertMollieWebhookBodySize(body, diagnostics);
  if (diagnostics.bodyKind === "json") {
    throw envelopeError(
      "Classic Mollie webhook expected a form id payload.",
      diagnostics
    );
  }
  const text = decodeBody(body).trim();
  const params = new URLSearchParams(text);
  const resourceId = params.get("id");
  if (!resourceId) {
    throw envelopeError("Mollie webhook envelope is invalid.", diagnostics);
  }
  return { id: resourceId, kind: "classic", resourceId };
}

export function parseNextGenMollieWebhook(
  body: Uint8Array,
  contentType?: string
): MollieNextGenWebhookEnvelope {
  const diagnostics = classifyMollieWebhookBody(body, contentType);
  assertMollieWebhookBodySize(body, diagnostics);
  if (diagnostics.bodyKind !== "json") {
    throw envelopeError(
      "Next-gen Mollie webhook expected a JSON event payload.",
      diagnostics
    );
  }
  const text = decodeBody(body).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw envelopeError("Mollie webhook envelope is invalid.", diagnostics);
  }
  if (
    !(
      isRecord(parsed) &&
      typeof parsed.id === "string" &&
      typeof parsed.entityId === "string"
    )
  ) {
    throw envelopeError("Mollie webhook envelope is invalid.", diagnostics);
  }
  const createdAt =
    typeof parsed.createdAt === "string" ? parsed.createdAt : undefined;
  assertMollieWebhookCreatedAtSyntax(createdAt, diagnostics);
  const eventType = typeof parsed.type === "string" ? parsed.type : "unknown";
  return {
    createdAt,
    entityId: parsed.entityId,
    eventId: parsed.id,
    eventType,
    id: parsed.id,
    kind: "next_gen",
    resource: typeof parsed.resource === "string" ? parsed.resource : "event",
    type: eventType,
  };
}

export function parseMollieWebhookBody(
  body: Uint8Array,
  input: { contentType?: string; operation: string }
): MollieWebhookEnvelope {
  const channel = mollieWebhookChannel(input.operation);
  if (channel == null) {
    throw envelopeError(
      "Mollie webhook channel must be bound from the route, not inferred from the body.",
      classifyMollieWebhookBody(body, input.contentType)
    );
  }
  return parseMollieWebhookForChannel(channel.kind, body, input.contentType);
}

export function parseMollieWebhookForChannel(
  kind: "classic" | "next_gen",
  body: Uint8Array,
  contentType?: string
): MollieWebhookEnvelope {
  if (kind === "classic") {
    return parseClassicMollieWebhook(body, contentType);
  }
  return parseNextGenMollieWebhook(body, contentType);
}
