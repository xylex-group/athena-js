/**
 * Same-origin helpers. Compare `URL.origin` only — never startsWith/substring.
 */

export function parseWebOrigin(
  value: string | null | undefined
): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null") {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function requestOrigin(request: Request): string | null {
  return parseWebOrigin(new URL(request.url).origin);
}

export function headerOrigin(request: Request): string | null {
  return parseWebOrigin(request.headers.get("origin"));
}

export function originsMatch(
  left: string | null,
  right: string | null
): boolean {
  return left != null && right != null && left === right;
}

export type AllowedRequestOriginOptions = {
  /**
   * Same-origin GET/HEAD often omit `Origin`. Cross-origin CORS GET still
   * sends `Origin`. Do not enable this on mutating Data/Billing POST.
   */
  allowMissingOriginOnSafeMethods?: boolean;
};

export function isAllowedRequestOrigin(
  request: Request,
  extraAllowed: readonly string[] = [],
  options?: AllowedRequestOriginOptions
): boolean {
  const incoming = headerOrigin(request);
  const target = requestOrigin(request);
  if (incoming) {
    if (originsMatch(incoming, target)) {
      return true;
    }
    return extraAllowed.some((candidate) =>
      originsMatch(incoming, parseWebOrigin(candidate))
    );
  }
  if (!options?.allowMissingOriginOnSafeMethods) {
    return false;
  }
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return false;
  }
  const referer = parseWebOrigin(request.headers.get("referer"));
  if (referer) {
    if (originsMatch(referer, target)) {
      return true;
    }
    return extraAllowed.some((candidate) =>
      originsMatch(referer, parseWebOrigin(candidate))
    );
  }
  return true;
}
