import type { AthenaAuthMutationScope } from "../hooks/scope.ts";
import type { AthenaAuthProtocolIdentity } from "../protocol-identity.ts";
import type { AthenaTokenAuthority } from "./athena-token-authority.ts";
import type { OAuthAuthorizationServerService } from "./authorization-server/service.ts";
import type { AuthClock } from "./clock.ts";
import type { LocalTokenAuthority } from "./token-authority.ts";

export interface AuthProtocolRuntime {
  clock: AuthClock;
  forMutation(scope: AthenaAuthMutationScope): AuthProtocolRuntime;
  identity: AthenaAuthProtocolIdentity;
  legacyToken: LocalTokenAuthority;
  oauth: OAuthAuthorizationServerService;
  signing: AthenaTokenAuthority;
  stateSecret: string;
}

export function rebindProtocolRuntime(
  runtime: AuthProtocolRuntime,
  scope: AthenaAuthMutationScope
): AuthProtocolRuntime {
  return {
    clock: runtime.clock,
    forMutation: (next) => rebindProtocolRuntime(runtime, next),
    identity: runtime.identity,
    legacyToken: runtime.legacyToken,
    oauth: runtime.oauth.withMutationScope(scope),
    signing: scope.tokenKeys
      ? runtime.signing.withKeyStore(scope.tokenKeys)
      : runtime.signing,
    stateSecret: runtime.stateSecret,
  };
}
