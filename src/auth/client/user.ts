import type {
  AthenaAuthCallOptions,
  AthenaAuthFetchCompatibleInput,
  AthenaAuthSignInResponse,
  AthenaAuthStatusResponse,
  AthenaAuthTokenVerificationResponse,
  AthenaDeleteUserCallbackRequest,
  AthenaDeleteUserRequest,
  AthenaDeleteUserResponse,
  AthenaEmailSignInRequest,
  AthenaEmailSignUpRequest,
  AthenaUpdateUserRequest,
  AthenaUsernameSignInRequest,
  InternalAthenaAuthModule,
} from "../types.ts";
import type { AuthSessionMutationController } from "./session-mutations.ts";
import type { AuthTransport } from "./transport.ts";

type AthenaDeleteUserVerificationResponse =
  AthenaAuthTokenVerificationResponse & {
    success?: boolean;
  };

export function createUserClientModule(input: {
  mutations: AuthSessionMutationController;
  transport: AuthTransport;
}) {
  const { mutations, transport } = input;
  const { resolvedConfig } = transport;

  const clearAfterConfirmedDeletion = async () => {
    const invalidationGeneration =
      mutations.sessionStore.invalidate("revoke");
    await mutations.sessionStore.clearPersistedSessionAtGeneration(
      invalidationGeneration
    );
  };

  const signInEmail = async (
    input: AthenaEmailSignInRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => {
    const persistenceGeneration =
      mutations.sessionStore.beginPersistenceMutation();
    try {
      return await mutations.applyAuthMutationToSessionStore(
        await transport.postGeneric<AthenaAuthSignInResponse>(
          "/sign-in/email",
          input,
          options
        ),
        { persistenceGeneration }
      );
    } finally {
      mutations.sessionStore.endPersistenceMutation();
    }
  };

  const signInUsername = async (
    input: AthenaUsernameSignInRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => {
    const persistenceGeneration =
      mutations.sessionStore.beginPersistenceMutation();
    try {
      return await mutations.applyAuthMutationToSessionStore(
        await transport.postGeneric<AthenaAuthSignInResponse>(
          "/sign-in/username",
          input,
          options
        ),
        { persistenceGeneration }
      );
    } finally {
      mutations.sessionStore.endPersistenceMutation();
    }
  };

  const signUpEmail = async (
    input: AthenaEmailSignUpRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => {
    const persistenceGeneration =
      mutations.sessionStore.beginPersistenceMutation();
    try {
      return await mutations.applyAuthMutationToSessionStore(
        await transport.postGeneric<AthenaAuthSignInResponse>(
          "/sign-up/email",
          input,
          options
        ),
        { persistenceGeneration }
      );
    } finally {
      mutations.sessionStore.endPersistenceMutation();
    }
  };

  const updateUser = async (
    input: AthenaUpdateUserRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) =>
    mutations.applyAuthMutationToSessionStore(
      await transport.postGeneric<AthenaAuthStatusResponse>(
        "/update-user",
        input,
        options
      ),
      { refreshIfMissing: true }
    );

  const deleteUser = async (
    input?: AthenaDeleteUserRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => {
    const { payload, fetchOptions } = transport.extractFetchOptions(input);
    const mergedOptions = transport.mergeCallOptions(fetchOptions, options);
    const result = await transport.callAuthEndpoint<AthenaDeleteUserResponse>(
      resolvedConfig,
      { endpoint: "/delete-user", method: "POST" },
      payload ?? {},
      undefined,
      mergedOptions
    );
    if (result.ok && result.data?.success === true) {
      await clearAfterConfirmedDeletion();
    }
    return result;
  };

  const deleteUserCallback = async (
    input?: AthenaDeleteUserCallbackRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => {
    const { payload, fetchOptions } = transport.extractFetchOptions(input);
    const mergedOptions = transport.mergeCallOptions(fetchOptions, options);
    const query = (payload ?? {}) as AthenaDeleteUserCallbackRequest;
    const result = await transport.callAuthEndpoint<AthenaDeleteUserResponse>(
      resolvedConfig,
      { endpoint: "/delete-user/callback", method: "GET" },
      undefined,
      {
        callbackURL: query.callbackURL,
        token: query.token,
      },
      mergedOptions
    );
    if (result.ok && result.data?.success === true) {
      await mutations.refreshSessionStore();
    }
    return result;
  };

  const deleteUserVerify: InternalAthenaAuthModule["auth"]["deleteUserVerify"] =
    async (input, options) => {
      const result =
        await transport.getWithQuery<AthenaDeleteUserVerificationResponse>(
          "/delete-user/verify",
          { ...input, query: { token: input.query.token } },
          options
        );
      if (result.ok && result.data?.success === true) {
          await mutations.refreshSessionStore();
      }
      return result;
    };

  return {
    deleteUser,
    deleteUserCallback,
    deleteUserVerify,
    signInEmail,
    signInUsername,
    signUpEmail,
    updateUser,
  };
}
