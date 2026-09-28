import type { NormalizedAthenaAuthorizationServerConfig } from "../../src/auth/config.ts";
import { AthenaTokenAuthority } from "../../src/auth/local/athena-token-authority.ts";
import type { TokenKeyStore } from "../../src/auth/local/token-key-store.ts";
import { createAthenaAuthProtocolIdentity } from "../../src/auth/protocol-identity.ts";

export function createTestOAuthSigning(
  config: NormalizedAthenaAuthorizationServerConfig,
  keyStore: TokenKeyStore
): AthenaTokenAuthority {
  const issuer = config.issuer ?? "https://issuer.example";
  return new AthenaTokenAuthority({
    identity: createAthenaAuthProtocolIdentity({
      appIdentity: {
        hostname: new URL(issuer).hostname,
        name: "oauth-test",
        origin: issuer,
      },
      authorizationServer: config,
      basePath: "/",
    }),
    keyStore,
  });
}
