import type { NormalizedAthenaAuthorizationServerConfig } from "../config.ts";
import type { AthenaAuthProtocolIdentity } from "../protocol-identity.ts";
import type { AthenaOidcProviderMetadata } from "../types/catalog.ts";

export function buildAuthorizationServerMetadata(input: {
  config: NormalizedAthenaAuthorizationServerConfig;
  identity: AthenaAuthProtocolIdentity;
}): Record<string, unknown> {
  const scopes = supportedScopes(input.config);
  return {
    authorization_endpoint: input.identity.authorizationEndpoint,
    authorization_response_iss_parameter_supported: true,
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: [
      "authorization_code" as const,
      ...(input.config.issueRefreshTokens ? (["refresh_token"] as const) : []),
    ],
    issuer: input.identity.issuer,
    jwks_uri: input.identity.jwksUri,
    response_types_supported: ["code"],
    revocation_endpoint: input.identity.revocationEndpoint,
    scopes_supported: scopes,
    token_endpoint: input.identity.tokenEndpoint,
    token_endpoint_auth_methods_supported: ["none"],
  };
}

export function buildOpenIdProviderMetadata(input: {
  config: NormalizedAthenaAuthorizationServerConfig;
  identity: AthenaAuthProtocolIdentity;
}): AthenaOidcProviderMetadata {
  return {
    authorization_endpoint: input.identity.authorizationEndpoint,
    claims_supported: [
      "amr",
      "auth_time",
      "email",
      "email_verified",
      "name",
      "picture",
      "preferred_username",
      "sub",
    ],
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: [
      "authorization_code" as const,
      ...(input.config.issueRefreshTokens ? (["refresh_token"] as const) : []),
    ],
    id_token_signing_alg_values_supported: ["RS256"],
    issuer: input.identity.issuer,
    jwks_uri: input.identity.jwksUri,
    prompt_values_supported: ["none", "login", "consent"],
    request_uri_parameter_supported: false,
    response_types_supported: ["code"],
    scopes_supported: supportedScopes(input.config),
    subject_types_supported: ["public"],
    token_endpoint: input.identity.tokenEndpoint,
    token_endpoint_auth_methods_supported: ["none"],
    userinfo_endpoint: input.identity.userInfoEndpoint,
  };
}

function supportedScopes(
  config: NormalizedAthenaAuthorizationServerConfig
): string[] {
  return [
    ...new Set([
      "email",
      "openid",
      "profile",
      ...Object.values(config.resources).flatMap((resource) =>
        Object.keys(resource.scopes)
      ),
    ]),
  ].sort();
}
