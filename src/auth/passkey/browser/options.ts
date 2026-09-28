import type { AthenaPasskeyOptionsResponse } from "../../types.ts";

/** Internal adapter input: public wire DTO plus optional extra JSON `rpId`. */
export type PasskeyBrowserOptionsInput = AthenaPasskeyOptionsResponse & {
  hints?: string[];
  rpId?: string;
};

export interface PasskeyBrowserRpIdFallback {
  rpId?: string;
}

type RecordLike = Record<string, unknown>;

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordLike)
    : null;
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function decodeBufferSource(value: unknown): ArrayBuffer {
  if (typeof value !== "string" || !value.trim()) {
    return new ArrayBuffer(0);
  }
  try {
    return toExactArrayBuffer(fromBase64Url(value));
  } catch {
    return toExactArrayBuffer(new TextEncoder().encode(value));
  }
}

function trimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Server RP ID precedence (PASSKEY-I5): options.rpId → options.rp.id → explicit fallback.
 * Never invent `window.location.hostname` as an RP ID.
 */
export function resolvePasskeyRpId(
  options: PasskeyBrowserOptionsInput | RecordLike,
  fallback?: PasskeyBrowserRpIdFallback
): string | undefined {
  const topLevel = trimmedString(options.rpId);
  if (topLevel) {
    return topLevel;
  }
  const rp = asRecord(options.rp);
  const fromRp = trimmedString(rp?.id);
  if (fromRp) {
    return fromRp;
  }
  return trimmedString(fallback?.rpId);
}

function fallbackRpDisplayName(): string {
  if (
    typeof globalThis !== "undefined" &&
    "window" in globalThis &&
    globalThis.window &&
    typeof globalThis.window.location?.hostname === "string" &&
    globalThis.window.location.hostname
  ) {
    return globalThis.window.location.hostname;
  }
  return "Athena Auth";
}

function mapDescriptors(
  value: unknown
): PublicKeyCredentialDescriptor[] | undefined {
  if (!Array.isArray(value)) {
    return;
  }
  return value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is RecordLike => !!entry)
    .map((entry) => ({
      ...entry,
      id: decodeBufferSource(entry.id),
      type:
        typeof entry.type === "string"
          ? (entry.type as PublicKeyCredentialType)
          : "public-key",
    })) as PublicKeyCredentialDescriptor[];
}

export function toPublicKeyCredentialCreationOptions(
  options: PasskeyBrowserOptionsInput | RecordLike,
  fallback?: PasskeyBrowserRpIdFallback
): PublicKeyCredentialCreationOptions {
  const user = asRecord(options.user);
  const rpSource = asRecord(options.rp);
  const userId = decodeBufferSource(user?.id);
  const challenge = decodeBufferSource(options.challenge);
  const rpId = resolvePasskeyRpId(options, fallback);

  const mapped: PublicKeyCredentialCreationOptions & { hints?: string[] } = {
    attestation:
      typeof options.attestation === "string"
        ? (options.attestation as AttestationConveyancePreference)
        : undefined,
    authenticatorSelection: asRecord(options.authenticatorSelection) as
      | AuthenticatorSelectionCriteria
      | undefined,
    challenge,
    excludeCredentials: mapDescriptors(options.excludeCredentials),
    extensions: asRecord(options.extensions) as
      | AuthenticationExtensionsClientInputs
      | undefined,
    pubKeyCredParams: Array.isArray(options.pubKeyCredParams)
      ? (options.pubKeyCredParams as PublicKeyCredentialParameters[])
      : [],
    rp: {
      id: rpId,
      name: trimmedString(rpSource?.name) ?? fallbackRpDisplayName(),
    },
    timeout: typeof options.timeout === "number" ? options.timeout : undefined,
    user: {
      displayName:
        trimmedString(user?.displayName) ?? trimmedString(user?.name) ?? "User",
      id: userId,
      name: trimmedString(user?.name) ?? "user",
    },
  };
  const hints = Array.isArray(options.hints)
    ? options.hints.filter(
        (entry): entry is string => typeof entry === "string"
      )
    : undefined;
  if (hints && hints.length > 0) {
    mapped.hints = hints;
  }
  return mapped;
}

export function toPublicKeyCredentialRequestOptions(
  options: PasskeyBrowserOptionsInput | RecordLike,
  fallback?: PasskeyBrowserRpIdFallback
): PublicKeyCredentialRequestOptions {
  return {
    allowCredentials: mapDescriptors(options.allowCredentials),
    challenge: decodeBufferSource(options.challenge),
    extensions: asRecord(options.extensions) as
      | AuthenticationExtensionsClientInputs
      | undefined,
    rpId: resolvePasskeyRpId(options, fallback),
    timeout: typeof options.timeout === "number" ? options.timeout : undefined,
    userVerification:
      typeof options.userVerification === "string"
        ? (options.userVerification as UserVerificationRequirement)
        : undefined,
  };
}
