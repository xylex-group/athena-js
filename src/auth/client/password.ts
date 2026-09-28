import type {
  AthenaAuthCallOptions,
  AthenaAuthEndpointPath,
  AthenaAuthFetchCompatibleInput,
  AthenaAuthStatusResponse,
  InternalAthenaAuthModule,
} from "../types.ts";
import type { AuthTransport } from "./transport.ts";

export function createPasswordClientModule(input: {
  transport: AuthTransport;
}) {
  const { transport } = input;
  const { resolvedConfig } = transport;

  const changePassword: InternalAthenaAuthModule["auth"]["changePassword"] = (
    input,
    options
  ) => transport.postGeneric("/change-password", input, options);

  const forgetPassword: InternalAthenaAuthModule["auth"]["forgetPassword"] = (
    input,
    options
  ) => transport.postGeneric("/forget-password", input, options);

  const setPassword: InternalAthenaAuthModule["auth"]["setPassword"] = (
    input,
    options
  ) => transport.postGeneric("/set-password", input, options);

  const resolveResetPasswordToken = (
    input: {
      token: string;
      callbackURL?: string;
    } & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => {
    const { payload, fetchOptions } = transport.extractFetchOptions(input);
    const mergedOptions = transport.mergeCallOptions(fetchOptions, options);
    const query = payload as
      | { token?: string; callbackURL?: string }
      | undefined;
    const token = query?.token?.trim();
    if (!token) {
      throw new Error("resolveResetPasswordToken requires a non-empty token");
    }
    const endpoint =
      `/reset-password/${encodeURIComponent(token)}` as AthenaAuthEndpointPath;
    return transport.callAuthEndpoint<{ token?: string }>(
      resolvedConfig,
      { endpoint, method: "GET" },
      undefined,
      query?.callbackURL ? { callbackURL: query.callbackURL } : undefined,
      mergedOptions
    );
  };

  const resetPasswordPost = (
    input: Parameters<InternalAthenaAuthModule["resetPassword"]>[0],
    options?: AthenaAuthCallOptions
  ) =>
    transport.executePostWithCompatibleInput<
      typeof input,
      AthenaAuthStatusResponse
    >(
      resolvedConfig,
      { endpoint: "/reset-password", method: "POST" },
      input,
      options
    );

  const resetPassword = Object.assign(resetPasswordPost, {
    token: resolveResetPasswordToken,
  });

  return {
    changePassword,
    forgetPassword,
    resetPassword,
    resolveResetPasswordToken,
    setPassword,
  };
}
