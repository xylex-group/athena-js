import {
  ATHENA_EMAIL_DELIVERY_FAILED,
  ATHENA_EMAIL_MESSAGE_INVALID,
  ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED,
  AthenaEmailError,
} from "./errors.ts";
import { assertAthenaEmailProviderRuntime } from "./capabilities.ts";
import type { NormalizedAthenaEmailConfig } from "./normalize-config.ts";
import type {
  AthenaEmailAttachment,
  AthenaEmailDeliveryResult,
  AthenaEmailMessage,
  AthenaResolvedEmailMessage,
} from "./types.ts";

function asAddressList(value: string | string[] | undefined): string[] {
  if (value == null) {
    return [];
  }
  const items = Array.isArray(value) ? value : [value];
  return items
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function cloneAttachments(
  attachments: AthenaEmailAttachment[] | undefined
): AthenaEmailAttachment[] {
  if (!attachments?.length) {
    return [];
  }
  return attachments.map((attachment) => ({
    ...(attachment.content === undefined ? {} : { content: attachment.content }),
    ...(attachment.contentType
      ? { contentType: attachment.contentType }
      : {}),
    ...(attachment.filename ? { filename: attachment.filename } : {}),
    ...(attachment.fileUrl ? { fileUrl: attachment.fileUrl } : {}),
  }));
}

function cloneHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> {
  if (!headers) {
    return {};
  }
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      next[key] = value;
    }
  }
  return next;
}

function cloneMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!metadata) {
    return {};
  }
  return { ...metadata };
}

export function resolveAthenaEmailMessage(
  message: AthenaEmailMessage,
  normalized: NormalizedAthenaEmailConfig
): AthenaResolvedEmailMessage {
  const to = asAddressList(message.to);
  const subject =
    typeof message.subject === "string" ? message.subject.trim() : "";
  const from =
    (typeof message.from === "string" ? message.from.trim() : "") ||
    normalized.defaults.from ||
    "";
  if (to.length === 0) {
    throw new AthenaEmailError(
      ATHENA_EMAIL_MESSAGE_INVALID,
      "Athena email messages require at least one recipient."
    );
  }
  if (!subject) {
    throw new AthenaEmailError(
      ATHENA_EMAIL_MESSAGE_INVALID,
      "Athena email messages require a subject."
    );
  }
  if (!from) {
    throw new AthenaEmailError(
      ATHENA_EMAIL_MESSAGE_INVALID,
      "Athena email messages require from, either on the message or email.defaults.from."
    );
  }

  const fromName =
    (typeof message.fromName === "string" ? message.fromName.trim() : "") ||
    normalized.defaults.fromName;
  const replyTo =
    (typeof message.replyTo === "string" ? message.replyTo.trim() : "") ||
    normalized.defaults.replyTo;
  const locale =
    (typeof message.locale === "string" ? message.locale.trim() : "") ||
    normalized.defaults.locale;

  return {
    attachmentFailureMode:
      message.attachmentFailureMode === "skip" ||
      message.attachmentFailureMode === "fail"
        ? message.attachmentFailureMode
        : normalized.attachmentFailureMode,
    attachments: cloneAttachments(message.attachments),
    bcc: asAddressList(message.bcc),
    cc: asAddressList(message.cc),
    from,
    ...(fromName ? { fromName } : {}),
    headers: cloneHeaders(message.headers),
    ...(typeof message.html === "string" ? { html: message.html } : {}),
    ...(locale ? { locale } : {}),
    metadata: cloneMetadata(message.metadata),
    ...(replyTo ? { replyTo } : {}),
    subject,
    ...(typeof message.text === "string" ? { text: message.text } : {}),
    to,
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Strip unknown provider fields so public APIs never expose native SDK types.
 */
export function envelopeAcceptedRecipients(
  message: Pick<AthenaResolvedEmailMessage, "to" | "cc" | "bcc">
): string[] {
  return [...message.to, ...message.cc, ...message.bcc];
}

export function toPublicEmailDeliveryResult(
  value: unknown,
  providerId: string
): AthenaEmailDeliveryResult {
  const raw =
    value && typeof value === "object"
      ? (value as Partial<AthenaEmailDeliveryResult>)
      : {};
  const accepted = asStringArray(raw.accepted);
  const rejected = asStringArray(raw.rejected);
  const messageId =
    typeof raw.messageId === "string" && raw.messageId.trim()
      ? raw.messageId.trim()
      : undefined;
  return {
    accepted,
    ...(messageId ? { messageId } : {}),
    provider:
      typeof raw.provider === "string" && raw.provider.trim()
        ? raw.provider.trim()
        : providerId,
    rejected,
    success: raw.success === true,
  };
}

export async function deliverAthenaEmail(
  message: AthenaEmailMessage,
  normalized: NormalizedAthenaEmailConfig
): Promise<AthenaEmailDeliveryResult> {
  const provider = normalized.provider;
  if (!provider) {
    throw new AthenaEmailError(
      ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED,
      "Athena email has no provider configured. Pass createClient({ email: { provider } })."
    );
  }
  const resolved = resolveAthenaEmailMessage(message, normalized);
  assertAthenaEmailProviderRuntime(provider);
  try {
    const result = await provider.send(resolved);
    return {
      ...toPublicEmailDeliveryResult(result, provider.id),
      from: resolved.from,
      ...(resolved.fromName ? { fromName: resolved.fromName } : {}),
    };
  } catch (cause) {
    if (cause instanceof AthenaEmailError) {
      throw cause;
    }
    throw new AthenaEmailError(
      ATHENA_EMAIL_DELIVERY_FAILED,
      "Athena email delivery failed.",
      { cause }
    );
  }
}
