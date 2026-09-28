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
import { createAthenaEmailTemplates } from "./templates.ts";
import type {
  AthenaEmailConfig,
  AthenaEmailDeliveryResult,
  AthenaEmailMessage,
  AthenaEmailModule,
  AthenaEmailTemplateStore,
} from "./types.ts";

export interface CreateEmailModuleOptions {
  templateStore?: AthenaEmailTemplateStore;
}

const templateStoreSetters = new WeakMap<
  AthenaEmailModule,
  (store: AthenaEmailTemplateStore) => void
>();

export function createEmailModule(
  config?: AthenaEmailConfig | null,
  options?: CreateEmailModuleOptions
): AthenaEmailModule {
  const normalized: NormalizedAthenaEmailConfig =
    normalizeAthenaEmailConfig(config);
  const diagnostics = toAthenaEmailDiagnostics(normalized);
  const configured = diagnostics.configured;
  let templateStore =
    options?.templateStore ?? normalized.templateStore ?? undefined;

  const send = async (
    message: AthenaEmailMessage
  ): Promise<AthenaEmailDeliveryResult> => {
    if (!normalized.provider) {
      throw new AthenaEmailError(
        ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED,
        "Athena email has no provider configured. Pass createClient({ email: { provider } })."
      );
    }
    return deliverAthenaEmail(message, normalized);
  };

  const templates = createAthenaEmailTemplates(
    () => templateStore,
    send,
    normalized.defaults.locale
  );

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
    send,
    templates,
  };

  templateStoreSetters.set(module, (store) => {
    if (templateStore == null) {
      templateStore = store;
    }
  });
  return Object.freeze(module);
}

export function bindAthenaEmailTemplateStore(
  email: AthenaEmailModule,
  store: AthenaEmailTemplateStore
): void {
  templateStoreSetters.get(email)?.(store);
}
