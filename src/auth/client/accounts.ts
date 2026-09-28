import { createAthenaAuthTokenProvider } from "../token-provider.ts";
import type {
  AthenaAuthCallOptions,
  AthenaAuthFetchCompatibleInput,
  AthenaAuthLinkedAccount,
  AthenaAuthStatusResponse,
  AthenaUnlinkAccountRequest,
  InternalAthenaAuthModule,
} from "../types.ts";
import type { AuthCapabilityGates } from "./capability-gates.ts";
import type { AuthTransport } from "./transport.ts";

export function createAccountClientModule(input: {
  gates: AuthCapabilityGates;
  transport: AuthTransport;
}) {
  const { gates, transport } = input;

  const list = (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) =>
    transport.getGeneric<AthenaAuthLinkedAccount[]>(
      "/list-accounts",
      input,
      options
    );

  const unlink = (
    input: AthenaUnlinkAccountRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) =>
    gates.gateCapability(gates.denySocial("/unlink-account"), () =>
      transport.postGeneric<AthenaAuthStatusResponse>(
        "/unlink-account",
        input,
        options
      )
    );

  const getAccessToken: InternalAthenaAuthModule["auth"]["getAccessToken"] = (
    input,
    options
  ) => transport.postGeneric("/get-access-token", input, options);

  const refreshToken: InternalAthenaAuthModule["auth"]["refreshToken"] = (
    input,
    options
  ) => transport.postGeneric("/refresh-token", input, options);

  const getToken: InternalAthenaAuthModule["auth"]["getToken"] = (
    input,
    options
  ) => transport.postGeneric("/token", input, options);

  const tokenProvider: InternalAthenaAuthModule["auth"]["tokenProvider"] = (
    options
  ) =>
    createAthenaAuthTokenProvider(
      (input, callOptions) =>
        transport.postGeneric("/token", input, callOptions),
      options
    );

  return {
    getAccessToken,
    getToken,
    list,
    refreshToken,
    tokenProvider,
    unlink,
  };
}
