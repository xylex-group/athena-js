import type {
  AthenaAuthEmailListQuery,
  AthenaAuthEmailListResponse,
  AthenaAuthGenericQueryInput,
  AthenaAuthUser,
  InternalAthenaAuthModule,
} from "../types.ts";
import type { AuthTransport } from "./transport.ts";

export function createEmailClientModule(input: { transport: AuthTransport }) {
  const { transport } = input;

  const changeEmail: InternalAthenaAuthModule["auth"]["changeEmail"] = (
    input,
    options
  ) => transport.postGeneric("/change-email", input, options);

  const changeEmailVerify: InternalAthenaAuthModule["auth"]["changeEmailVerify"] =
    (input, options) =>
      transport.getWithQuery("/change-email/verify", input, options);

  const sendVerificationEmail: InternalAthenaAuthModule["auth"]["sendVerificationEmail"] =
    (input, options) =>
      transport.postGeneric("/send-verification-email", input, options);

  const verifyEmail: InternalAthenaAuthModule["auth"]["verifyEmail"] = (
    input,
    options
  ) => {
    const queryInput: AthenaAuthGenericQueryInput = {
      fetchOptions: input.fetchOptions,
      query: {
        callbackURL: input.callbackURL,
        token: input.token,
      },
    };
    return transport.getWithQuery<{ user: AthenaAuthUser; status: boolean }>(
      "/verify-email",
      queryInput,
      options
    );
  };

  const listUserEmails: InternalAthenaAuthModule["auth"]["user"]["email"]["list"] =
    async (input, options) => {
      const primary = await transport.getWithQuery<
        AthenaAuthEmailListResponse,
        AthenaAuthEmailListQuery
      >("/email/list", input, options);
      if (
        primary.ok ||
        primary.status !== 404 ||
        primary.errorDetails?.code !== "HTTP_ERROR"
      ) {
        return primary;
      }
      return transport.getWithQuery<
        AthenaAuthEmailListResponse,
        AthenaAuthEmailListQuery
      >("/email-list", input, options);
    };

  return {
    changeEmail,
    changeEmailVerify,
    listUserEmails,
    sendVerificationEmail,
    verifyEmail,
  };
}
