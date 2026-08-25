import { sha256HexUtf8 } from "../../node-crypto.ts";

/**
 * SHA-256 hex of a caller-owned idempotency key for logs/events.
 * Never log the raw key, API secrets, or tokens.
 */
export function hashBillingIdempotencyKey(key: string): string {
	return sha256HexUtf8(key);
}

export function hashIdempotencyKey(key: string): string {
	return hashBillingIdempotencyKey(key);
}
