/**
 * HTTP request headers are authentication material, not trusted identity.
 *
 * Bearer / Cookie tokens are presented to a trusted session lookup.
 * Organization headers are membership hints. Identity-shaped headers
 * (`x-user-id`, `x-role`, `x-rights`, …) MUST NOT populate AthenaPrincipal.
 */
import {
  readBearerToken,
  readSessionTokenFromCookies,
} from "../../auth/local/cookies.ts";
import type { AthenaRuntimeRequestContext } from "../data/types.ts";

export const NON_AUTHORITATIVE_IDENTITY_HEADERS = Object.freeze([
  "x-athena-user-id",
  "x-grants",
  "x-rights",
  "x-role",
  "x-service",
  "x-user-id",
] as const);

export const ORGANIZATION_HINT_HEADERS = Object.freeze([
  "x-athena-organization",
  "x-organization-id",
] as const);

export function headersFromContext(
  context?: AthenaRuntimeRequestContext
): Headers {
  if (context?.request) {
    return context.request.headers;
  }
  const headers = new Headers();
  if (context?.headers) {
    for (const [name, value] of Object.entries(context.headers)) {
      if (value) {
        headers.set(name, value);
      }
    }
  }
  return headers;
}

export function readOrganizationHint(headers: Headers): string | undefined {
  const hinted =
    headers.get("x-athena-organization") ?? headers.get("x-organization-id");
  const trimmed = hinted?.trim();
  return trimmed ? trimmed : undefined;
}

export function readPresentedSessionToken(
  headers: Headers
): string | undefined {
  return (
    readPresentedBearerToken(headers) ??
    readSessionTokenFromCookies(headers.get("cookie"))
  );
}

export function readPresentedBearerToken(
  headers: Headers
): string | undefined {
  return readBearerToken(headers.get("authorization"));
}
