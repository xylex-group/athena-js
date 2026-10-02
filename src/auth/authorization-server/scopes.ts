import { OAuthProtocolError } from "./errors.ts";
import type { OAuthClient, OidcIdentityScope } from "./types.ts";

const SCOPE_PATTERN = /^[\x21-\x7e]+$/;

export const OIDC_IDENTITY_SCOPES = ["openid", "profile", "email"] as const;

const IDENTITY_SCOPE_SET = new Set<string>(OIDC_IDENTITY_SCOPES);

export interface ParsedProtocolScopes {
  identity: OidcIdentityScope[];
  resource: string[];
}

export function isOidcIdentityScope(value: string): value is OidcIdentityScope {
  return IDENTITY_SCOPE_SET.has(value);
}

export function parseProtocolScopes(
  value: string | null | undefined
): ParsedProtocolScopes {
  const scopes = parseScopes(value);
  if (!scopes.includes("openid")) {
    return { identity: [], resource: scopes };
  }
  const identity: OidcIdentityScope[] = [];
  const resource: string[] = [];
  for (const scope of scopes) {
    if (isOidcIdentityScope(scope)) {
      identity.push(scope);
    } else {
      resource.push(scope);
    }
  }
  return { identity, resource };
}

export function parseScopes(value: string | null | undefined): string[] {
  if (value == null || value.trim() === "") {
    return [];
  }
  const scopes = value.trim().split(/\s+/);
  const unique = new Set<string>();
  for (const scope of scopes) {
    if (!SCOPE_PATTERN.test(scope) || scope.includes('"')) {
      throw new OAuthProtocolError(
        "invalid_scope",
        "The requested scope contains an invalid name."
      );
    }
    unique.add(scope);
  }
  return [...unique].sort();
}

export function scopesToString(scopes: readonly string[]): string {
  return [...scopes].sort().join(" ");
}

export function assertClientScopes(
  client: OAuthClient,
  resourceScopes: Readonly<Record<string, unknown>>,
  requestedScopes: readonly string[]
): void {
  for (const scope of requestedScopes) {
    if (
      !(client.scopes.includes(scope) && Object.hasOwn(resourceScopes, scope))
    ) {
      throw new OAuthProtocolError(
        "invalid_scope",
        "The requested scope is not allowed for this client or resource."
      );
    }
  }
}

export function isScopeSubset(
  candidate: readonly string[],
  superset: readonly string[]
): boolean {
  const allowed = new Set(superset);
  return candidate.every((scope) => allowed.has(scope));
}

export function intersectScopes(
  candidate: readonly string[],
  liveGrant: readonly string[]
): string[] {
  const allowed = new Set(liveGrant);
  return [...new Set(candidate.filter((scope) => allowed.has(scope)))].sort();
}
