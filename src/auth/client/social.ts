import type {
  AthenaAuthBindings,
  AthenaAuthCallbackProviderRequest,
  AthenaAuthCallbackProviderResponse,
  AthenaAuthCallOptions,
  AthenaAuthEndpointPath,
  AthenaAuthFetchCompatibleInput,
  AthenaAuthSignInResponse,
  AthenaAuthSocialRedirectResponse,
  AthenaLinkSocialRequest,
  AthenaSocialSignInRequest,
} from "../types.ts";
import type { AuthCapabilityGates } from "./capability-gates.ts";
import {
  sessionFromSignIn,
  type AuthSessionMutationController,
} from "./session-mutations.ts";
import type { AuthTransport } from "./transport.ts";

export function createSocialClientModule(input: {
  gates: AuthCapabilityGates;
  mutations: AuthSessionMutationController;
  transport: AuthTransport;
}) {
  const { gates, mutations, transport } = input;

  const link = (
    input: AthenaLinkSocialRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) =>
    gates.gateCapability(gates.denySocial("/link-social"), () =>
      transport.postGeneric<AthenaAuthSocialRedirectResponse>(
        "/link-social",
        input,
        options
      )
    );

  const signIn = (
    input: AthenaSocialSignInRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) =>
    gates.gateCapability(gates.denySocial("/sign-in/social"), async () => {
      const persistenceGeneration =
        mutations.sessionStore.beginPersistenceMutation();
      try {
        return await mutations.applyAuthMutationToSessionStore(
          await transport.postGeneric<
            AthenaAuthSocialRedirectResponse | AthenaAuthSignInResponse
          >("/sign-in/social", input, options),
          { persistenceGeneration, refreshIfMissing: false }
        );
      } finally {
        mutations.sessionStore.endPersistenceMutation();
      }
    });

  const callbackProvider: AthenaAuthBindings["callback"]["provider"] = async (
    input,
    options
  ) => {
    const { payload, fetchOptions } = transport.extractFetchOptions(input);
    const parsed = payload as
      | Partial<AthenaAuthCallbackProviderRequest>
      | undefined;
    const provider = String(parsed?.provider ?? "").trim();
    if (!provider) {
      throw new Error("callback.provider requires a non-empty provider value");
    }
    const code = String(parsed?.code ?? "").trim();
    const state = String(parsed?.state ?? "").trim();
    if (!(code && state)) {
      throw new Error(
        "callback.provider requires non-empty code and state values"
      );
    }
    const endpoint =
      `/callback/${encodeURIComponent(provider)}` as AthenaAuthEndpointPath;
    const persistenceGeneration =
      mutations.sessionStore.beginPersistenceMutation();
    try {
      const result = await transport.request<AthenaAuthCallbackProviderResponse>(
        {
          endpoint,
          fetchOptions,
          method: "GET",
          query: {
            code,
            state,
          },
        },
        options
      );
      if (
        result.ok &&
        typeof result.data?.token === "string" &&
        sessionFromSignIn(result.data)
      ) {
        return mutations.applyAuthMutationToSessionStore(result, {
          persistenceGeneration,
          refreshIfMissing: false,
        });
      }
      return result;
    } finally {
      mutations.sessionStore.endPersistenceMutation();
    }
  };

  return {
    callbackProvider,
    link,
    signIn,
  };
}
