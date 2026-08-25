export const ATHENA_STORAGE_BYTES_KIND = "athena.storage.bytes" as const;

export type AthenaStorageBytesEncoding = "base64";

export interface AthenaStorageBytesEnvelope {
	bytes: string;
	encoding: AthenaStorageBytesEncoding;
	kind: typeof ATHENA_STORAGE_BYTES_KIND;
}

export function isAthenaStorageBytesEnvelope(
	value: unknown,
): value is AthenaStorageBytesEnvelope {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		record.kind === ATHENA_STORAGE_BYTES_KIND &&
		record.encoding === "base64" &&
		typeof record.bytes === "string"
	);
}

export function encodeAthenaStorageBytes(
	bytes: Uint8Array,
): AthenaStorageBytesEnvelope {
	return {
		bytes: bytesToBase64(bytes),
		encoding: "base64",
		kind: ATHENA_STORAGE_BYTES_KIND,
	};
}

export function decodeAthenaStorageBytes(value: unknown): Uint8Array | undefined {
	if (value instanceof Uint8Array) {
		return value;
	}
	if (value instanceof ArrayBuffer) {
		return new Uint8Array(value);
	}
	if (!isAthenaStorageBytesEnvelope(value)) {
		return undefined;
	}
	return base64ToBytes(value.bytes);
}

export function decodeAthenaStorageRequestBody(
	value: unknown,
): Uint8Array | undefined {
	const decoded = decodeAthenaStorageBytes(value);
	if (decoded) {
		return decoded;
	}
	if (typeof value !== "string" || !value) {
		return undefined;
	}
	return base64ToBytes(value);
}

export function serializeAthenaStorageData(data: unknown): unknown {
	if (data instanceof Uint8Array) {
		return encodeAthenaStorageBytes(data);
	}
	if (data instanceof ArrayBuffer) {
		return encodeAthenaStorageBytes(new Uint8Array(data));
	}
	if (isAthenaStorageBytesEnvelope(data)) {
		return data;
	}
	if (Array.isArray(data)) {
		return data.map(serializeAthenaStorageData);
	}
	if (data && typeof data === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(data as Record<string, unknown>)) {
			out[key] = serializeAthenaStorageData(entry);
		}
		return out;
	}
	return data;
}

export function reviveAthenaStorageData(data: unknown): unknown {
	const bytes = decodeAthenaStorageBytes(data);
	if (bytes) {
		return bytes;
	}
	if (Array.isArray(data)) {
		return data.map(reviveAthenaStorageData);
	}
	if (data && typeof data === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(data as Record<string, unknown>)) {
			out[key] = reviveAthenaStorageData(entry);
		}
		return out;
	}
	return data;
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
	const binary = atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}
