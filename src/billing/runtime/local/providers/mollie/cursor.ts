import { createMollieProviderRequestError } from "./errors.ts";

export type MollieListResource =
	| "customers"
	| "invoices"
	| "payment-links"
	| "payments"
	| "refunds"
	| "subscriptions";

export interface MollieListCursor {
	from: string;
	provider: "mollie";
	resource: MollieListResource;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

function encodeBase64Url(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/u, "");
}

function decodeBase64Url(value: string): string {
	if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
		throw new TypeError("Invalid base64url value.");
	}
	const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
	const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
	const binary = atob(padded);
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function encodeMollieListCursor(cursor: MollieListCursor): string {
	return encodeBase64Url(JSON.stringify(cursor));
}

export function decodeMollieListCursor(
	cursor: string,
	resource: MollieListResource,
): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(decodeBase64Url(cursor));
	} catch {
		throw createMollieProviderRequestError({
			fallbackMessage: "Mollie list cursor is not valid.",
			kind: "serialization",
			operation: `${resource}.list`,
		});
	}
	if (
		!isRecord(parsed) ||
		parsed.provider !== "mollie" ||
		parsed.resource !== resource ||
		typeof parsed.from !== "string" ||
		parsed.from.length === 0
	) {
		throw createMollieProviderRequestError({
			fallbackMessage: "Mollie list cursor is not valid.",
			kind: "serialization",
			operation: `${resource}.list`,
		});
	}
	return parsed.from;
}

export function fromParamFromMollieHref(href: string): string | undefined {
	try {
		const url = new URL(href);
		const from = url.searchParams.get("from");
		return from != null && from.length > 0 ? from : undefined;
	} catch {
		return undefined;
	}
}

function firstRecordField(
	payload: Record<string, unknown>,
	keys: string[],
): Record<string, unknown> | undefined {
	for (const key of keys) {
		const value = payload[key];
		if (isRecord(value)) {
			return value;
		}
	}
	return undefined;
}

export function nextCursorFromMolliePayload(
	payload: unknown,
	resource: MollieListResource,
): string | null {
	if (!isRecord(payload)) {
		return null;
	}
	const links = firstRecordField(payload, ["_links", "links"]);
	if (links == null) {
		return null;
	}
	const next = links.next;
	if (!isRecord(next) || typeof next.href !== "string") {
		return null;
	}
	const from = fromParamFromMollieHref(next.href);
	if (from == null) {
		return null;
	}
	return encodeMollieListCursor({
		from,
		provider: "mollie",
		resource,
	});
}

export function embeddedListItems(
	payload: unknown,
	key: string,
): unknown[] {
	if (!isRecord(payload)) {
		return [];
	}
	const embedded = firstRecordField(payload, ["_embedded", "embedded"]);
	if (embedded == null) {
		return [];
	}
	const items = embedded[key];
	return Array.isArray(items) ? items : [];
}
