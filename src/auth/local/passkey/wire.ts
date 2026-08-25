import { decodeClientDataJSON, isoBase64URL } from "@simplewebauthn/server/helpers";

import { AthenaAuthRuntimeError } from "../errors.ts";

export function asPasskeyRecord(
	value: unknown,
): Record<string, unknown> | undefined {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return undefined;
}

function parseJsonValue(value: unknown, label: string): unknown {
	if (typeof value !== "string") {
		return value;
	}
	try {
		return JSON.parse(value) as unknown;
	} catch {
		throw AthenaAuthRuntimeError.badRequest(`Invalid ${label}`);
	}
}

/** Rust `normalize_webauthn_response_payload`: string JSON + unwrap nested `response` until `id`. */
export function normalizeWebAuthnResponsePayload(
	raw: unknown,
	label: string,
): Record<string, unknown> {
	let payload: unknown = parseJsonValue(raw, label);
	for (let index = 0; index < 3; index++) {
		const object = asPasskeyRecord(payload);
		if (!object) {
			throw AthenaAuthRuntimeError.badRequest(`Invalid ${label}`);
		}
		if (typeof object.id === "string" && object.id.length > 0) {
			return object;
		}
		if (!("response" in object)) {
			throw AthenaAuthRuntimeError.badRequest(`Invalid ${label}`);
		}
		payload = parseJsonValue(object.response, label);
	}
	throw AthenaAuthRuntimeError.badRequest(`Invalid ${label}`);
}

function toArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy;
}

export async function challengeHashFromClientData(
	clientDataJSON: string,
): Promise<{ challenge: string; challengeHash: Uint8Array }> {
	let challenge: string;
	try {
		const clientData = decodeClientDataJSON(clientDataJSON);
		if (typeof clientData.challenge !== "string" || !clientData.challenge) {
			throw new Error("missing challenge");
		}
		challenge = clientData.challenge;
	} catch {
		throw AthenaAuthRuntimeError.badRequest("Invalid clientDataJSON");
	}
	let challengeBytes: Uint8Array;
	try {
		challengeBytes = isoBase64URL.toBuffer(challenge);
	} catch {
		throw AthenaAuthRuntimeError.badRequest("Invalid clientDataJSON");
	}
	return {
		challenge,
		challengeHash: new Uint8Array(
			await crypto.subtle.digest("SHA-256", toArrayBufferBytes(challengeBytes)),
		),
	};
}
