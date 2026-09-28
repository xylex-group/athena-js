import type { NormalizedMollieBillingProviderConfig } from "../../../../../providers/types.ts";
import type { BillingResolvedCredential } from "../../../../credentials.ts";
import { resolveMollieRequestProfileId } from "../profile-target.ts";
import { assertMollieSdkClient } from "./assertions.ts";
import type { MollieSdkClient, MollieSdkClientOptions } from "./types.ts";

export class MollieSdkClientPool {
  private readonly clients = new Map<string, MollieSdkClient>();

  constructor(private readonly config: NormalizedMollieBillingProviderConfig) {}

  apiBaseUrl(): string {
    return this.config.apiBaseUrl;
  }

  private construct(options: MollieSdkClientOptions): MollieSdkClient {
    const created =
      this.config.adapter == null
        ? new this.config.sdk(options)
        : this.config.adapter(options);
    return assertMollieSdkClient(created, "mollie.sdk.construct");
  }

  clientFor(input: {
    credential: BillingResolvedCredential;
    operationScope?: "organization" | "profile" | "automatic";
    requestedProfileId?: string | null;
  }): MollieSdkClient {
    const options = mollieSdkClientOptions({
      config: this.config,
      credential: input.credential,
      operationScope: input.operationScope,
      requestedProfileId: input.requestedProfileId,
    });
    const key = mollieSdkClientKey({
      credential: input.credential,
      profileId: options.profileId,
      serverURL: options.serverURL,
    });
    const existing = this.clients.get(key);
    if (existing != null) {
      return existing;
    }
    const created = this.construct(options);
    this.clients.set(key, created);
    return created;
  }
}

export function mollieSdkClientOptions(input: {
  config: NormalizedMollieBillingProviderConfig;
  credential: BillingResolvedCredential;
  operationScope?: "organization" | "profile" | "automatic";
  requestedProfileId?: string | null;
}): MollieSdkClientOptions {
  const secret = input.credential.revealForProviderRuntime();
  const kind = input.config.credentialKind;
  if (kind === "api_key") {
    return {
      security: { apiKey: secret },
      serverURL: input.config.apiBaseUrl,
    };
  }
  const security =
    kind === "advanced_access_token"
      ? { advancedAccessToken: secret }
      : { oAuth: secret };
  const scope = input.operationScope ?? "automatic";
  const profileId =
    scope === "organization"
      ? undefined
      : resolveMollieRequestProfileId({
          configuredProfileId:
            input.config.profileId ?? input.config.defaultProfileId,
          credentialKind: kind,
          requestedProfileId: input.requestedProfileId,
        });
  return {
    ...(profileId === null ? {} : { profileId }),
    security,
    serverURL: input.config.apiBaseUrl,
    testmode: input.credential.environment === "test",
  };
}

export function mollieSdkClientKey(input: {
  credential: BillingResolvedCredential;
  profileId?: string;
  serverURL?: string;
}): string {
  return [
    input.credential.provider,
    input.credential.slot,
    input.credential.fingerprint,
    input.credential.environment,
    input.credential.kind,
    input.profileId ?? "",
    input.serverURL ?? "",
  ].join(":");
}
