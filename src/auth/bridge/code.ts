import type { ParsedAuthBridgeCode } from "./types.ts";

export const AUTH_BRIDGE_CODE_PREFIX = "ath_brc_";
export const AUTH_BRIDGE_CODE_ENTROPY_BYTES = 32;
export const AUTH_BRIDGE_CODE_HASH_PREFIX = "athena:auth:bridge:v1:";

function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
	const padded = value.replaceAll("-", "+").replaceAll("_", "/");
	const padLength = (4 - (padded.length % 4)) % 4;
	const binary = atob(`${padded}${"=".repeat(padLength)}`);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

function toHex(bytes: Uint8Array): string {
	let hex = "";
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, "0");
	}
	return hex;
}

function isLoopbackHost(hostname: string): boolean {
	const host = hostname.toLowerCase();
	return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

export function generateAuthBridgeCode(): string {
	const bytes = new Uint8Array(AUTH_BRIDGE_CODE_ENTROPY_BYTES);
	crypto.getRandomValues(bytes);
	return `${AUTH_BRIDGE_CODE_PREFIX}${toBase64Url(bytes)}`;
}

export function parseAuthBridgeCode(code: string): ParsedAuthBridgeCode {
	if (!code.startsWith(AUTH_BRIDGE_CODE_PREFIX)) {
		throw new Error("Invalid auth bridge code");
	}
	const payload = code.slice(AUTH_BRIDGE_CODE_PREFIX.length);
	if (!/^[A-Za-z0-9_-]+$/.test(payload)) {
		throw new Error("Invalid auth bridge code");
	}
	const bytes = fromBase64Url(payload);
	if (bytes.byteLength !== AUTH_BRIDGE_CODE_ENTROPY_BYTES) {
		throw new Error("Invalid auth bridge code");
	}
	return {
		bytes,
		entropyBits: bytes.byteLength * 8,
	};
}

export async function hashAuthBridgeCode(code: string): Promise<string> {
	const encoded = new TextEncoder().encode(`${AUTH_BRIDGE_CODE_HASH_PREFIX}${code}`);
	const digest = await crypto.subtle.digest("SHA-256", encoded);
	return toHex(new Uint8Array(digest));
}

export function normalizeAuthBridgeDestinationOrigin(input: string): string {
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		throw new Error("Invalid destination origin");
	}
	if (url.username || url.password) {
		throw new Error("Invalid destination origin");
	}
	if (url.search !== "" || url.hash !== "") {
		throw new Error("Invalid destination origin");
	}
	if (url.pathname !== "/" && url.pathname !== "") {
		throw new Error("Invalid destination origin");
	}
	if (url.protocol === "http:") {
		if (!isLoopbackHost(url.hostname)) {
			throw new Error("Invalid destination origin");
		}
	} else if (url.protocol !== "https:") {
		throw new Error("Invalid destination origin");
	}
	return url.origin;
}

export function normalizeAuthBridgeRedirectPath(input: string): string {
	if (typeof input !== "string" || input.length === 0 || !input.startsWith("/")) {
		throw new Error("Invalid redirect path");
	}
	if (input.startsWith("//") || input.includes("\\") || input.includes("://")) {
		throw new Error("Invalid redirect path");
	}
	if (/%5c/i.test(input) || /javascript:/i.test(input)) {
		throw new Error("Invalid redirect path");
	}
	return input;
}
