/**
 * Canonical AAGUID text: lowercase UUID, or null when absent/unspecified.
 * Never persist a raw WebAuthn Buffer on the public DTO.
 */

const UUID_RE =
	/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;
const HEX_32_RE = /^[\da-f]{32}$/;
const UNSPECIFIED = "00000000-0000-0000-0000-000000000000";

function toHexByte(value: number): string {
	return value.toString(16).padStart(2, "0");
}

function uuidFrom16Bytes(bytes: Uint8Array): string {
	const hex = Array.from(bytes, toHexByte).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function uuidFromHex(hex: string): string {
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Normalize a verified authenticator AAGUID to canonical UUID text.
 * Unspecified all-zero and empty values become null.
 */
export function normalizePasskeyAaguid(value: unknown): string | null {
	if (value == null) {
		return null;
	}
	if (value instanceof Uint8Array) {
		if (value.byteLength !== 16) {
			return null;
		}
		const uuid = uuidFrom16Bytes(value);
		return uuid === UNSPECIFIED ? null : uuid;
	}
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim().toLowerCase();
	if (!trimmed) {
		return null;
	}
	if (UUID_RE.test(trimmed)) {
		return trimmed === UNSPECIFIED ? null : trimmed;
	}
	const hex = trimmed.replaceAll("-", "");
	if (!HEX_32_RE.test(hex)) {
		return null;
	}
	const uuid = uuidFromHex(hex);
	return uuid === UNSPECIFIED ? null : uuid;
}
