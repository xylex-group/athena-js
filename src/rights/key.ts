import {
	AthenaRightKeyError,
	type AthenaRightKeyErrorCode,
} from "./errors.ts";

declare const athenaRightKeyBrand: unique symbol;

/** Branded Right identity. Runtime value is a normal string. */
export type AthenaRightKey = string & {
	readonly [athenaRightKeyBrand]: true;
};

function brandAthenaRightKey(canonical: string): AthenaRightKey {
	return canonical as AthenaRightKey;
}

function isAsciiAlphanumeric(ch: string): boolean {
	const code = ch.charCodeAt(0);
	return (
		(code >= 48 && code <= 57) ||
		(code >= 65 && code <= 90) ||
		(code >= 97 && code <= 122)
	);
}

function isIdentifierChar(ch: string): boolean {
	return isAsciiAlphanumeric(ch) || ch === "_";
}

/** Unicode White_Space — same set as Rust `char::is_whitespace` / `str::trim`. */
function isRustWhiteSpace(ch: string): boolean {
	const code = ch.codePointAt(0);
	if (code === undefined) {
		return false;
	}
	return (
		(code >= 0x09 && code <= 0x0d) ||
		code === 0x20 ||
		code === 0x85 ||
		code === 0xa0 ||
		code === 0x1680 ||
		(code >= 0x2000 && code <= 0x200a) ||
		code === 0x2028 ||
		code === 0x2029 ||
		code === 0x202f ||
		code === 0x205f ||
		code === 0x3000
	);
}

function trimRustWhiteSpace(raw: string): string {
	let start = 0;
	let end = raw.length;
	while (start < end) {
		const head = raw[start];
		if (head === undefined || !isRustWhiteSpace(head)) {
			break;
		}
		start += 1;
	}
	while (end > start) {
		const tail = raw[end - 1];
		if (tail === undefined || !isRustWhiteSpace(tail)) {
			break;
		}
		end -= 1;
	}
	return raw.slice(start, end);
}

function throwKeyError(
	code: AthenaRightKeyErrorCode,
	message: string,
	key?: string,
): never {
	throw new AthenaRightKeyError(code, message, key);
}

function validateSegment(segment: string, key: string): void {
	if (segment.length === 0) {
		throwKeyError(
			"RIGHT_KEY_EMPTY_SEGMENT",
			`right key \`${key}\` has an empty segment`,
			key,
		);
	}
	if (segment === "*") {
		return;
	}
	if (segment.startsWith("{") && segment.endsWith("}")) {
		const inner = segment.slice(1, -1);
		if (inner.length === 0 || ![...inner].every(isIdentifierChar)) {
			throwKeyError(
				"RIGHT_KEY_MALFORMED_PATTERN",
				`right key \`${key}\` is a malformed pattern`,
				key,
			);
		}
		return;
	}
	const first = segment[0];
	if (first === undefined) {
		throwKeyError(
			"RIGHT_KEY_EMPTY_SEGMENT",
			`right key \`${key}\` has an empty segment`,
			key,
		);
	}
	if (!(isAsciiAlphanumeric(first) || first === "_")) {
		throwKeyError(
			"RIGHT_KEY_INVALID_CHARACTERS",
			`right key \`${key}\` contains invalid characters`,
			key,
		);
	}
	const rest = segment.slice(1);
	if (
		![...rest].every(
			(ch) => isAsciiAlphanumeric(ch) || ch === "_" || ch === "-",
		)
	) {
		throwKeyError(
			"RIGHT_KEY_INVALID_CHARACTERS",
			`right key \`${key}\` contains invalid characters`,
			key,
		);
	}
}

/**
 * Parse and canonicalize a right key. Trims edges; rejects interior whitespace.
 * Exact parity with `crates/athena-rights/src/key.rs`.
 */
export function parseAthenaRightKey(raw: string): AthenaRightKey {
	const trimmed = trimRustWhiteSpace(raw);
	if (trimmed.length === 0) {
		throwKeyError("RIGHT_KEY_EMPTY", "right key must not be empty");
	}
	if ([...trimmed].some(isRustWhiteSpace)) {
		throwKeyError(
			"RIGHT_KEY_INVALID_CHARACTERS",
			`right key \`${trimmed}\` contains invalid characters`,
			trimmed,
		);
	}
	if (
		trimmed.startsWith(".") ||
		trimmed.endsWith(".") ||
		trimmed.includes("..")
	) {
		throwKeyError(
			"RIGHT_KEY_EMPTY_SEGMENT",
			`right key \`${trimmed}\` has an empty segment`,
			trimmed,
		);
	}
	for (const segment of trimmed.split(".")) {
		validateSegment(segment, trimmed);
	}
	return brandAthenaRightKey(trimmed);
}

export function tryParseAthenaRightKey(raw: string): AthenaRightKey | undefined {
	try {
		return parseAthenaRightKey(raw);
	} catch (error) {
		if (error instanceof AthenaRightKeyError) {
			return undefined;
		}
		throw error;
	}
}

export function athenaRightKeyString(key: AthenaRightKey): string {
	return key;
}
