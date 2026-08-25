import {
  ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED,
  AthenaEmailError,
} from "./errors.ts";
import {
  type NormalizedAthenaEmailConfig,
  normalizeAthenaEmailConfig,
  toAthenaEmailDiagnostics,
} from "./normalize-config.ts";
import { deliverAthenaEmail } from "./runtime.ts";
import type {
  AthenaEmailConfig,
  AthenaEmailDeliveryResult,
  AthenaEmailMessage,
  AthenaEmailModule,
} from "./types.ts";

export function createEmailModule(
  config?: AthenaEmailConfig | null
): AthenaEmailModule {
  const normalized: NormalizedAthenaEmailConfig =
    normalizeAthenaEmailConfig(config);
  const diagnostics = toAthenaEmailDiagnostics(normalized);
  const configured = diagnostics.configured;

  const module: AthenaEmailModule = {
    get configured() {
      return configured;
    },
    get diagnostics() {
      return {
        attachmentFailureMode: diagnostics.attachmentFailureMode,
        configured: diagnostics.configured,
        defaults: { ...diagnostics.defaults },
        providerDelivery: diagnostics.providerDelivery,
        providerId: diagnostics.providerId,
        providerRuntimes: diagnostics.providerRuntimes,
      };
    },
    async send(message: AthenaEmailMessage): Promise<AthenaEmailDeliveryResult> {
      if (!normalized.provider) {
        throw new AthenaEmailError(
          ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED,
          "Athena email has no provider configured. Pass createClient({ email: { provider } })."
        );
      }
      return deliverAthenaEmail(message, normalized);
    },
  };

  return Object.freeze(module);
}
