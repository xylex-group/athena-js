import { parseWebOrigin } from "../../../runtime/data/origin.ts";
import { AthenaBillingError } from "../../errors.ts";

export function billingRedirectAllowlistFromAppUrl(
  appUrl?: string | null
): readonly string[] {
  const origin = parseWebOrigin(appUrl ?? undefined);
  return origin ? [origin] : [];
}

function rejectRedirect(field: string): never {
  throw new AthenaBillingError({
    body: { field },
    code: "ATHENA_BILLING_INVALID_REQUEST",
    endpoint: "",
    message: `${field} must be an https (or loopback http) URL on the configured app origin.`,
    method: "POST",
    status: 400,
  });
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isAllowedBillingRedirectProtocol(url: URL): boolean {
  if (url.protocol === "https:") {
    return true;
  }
  return url.protocol === "http:" && isLoopbackHostname(url.hostname);
}

function isSafeAbsolutePath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return false;
  }
  if (/%5c/i.test(path) || /^\/{2,}/.test(path)) {
    return false;
  }
  return true;
}

function parseAbsoluteHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.username !== "" || url.password !== "") {
      return null;
    }
    if (!isAllowedBillingRedirectProtocol(url)) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

/**
 * Self checkout / enroll redirects must land on the configured app origin
 * (`createClient({ app: { url } })` / `APP_URL`). Relative paths are rewritten
 * onto that origin. Foreign hosts, `javascript:` / `data:`, protocol-relative
 * URLs, non-loopback `http:`, and missing app origin fail closed.
 */
export function resolveAllowedBillingRedirectUrl(input: {
  allowedOrigins: readonly string[];
  field: "successUrl" | "cancelUrl" | "redirectUrl";
  url: string | undefined;
}): string | undefined {
  if (input.url == null || input.url.trim() === "") {
    return;
  }
  const trimmed = input.url.trim();
  const allowed = input.allowedOrigins
    .map((origin) => parseAbsoluteHttpUrl(origin))
    .filter((url): url is URL => url != null)
    .map((url) => url.origin);
  if (allowed.length === 0) {
    rejectRedirect(input.field);
  }
  let parsed: URL | null = null;
  if (isSafeAbsolutePath(trimmed)) {
    const baseOrigin = allowed[0];
    if (baseOrigin === undefined) {
      rejectRedirect(input.field);
    }
    try {
      parsed = new URL(trimmed, `${baseOrigin}/`);
    } catch {
      rejectRedirect(input.field);
    }
    if (parsed.origin !== baseOrigin) {
      rejectRedirect(input.field);
    }
  } else {
    parsed = parseAbsoluteHttpUrl(trimmed);
  }
  if (parsed == null) {
    rejectRedirect(input.field);
  }
  if (parsed.username !== "" || parsed.password !== "") {
    rejectRedirect(input.field);
  }
  if (!isAllowedBillingRedirectProtocol(parsed)) {
    rejectRedirect(input.field);
  }
  if (!allowed.includes(parsed.origin)) {
    rejectRedirect(input.field);
  }
  return parsed.href;
}

/**
 * Self checkout / enroll redirects must be http(s) URLs on an allowlisted origin.
 * Relative URLs are rewritten onto the app origin; foreign hosts fail closed.
 */
export function assertAllowedBillingRedirectUrl(input: {
  allowedOrigins: readonly string[];
  field: "successUrl" | "cancelUrl" | "redirectUrl";
  url: string | undefined;
}): void {
  resolveAllowedBillingRedirectUrl(input);
}
