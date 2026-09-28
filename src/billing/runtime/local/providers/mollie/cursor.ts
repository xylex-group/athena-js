import { createMollieProviderRequestError } from "./errors.ts";
import { mollieLinkHref } from "./projection/links.ts";

export type MollieListResource =
  | "customers"
  | "invoices"
  | "payment-links"
  | "payments"
  | "refunds"
  | "subscriptions"
  | "webhooks";

export interface MollieListCursor {
  from: string;
  provider: "mollie";
  resource: MollieListResource;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/[=]+$/u, "");
}

function decodeBase64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new TypeError("Invalid base64url value.");
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function encodeMollieListCursor(cursor: MollieListCursor): string {
  return encodeBase64Url(JSON.stringify(cursor));
}

export function decodeMollieListCursor(
  cursor: string,
  resource: MollieListResource
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeBase64Url(cursor));
  } catch {
    throw createMollieProviderRequestError({
      fallbackMessage: "Mollie list cursor is not valid.",
      kind: "serialization",
      operation: `${resource}.list`,
    });
  }
  if (
    !isRecord(parsed) ||
    parsed.provider !== "mollie" ||
    parsed.resource !== resource ||
    typeof parsed.from !== "string" ||
    parsed.from.length === 0
  ) {
    throw createMollieProviderRequestError({
      fallbackMessage: "Mollie list cursor is not valid.",
      kind: "serialization",
      operation: `${resource}.list`,
    });
  }
  return parsed.from;
}

export function fromParamFromMollieHref(
  href: string,
  input: {
    apiBaseUrl: string;
    resource: MollieListResource;
  }
): string | undefined {
  let url: URL;
  let base: URL;
  try {
    url = new URL(href);
    base = new URL(input.apiBaseUrl);
  } catch {
    return undefined;
  }
  if (url.origin !== base.origin) {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return undefined;
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    return undefined;
  }
  if (!mollieContinuationPathAllowed(url.pathname, input.resource)) {
    return undefined;
  }
  const from = url.searchParams.get("from");
  return from != null && from.length > 0 ? from : undefined;
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function mollieContinuationPathAllowed(
  pathname: string,
  resource: MollieListResource
): boolean {
  if (resource === "subscriptions") {
    return (
      pathname === "/v2/subscriptions" ||
      /^\/v2\/customers\/[^/]+\/subscriptions$/u.test(pathname)
    );
  }
  const prefixes = mollieListPathPrefixes(resource);
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function mollieListPathPrefixes(
  resource: MollieListResource
): readonly string[] {
  switch (resource) {
    case "customers":
      return ["/v2/customers"];
    case "invoices":
      return ["/v2/invoices", "/v2/sales-invoices"];
    case "payment-links":
      return ["/v2/payment-links"];
    case "payments":
      return ["/v2/payments"];
    case "refunds":
      return ["/v2/refunds", "/v2/payments"];
    case "subscriptions":
      return [];
    case "webhooks":
      return ["/v2/webhooks"];
    default: {
      const exhaustive: never = resource;
      return exhaustive;
    }
  }
}

function firstRecordField(
  payload: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (isRecord(value)) {
      return value;
    }
  }
}

export function nextCursorFromMolliePayload(
  payload: unknown,
  resource: MollieListResource,
  apiBaseUrl: string
): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  const href = mollieLinkHref(payload, "next");
  if (href == null) {
    return null;
  }
  const from = fromParamFromMollieHref(href, { apiBaseUrl, resource });
  if (from == null) {
    return null;
  }
  return encodeMollieListCursor({
    from,
    provider: "mollie",
    resource,
  });
}

export function embeddedListItems(payload: unknown, key: string): unknown[] {
  if (!isRecord(payload)) {
    return [];
  }
  const embedded = firstRecordField(payload, ["_embedded", "embedded"]);
  if (embedded == null) {
    return [];
  }
  const items = embedded[key];
  return Array.isArray(items) ? items : [];
}
