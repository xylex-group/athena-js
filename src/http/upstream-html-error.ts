/**
 * Detect Cloudflare / HTML error pages that leak through auth proxies.
 * Auth endpoints must return JSON; HTML here is never a valid session payload.
 */

export const UPSTREAM_UNAVAILABLE_CODE = "UPSTREAM_UNAVAILABLE" as const;

export const UPSTREAM_UNAVAILABLE_MESSAGE =
  "Auth service is temporarily unavailable. Please try again.";

export const UPSTREAM_UNAVAILABLE_HINT =
  "The auth worker returned an HTML error page (often Cloudflare 1101). Retry, then check Workers Logs.";

export function isHtmlErrorPage(body: string, contentType?: string | null): boolean {
  const type = (contentType ?? "").toLowerCase();
  const sample = body.slice(0, 12_000);
  const lower = sample.toLowerCase();

  if (
    lower.includes("worker threw exception") ||
    lower.includes("cf-error-code") ||
    lower.includes("error 1101") ||
    (lower.includes("cloudflare") &&
      (lower.includes("cf-error") || lower.includes("ray id")))
  ) {
    return true;
  }

  if (type.includes("text/html") || type.includes("application/xhtml")) {
    return true;
  }

  const trimmed = sample.trimStart().slice(0, 64).toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
}

export function sanitizeAuthErrorMessage(
  message: string,
  fallback = UPSTREAM_UNAVAILABLE_MESSAGE
): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return fallback;
  }

  if (isHtmlErrorPage(trimmed)) {
    return fallback;
  }

  return trimmed;
}
