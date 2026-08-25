import type { AthenaRightKey } from "./key.ts";

function splitOnce(value: string): [string, string] | undefined {
	const index = value.indexOf(".");
	if (index < 0) {
		return undefined;
	}
	return [value.slice(0, index), value.slice(index + 1)];
}

/**
 * Exact parity with `crates/athena-rights/src/matching.rs` `right_matches`.
 * Adapters must parse before calling; unparsed strings are not accepted.
 */
export function rightMatches(
	granted: AthenaRightKey,
	required: AthenaRightKey,
): boolean {
	if (granted === "*" || granted === required) {
		return true;
	}

	const grantedParts = splitOnce(granted);
	if (grantedParts === undefined) {
		return false;
	}
	const requiredParts = splitOnce(required);
	if (requiredParts === undefined) {
		return false;
	}

	const [grantedResource, grantedAction] = grantedParts;
	const [requiredResource, requiredAction] = requiredParts;

	if (grantedResource === "*" && grantedAction === requiredAction) {
		return true;
	}
	if (grantedResource === requiredResource && grantedAction === "*") {
		return true;
	}
	if (grantedResource === "gateway" && grantedAction === requiredAction) {
		return true;
	}
	if (grantedResource === "gateway" && grantedAction === "*") {
		return true;
	}

	return false;
}

export function missingRequiredRights(
	granted: readonly AthenaRightKey[],
	required: readonly AthenaRightKey[],
): AthenaRightKey[] {
	return required.filter(
		(requiredKey) =>
			!granted.some((grantedKey) => rightMatches(grantedKey, requiredKey)),
	);
}
