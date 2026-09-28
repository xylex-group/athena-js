/**
 * Request header / Next.js helpers used by middleware and RSC session loaders.
 * Framework-agnostic (no Next imports).
 */

/**
 * True when Next.js threw because the route used dynamic APIs during static
 * generation (`DYNAMIC_SERVER_USAGE` digest or matching message).
 *
 * Catch and rethrow (or handle) so Next can mark the route dynamic.
 */
export function isDynamicServerUsageError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const err = error as { digest?: unknown; message?: unknown };
  if (err.digest === "DYNAMIC_SERVER_USAGE") {
    return true;
  }

  return (
    typeof err.message === "string" &&
    err.message.includes("Dynamic server usage:")
  );
}

export interface GetOriginFromHeadersOptions {
  /**
   * When `x-forwarded-proto` / scheme is missing, use `http` if true else `https`.
   * Typical: `process.env.NODE_ENV !== "production"`.
   */
  preferHttpWhenMissingProto?: boolean;
}

/**
 * Reconstruct public origin from request headers (Origin, or Host + proto).
 *
 * Prefers `Origin`, then `x-forwarded-host` / `host` with
 * `x-forwarded-proto` (first value when comma-separated).
 */
export function getOriginFromHeaders(
  headersList: {
    get: (name: string) => string | null;
  },
  options: GetOriginFromHeadersOptions = {}
): string | null {
  const origin = headersList.get("origin")?.trim();
  if (origin) {
    return origin;
  }

  const hostRaw =
    headersList.get("x-forwarded-host") ?? headersList.get("host");
  const host = hostRaw?.split(",")[0]?.trim();
  if (!host) {
    return null;
  }

  const protoRaw = headersList.get("x-forwarded-proto");
  const protoFirst = protoRaw?.split(",")[0]?.trim().toLowerCase();
  const proto =
    protoFirst === "http" || protoFirst === "https"
      ? protoFirst
      : options.preferHttpWhenMissingProto
        ? "http"
        : "https";

  return `${proto}://${host}`;
}
