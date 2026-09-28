import type { NormalizedAthenaAuthorizationServerConfig } from "../config.ts";
import type { AthenaAuthProtocolIdentity } from "../protocol-identity.ts";

export function buildAuthorizationServerMetadata(input: {
  config: NormalizedAthenaAuthorizationServerConfig;
  identity: AthenaAuthProtocolIdentity;
}): Record<string, unknown> {
  const scopes = [
    ...new Set(
      Object.values(input.config.resources).flatMap((resource) =>
        Object.keys(resource.scopes)
      )
    ),
  ].sort();
  return {
    authorization_endpoint: input.identity.authorizationEndpoint,
    authorization_response_iss_parameter_supported: true,
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: [
      "authorization_code",
      ...(input.config.issueRefreshTokens ? ["refresh_token"] : []),
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
