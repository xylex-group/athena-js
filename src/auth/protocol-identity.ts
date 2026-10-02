import { AthenaConfigurationError } from "../config/errors.ts";
import type { AthenaAppIdentity } from "./app-identity.ts";
import type { NormalizedAthenaAuthorizationServerConfig } from "./config.ts";

export interface AthenaAuthProtocolIdentity {
  readonly authorizationEndpoint: string;
  readonly issuer: string;
  readonly jwksUri: string;
  readonly oauthMetadataUri: string;
  readonly publicBaseUrl: string;
  readonly revocationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly userInfoEndpoint: string;
}

export interface CreateAthenaAuthProtocolIdentityInput {
  appIdentity: AthenaAppIdentity | null;
  authorizationServer: NormalizedAthenaAuthorizationServerConfig;
  basePath: string;
  environment?: "development" | "production";
}

/** Documented non-production JWT/JWKS issuer when no init-time URL is configured. */
export const ATHENA_AUTH_DEV_DEFAULT_ISSUER = "http://localhost:3000";

export function joinAuthProtocolUrl(base: string, path: string): string {
  const root = base.replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${root}${suffix}`;
}

export function protocolPublicBaseUrl(
  issuer: string,
  basePath: string
): string {
  const path = basePath === "/" ? "" : basePath.replace(/\/$/, "");
  return `${issuer}${path}`;
}

export function assertOriginOnlyIssuer(issuer: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(issuer);
  } catch {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      `${field} must be an absolute HTTP(S) origin`,
      "auth"
    );
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      `${field} must be an absolute HTTP(S) origin without credentials, query, or fragment`,
      "auth"
    );
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      `${field} must be origin-only; pathful issuers are rejected`,
      "auth"
    );
  }
  return parsed.origin;
}

function configuredProtocolIssuer(
  input: CreateAthenaAuthProtocolIdentityInput
): string | null {
  return input.authorizationServer.issuer ?? input.appIdentity?.origin ?? null;
}

/**
 * Init-time issuer sources only: authorizationServer.issuer, then
 * app.url/APP_URL. Never request Host, forwarded host, or callback/trust
 * origin lists. Non-production JWT surfaces may use a documented localhost
 * default when no issuer is configured.
 */
export function resolveAthenaAuthProtocolIssuer(
  input: CreateAthenaAuthProtocolIdentityInput
): string {
  const issuer = configuredProtocolIssuer(input);
  if (issuer) {
    return assertOriginOnlyIssuer(issuer, "auth.authorizationServer.issuer");
  }
  if (input.environment !== "production") {
    return assertOriginOnlyIssuer(
      ATHENA_AUTH_DEV_DEFAULT_ISSUER,
      "auth.authorizationServer.issuer"
    );
  }
  throw new AthenaConfigurationError(
    "ATHENA_RUNTIME_CONFIG_INVALID",
    "Athena Auth protocol identity requires authorizationServer.issuer or app.url/APP_URL",
    "auth"
  );
}

export function createAthenaAuthProtocolIdentity(
  input: CreateAthenaAuthProtocolIdentityInput
): AthenaAuthProtocolIdentity {
  const origin = resolveAthenaAuthProtocolIssuer(input);
  const publicBaseUrl = protocolPublicBaseUrl(origin, input.basePath);
  return Object.freeze({
    authorizationEndpoint:
      input.authorizationServer.authorizationEndpoint ??
      joinAuthProtocolUrl(publicBaseUrl, "/oauth/authorize"),
    issuer: origin,
    jwksUri: joinAuthProtocolUrl(publicBaseUrl, "/.well-known/jwks.json"),
    oauthMetadataUri: joinAuthProtocolUrl(
      publicBaseUrl,
      "/.well-known/oauth-authorization-server"
    ),
    publicBaseUrl,
    revocationEndpoint: joinAuthProtocolUrl(publicBaseUrl, "/oauth/revoke"),
    tokenEndpoint: joinAuthProtocolUrl(publicBaseUrl, "/oauth/token"),
    userInfoEndpoint: joinAuthProtocolUrl(publicBaseUrl, "/userinfo"),
  });
}

export function tryCreateAthenaAuthProtocolIdentity(
  input: CreateAthenaAuthProtocolIdentityInput
): AthenaAuthProtocolIdentity | null {
  if (!configuredProtocolIssuer(input)) {
    return null;
  }
  return createAthenaAuthProtocolIdentity(input);
}
