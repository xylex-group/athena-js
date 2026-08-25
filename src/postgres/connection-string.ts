/**
 * Postgres URI helpers for Node `pg` / pg-connection-string.
 *
 * pg-connection-string v2 treats sslmode `prefer` / `require` / `verify-ca` as
 * `verify-full` and emits a SECURITY WARNING unless the mode is already
 * `verify-full` or `uselibpqcompat=true` is set. Duplicate query keys also
 * re-trigger the warning. Collapse keys and pin `verify-full` once before
 * opening a pool.
 */

const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

const LIBPQ_COMPAT_SSLMODES = new Set(["prefer", "require", "verify-ca"]);

function isLoopbackHost(hostname: string): boolean {
	const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
	return (
		host === "localhost" ||
		host === "127.0.0.1" ||
		host === "::1" ||
		host === "0.0.0.0"
	);
}

function collapseSearchParams(params: URLSearchParams): URLSearchParams {
	const merged = new URLSearchParams();
	for (const [key, value] of params.entries()) {
		merged.set(key, value);
	}
	return merged;
}

function rewritePostgresUrl(url: URL): void {
	const merged = collapseSearchParams(url.searchParams);
	const sslmode = (merged.get("sslmode") ?? "").trim().toLowerCase();
	const optedIntoLibpq =
		(merged.get("uselibpqcompat") ?? "").trim().toLowerCase() === "true";

	if (!sslmode && !isLoopbackHost(url.hostname)) {
		merged.set("sslmode", "verify-full");
	} else if (LIBPQ_COMPAT_SSLMODES.has(sslmode) && !optedIntoLibpq) {
		// pg v2 treats prefer/require/verify-ca as verify-full and warns.
		// Pin verify-full (current secure behavior) instead of uselibpqcompat,
		// which would switch `require` to libpq's weaker no-verify semantics.
		merged.set("sslmode", "verify-full");
	}

	url.search = merged.toString();
}

/**
 * Deduplicate connection-string query params and pin remote TLS to
 * `sslmode=verify-full` so `pg` does not warn that `prefer` / `require` /
 * `verify-ca` are aliases of `verify-full`. Explicit `uselibpqcompat=true`
 * is left alone for callers that opted into libpq `require`.
 */
export function withPostgresLibpqCompatConnectionString(
	connectionString: string,
): string {
	const trimmed = connectionString.trim();
	if (trimmed.length === 0) {
		return connectionString;
	}

	try {
		const usesPostgresql = /^postgresql:/i.test(trimmed);
		const normalized = trimmed.replace(/^postgresql:/i, "postgres:");
		const url = new URL(normalized);
		if (!POSTGRES_PROTOCOLS.has(url.protocol)) {
			return connectionString;
		}

		rewritePostgresUrl(url);
		const rewritten = url.toString();
		return usesPostgresql
			? rewritten.replace(/^postgres:/i, "postgresql:")
			: rewritten;
	} catch {
		return connectionString;
	}
}
