import { lookupAuthenticatorMetadata } from "./catalog.ts";
import type {
  AthenaPasskeyDisplayName,
  AthenaPasskeyDisplayNameInput,
} from "./types.ts";

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUuidLike(value: string): boolean {
  return /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
    value.trim()
  );
}

function looksLikeCredentialId(value: string): boolean {
  const trimmed = value.trim();
  if (isUuidLike(trimmed) && trimmed.length === 36) {
    return true;
  }
  return trimmed.length >= 24 && /^[A-Za-z0-9_-]+$/.test(trimmed);
}

function discoverabilityFromResidentKey(
  residentKey: boolean | null | undefined
): AthenaPasskeyDisplayName["discoverability"] {
  if (residentKey === true) {
    return "discoverable";
  }
  if (residentKey === false) {
    return "non-discoverable";
  }
  return "unknown";
}

function platformOrSecurityKey(input: AthenaPasskeyDisplayNameInput): string {
  const transports = input.transports ?? [];
  const hasInternal = transports.includes("internal");
  const hasHybrid = transports.includes("hybrid");
  const hasUsb =
    transports.includes("usb") ||
    transports.includes("nfc") ||
    transports.includes("ble");
  if (hasInternal && !hasUsb) {
    return "Platform passkey";
  }
  if (hasUsb && !hasInternal) {
    return "Security key";
  }
  if (hasHybrid) {
    return "Synced passkey";
  }
  if (input.deviceType === "multiDevice" || input.backedUp) {
    return "Synced passkey";
  }
  return "Passkey";
}

/**
 * Resolve a user-facing passkey title.
 *
 * Order: explicit user name (when it is not a credential/AAGUID/UUID) →
 * known AAGUID friendly name → platform/security-key class → "Passkey".
 * Never returns a credential ID, AAGUID, or database id.
 */
export function resolvePasskeyAuthenticatorDisplay(
  input: AthenaPasskeyDisplayNameInput
): AthenaPasskeyDisplayName {
  const known = lookupAuthenticatorMetadata(input.aaguid ?? null);
  const discoverability = discoverabilityFromResidentKey(input.residentKey);
  if (hasText(input.name) && !looksLikeCredentialId(input.name)) {
    return {
      discoverability,
      displayName: input.name.trim(),
      model: known?.model,
      vendor: known?.vendor,
    };
  }
  if (known?.displayName) {
    return {
      discoverability,
      displayName: known.displayName,
      model: known.model,
      vendor: known.vendor,
    };
  }
  const className = platformOrSecurityKey(input);
  return {
    discoverability,
    displayName: className,
    model: known?.model,
    vendor: known?.vendor,
  };
}
