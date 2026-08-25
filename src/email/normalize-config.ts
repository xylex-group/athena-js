import { isAthenaEmailProvider } from "./provider.ts";
import type {
  AthenaEmailAttachmentFailureMode,
  AthenaEmailConfig,
  AthenaEmailDefaults,
  AthenaEmailDiagnostics,
  AthenaEmailProvider,
} from "./types.ts";

export interface NormalizedAthenaEmailConfig {
  attachmentFailureMode: AthenaEmailAttachmentFailureMode;
  defaults: AthenaEmailDefaults;
  provider: AthenaEmailProvider | null;
}

const EMPTY_DEFAULTS: AthenaEmailDefaults = {};

function trimOptional(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeDefaults(input: unknown): AthenaEmailDefaults {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ...EMPTY_DEFAULTS };
  }
  const raw = input as AthenaEmailDefaults;
  const from = trimOptional(raw.from);
  const fromName = trimOptional(raw.fromName);
  const replyTo = trimOptional(raw.replyTo);
  const locale = trimOptional(raw.locale);
  return {
    ...(from ? { from } : {}),
    ...(fromName ? { fromName } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(locale ? { locale } : {}),
  };
}

function normalizeFailureMode(value: unknown): AthenaEmailAttachmentFailureMode {
  return value === "skip" ? "skip" : "fail";
}

function normalizeProvider(value: unknown): AthenaEmailProvider | null {
  if (value == null) {
    return null;
  }
  if (isAthenaEmailProvider(value)) {
    return {
      ...(value.capabilities ? { capabilities: value.capabilities } : {}),
      id: value.id.trim(),
      send: (message) => value.send(message),
    };
  }
  if (
    typeof value === "object" &&
    typeof (value as { send?: unknown }).send === "function"
  ) {
    const loose = value as AthenaEmailProvider;
    return {
      ...(loose.capabilities ? { capabilities: loose.capabilities } : {}),
      id: "custom",
      send: (message) => loose.send(message),
    };
  }
  return null;
}

/**
 * Normalize `createClient({ email })`. Missing or empty config is valid and
 * yields an unconfigured module — construction still succeeds.
 */
export function normalizeAthenaEmailConfig(
  input?: AthenaEmailConfig | null
): NormalizedAthenaEmailConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      attachmentFailureMode: "fail",
      defaults: { ...EMPTY_DEFAULTS },
      provider: null,
    };
  }
  return {
    attachmentFailureMode: normalizeFailureMode(input.attachments?.failureMode),
    defaults: normalizeDefaults(input.defaults),
    provider: normalizeProvider(input.provider),
  };
}

export function toAthenaEmailDiagnostics(
  normalized: NormalizedAthenaEmailConfig
): AthenaEmailDiagnostics {
  return {
    attachmentFailureMode: normalized.attachmentFailureMode,
    configured: normalized.provider !== null,
    defaults: { ...normalized.defaults },
    providerDelivery: normalized.provider?.capabilities?.delivery ?? null,
    providerId: normalized.provider?.id ?? null,
    providerRuntimes: normalized.provider?.capabilities?.runtimes ?? null,
  };
}
