import { AthenaBillingCapabilityError } from "../../../errors.ts";
import type { BillingPage } from "../../types.ts";

export type AthenaCatalogListResource = "products" | "prices" | "relations";

interface AthenaCatalogCursor {
  offset: number;
  provider: "athena";
  resource: AthenaCatalogListResource;
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
  const base64 = value.replaceAll("-", "+").replaceAll("/", "_");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function decodeCatalogCursor(
  cursor: string,
  resource: AthenaCatalogListResource
): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeBase64Url(cursor));
  } catch {
    throw new AthenaBillingCapabilityError({
      operation: `${resource}.list`,
      reason: "unsupported_operation",
    });
  }
  if (
    !isRecord(parsed) ||
    parsed.provider !== "athena" ||
    parsed.resource !== resource ||
    typeof parsed.offset !== "number" ||
    !Number.isInteger(parsed.offset) ||
    parsed.offset < 0
  ) {
    throw new AthenaBillingCapabilityError({
      operation: `${resource}.list`,
      reason: "unsupported_operation",
    });
  }
  return parsed.offset;
}

export function pageAthenaCatalogItems<T>(
  items: readonly T[],
  input: { cursor?: string; limit?: number },
  resource: AthenaCatalogListResource
): BillingPage<T> {
  const start =
    input.cursor != null && input.cursor.length > 0
      ? decodeCatalogCursor(input.cursor, resource)
      : 0;
  const limit =
    input.limit != null && Number.isInteger(input.limit) && input.limit > 0
      ? input.limit
      : 50;
  const slice = items.slice(start, start + limit);
  const nextOffset = start + slice.length;
  if (nextOffset >= items.length) {
    return { items: [...slice], nextCursor: null };
  }
  const cursor: AthenaCatalogCursor = {
    offset: nextOffset,
    provider: "athena",
    resource,
  };
  return {
    items: [...slice],
    nextCursor: encodeBase64Url(JSON.stringify(cursor)),
  };
}
