import { AthenaConfigurationError } from "../config/errors.ts";

export interface OidcDiscoveryDocument {
  authorization_endpoint?: unknown;
  issuer?: unknown;
  jwks_uri?: unknown;
  token_endpoint?: unknown;
  userinfo_endpoint?: unknown;
}

export interface ResolvedOidcProviderMetadata {
  authorizationEndpoint: string;
  issuer: string;
  jwksUri?: string;
  tokenEndpoint: string;
  userinfoEndpoint?: string;
}

export interface OidcDiscoveryOverrides {
  authorizationEndpoint?: string;
  jwksEndpoint?: string;
  tokenEndpoint?: string;
  userInfoEndpoint?: string;
}

export interface ResolveOidcProviderEndpointsInput {
  cache?: Map<string, ResolvedOidcProviderMetadata>;
  fetch?: typeof fetch;
  issuer: string;
  overrides?: OidcDiscoveryOverrides;
}

const defaultCache = new Map<string, ResolvedOidcProviderMetadata>();

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function assertAbsoluteHttpUrl(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      `OIDC discovery ${field} must be an absolute HTTP(S) URL`,
      "auth"
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      `OIDC discovery ${field} must be an absolute HTTP(S) URL`,
      "auth"
    );
  }
  const loopbackHttp =
    process.env.NODE_ENV !== "production" &&
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !loopbackHttp) {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      `OIDC discovery ${field} must be an absolute HTTP(S) URL`,
      "auth"
    );
  }
  return parsed.toString();
}

export function discoveryDocumentUrl(issuer: string): string {
  return `${trimTrailingSlash(issuer)}/.well-known/openid-configuration`;
}

export async function resolveOidcProviderEndpoints(
  input: ResolveOidcProviderEndpointsInput
): Promise<ResolvedOidcProviderMetadata> {
  const configuredIssuer = input.issuer.trim();
  const overrides = input.overrides ?? {};
  assertAbsoluteHttpUrl(configuredIssuer, "issuer");
  if (
    overrides.authorizationEndpoint?.trim() &&
    overrides.tokenEndpoint?.trim()
  ) {
    return {
      authorizationEndpoint: assertAbsoluteHttpUrl(
        overrides.authorizationEndpoint,
        "authorization_endpoint"
      ),
      issuer: configuredIssuer,
      ...(overrides.jwksEndpoint?.trim()
        ? {
            jwksUri: assertAbsoluteHttpUrl(overrides.jwksEndpoint, "jwks_uri"),
          }
        : {}),
      tokenEndpoint: assertAbsoluteHttpUrl(
        overrides.tokenEndpoint,
        "token_endpoint"
      ),
      ...(overrides.userInfoEndpoint?.trim()
        ? {
            userinfoEndpoint: assertAbsoluteHttpUrl(
              overrides.userInfoEndpoint,
              "userinfo_endpoint"
            ),
          }
        : {}),
    };
  }

  const cache = input.cache ?? defaultCache;
  const cached = cache.get(configuredIssuer);
  if (cached) {
    return applyOverrides(cached, overrides);
  }

  const fetchImpl = input.fetch ?? fetch;
  const response = await fetchImpl(discoveryDocumentUrl(configuredIssuer), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      `OIDC discovery failed for issuer ${configuredIssuer}`,
      "auth"
    );
  }
  const document = (await response.json()) as OidcDiscoveryDocument;
  if (
    typeof document.issuer !== "string" ||
    document.issuer !== configuredIssuer
  ) {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      "OIDC discovery issuer must exactly equal the configured issuer",
      "auth"
    );
  }
  const resolved: ResolvedOidcProviderMetadata = {
    authorizationEndpoint: assertAbsoluteHttpUrl(
      document.authorization_endpoint,
      "authorization_endpoint"
    ),
    issuer: configuredIssuer,
    ...(document.jwks_uri
      ? { jwksUri: assertAbsoluteHttpUrl(document.jwks_uri, "jwks_uri") }
      : {}),
    tokenEndpoint: assertAbsoluteHttpUrl(
      document.token_endpoint,
      "token_endpoint"
    ),
    ...(document.userinfo_endpoint
      ? {
          userinfoEndpoint: assertAbsoluteHttpUrl(
            document.userinfo_endpoint,
            "userinfo_endpoint"
          ),
        }
      : {}),
  };
  cache.set(configuredIssuer, resolved);
  return applyOverrides(resolved, overrides);
}

function applyOverrides(
  resolved: ResolvedOidcProviderMetadata,
  overrides: OidcDiscoveryOverrides
): ResolvedOidcProviderMetadata {
  return {
    authorizationEndpoint: overrides.authorizationEndpoint?.trim()
      ? assertAbsoluteHttpUrl(
          overrides.authorizationEndpoint,
          "authorization_endpoint"
        )
      : resolved.authorizationEndpoint,
    issuer: resolved.issuer,
    jwksUri: overrides.jwksEndpoint?.trim()
      ? assertAbsoluteHttpUrl(overrides.jwksEndpoint, "jwks_uri")
      : resolved.jwksUri,
    tokenEndpoint: overrides.tokenEndpoint?.trim()
      ? assertAbsoluteHttpUrl(overrides.tokenEndpoint, "token_endpoint")
      : resolved.tokenEndpoint,
    userinfoEndpoint: overrides.userInfoEndpoint?.trim()
      ? assertAbsoluteHttpUrl(overrides.userInfoEndpoint, "userinfo_endpoint")
      : resolved.userinfoEndpoint,
  };
}

export function resetOidcDiscoveryCache(): void {
  defaultCache.clear();
}
