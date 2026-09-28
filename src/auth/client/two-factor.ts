import type {
  AthenaAuthFetchCompatibleInput,
  AthenaTwoFactorGenerateBackupCodesRequest,
  AthenaTwoFactorGenerateBackupCodesResponse,
  InternalAthenaAuthModule,
} from "../types.ts";
import type { AuthTransport } from "./transport.ts";

export function createTwoFactorClientModule(input: {
  transport: AuthTransport;
}) {
  const { transport } = input;
  const { resolvedConfig } = transport;

  const twoFactor: InternalAthenaAuthModule["auth"]["twoFactor"] = {
    disable: (input, options) =>
      transport.postGeneric("/two-factor/disable", input, options),
    enable: (input, options) =>
      transport.postGeneric("/two-factor/enable", input, options),
    generateBackupCodes: (input, options) =>
      transport.executePostWithCompatibleInput<
        AthenaTwoFactorGenerateBackupCodesRequest &
          AthenaAuthFetchCompatibleInput,
        AthenaTwoFactorGenerateBackupCodesResponse
      >(
        resolvedConfig,
        { endpoint: "/two-factor/generate-backup-codes", method: "POST" },
        input,
        options
      ),
    getTotpUri: (input, options) =>
      transport.postGeneric("/two-factor/get-totp-uri", input, options),
    sendOtp: (input, options) =>
      transport.postGeneric("/two-factor/send-otp", input, options),
    verifyBackupCode: (input, options) =>
      transport.postGeneric("/two-factor/verify-backup-code", input, options),
    verifyOtp: (input, options) =>
      transport.postGeneric("/two-factor/verify-otp", input, options),
    verifyTotp: (input, options) =>
      transport.postGeneric("/two-factor/verify-totp", input, options),
  };

  return { twoFactor };
}
