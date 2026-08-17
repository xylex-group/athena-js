/**
 * Same-origin helpers. Compare `URL.origin` only — never startsWith/substring.
 */

export function parseWebOrigin(value: string | null | undefined): string | null {
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

export function originsMatch(left: string | null, right: string | null): boolean {
  return left != null && right != null && left === right;
}

export function isAllowedRequestOrigin(
  request: Request,
  extraAllowed: readonly string[] = []
): boolean {
  const incoming = headerOrigin(request);
  if (!incoming) {
    return false;
  }
  if (originsMatch(incoming, requestOrigin(request))) {
    return true;
  }
  return extraAllowed.some((candidate) =>
    originsMatch(incoming, parseWebOrigin(candidate))
  );
}
