import { serializePasskeyTransports } from "./transports.ts";

/** WebAuthn authenticator-data backup-eligible (BE) flag. */
export const AUTHDATA_BE = 0x08;
/** WebAuthn authenticator-data backup-state (BS) flag. */
export const AUTHDATA_BS = 0x10;

export type PasskeyAuthenticatorDeviceType = "multiDevice" | "singleDevice";

export interface MapPasskeyAuthenticatorMetadataInput {
  flags: number;
  transports?: readonly string[] | null;
}

export interface MappedPasskeyAuthenticatorMetadata {
  backedUp: boolean;
  deviceType: PasskeyAuthenticatorDeviceType;
  transports: string | null;
}

export function normalizePasskeyDeviceType(
  value: unknown
): PasskeyAuthenticatorDeviceType {
  return value === "multiDevice" ? "multiDevice" : "singleDevice";
}

export function normalizeCredentialCounter(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "bigint" && value >= 0n) {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : 0;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }
  return 0;
}

/**
 * Persist mapping shared with Rust `PasskeyStoreAdapter::create_passkey`.
 * BE (0x08) → deviceType; BS (0x10) → backedUp; empty transports → NULL.
 * multiDevice is not the same flag as backedUp.
 */
export function mapPasskeyAuthenticatorMetadata(
  input: MapPasskeyAuthenticatorMetadataInput
): MappedPasskeyAuthenticatorMetadata {
  const backupEligible = (input.flags & AUTHDATA_BE) !== 0;
  const backupState = (input.flags & AUTHDATA_BS) !== 0;

  return {
    backedUp: backupState,
    deviceType: backupEligible ? "multiDevice" : "singleDevice",
    transports: serializePasskeyTransports(input.transports),
  };
}

export {
  parseStoredPasskeyTransports,
  serializePasskeyTransports,
} from "./transports.ts";
