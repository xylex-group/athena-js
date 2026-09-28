import { mollieCredentialSupportsManagedNextGen } from "../../../../ingestion/config.ts";
import type {
  BillingProviderBinding,
  BillingWebhookManagementCapability,
} from "../types.ts";

export function resolveMollieWebhookManagementCapability(
  binding: BillingProviderBinding
): BillingWebhookManagementCapability {
  const live = binding.credentials.live;
  const test = binding.credentials.test;
  const kind = live?.kind ?? test?.kind;
  if (
    kind === "api_key" ||
    kind === "secret_key" ||
    kind === "restricted_key"
  ) {
    return {
      classic: true,
      nextGen: {
        available: false,
        list: false,
        reason: "api_key_classic_only",
        write: false,
      },
    };
  }
  if (mollieCredentialSupportsManagedNextGen(kind)) {
    const authority = binding.providerConfig.authority;
    const scope =
      authority && typeof authority === "object"
        ? (authority as { scope?: { kind?: unknown } }).scope
        : undefined;
    const permissions =
      authority && typeof authority === "object"
        ? (
            authority as {
              permissions?: {
                "webhooks.read"?: unknown;
                "webhooks.write"?: unknown;
                webhooks?: { read?: unknown; write?: unknown };
              };
            }
          ).permissions
        : undefined;
    const webhooksRead =
      permissions?.["webhooks.read"] ?? permissions?.webhooks?.read;
    const webhooksWrite =
      permissions?.["webhooks.write"] ?? permissions?.webhooks?.write;
    if (scope?.kind !== "organization" || webhooksWrite !== true) {
      return {
        classic: true,
        nextGen: {
          available: false,
          list: scope?.kind === "organization" && webhooksRead === true,
          reason: "credential_missing_webhooks_write",
          write: false,
        },
      };
    }
    return {
      classic: true,
      nextGen: {
        available: true,
        list: webhooksRead === true,
        reason: "verified_organization_webhooks_write",
        write: true,
      },
    };
  }
  return {
    classic: true,
    nextGen: {
      available: false,
      list: false,
      reason: "credential_missing_webhooks_write",
      write: false,
    },
  };
}
