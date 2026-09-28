import {
  type BillingResolvedCredential,
  billingCredentialSlot,
  resolveBillingCredential,
} from "../../credentials.ts";
import { resolveBillingEnvironment } from "../../environment.ts";
import type {
  BillingProviderBinding,
  BillingProviderExecutionContext,
} from "./types.ts";

export function createBillingProviderExecutionContext(input: {
  binding: BillingProviderBinding;
  idempotencyKey?: string;
  ingress?: {
    classicWebhookUrl?: string;
    classicWebhookUrlsByConnectionId?: Readonly<Record<string, string>>;
  };
  operationScope?: "organization" | "profile" | "automatic";
  signal?: AbortSignal;
  target?: { profileId?: string };
  testMode?: boolean;
}): BillingProviderExecutionContext {
  const environment = resolveBillingEnvironment({
    testMode: input.testMode,
  });
  const resolved = resolveBillingCredential({
    binding: input.binding,
    provider: input.binding.provider,
    slot: billingCredentialSlot(
      input.binding.kind === "connection"
        ? {
            credentialReference: input.binding.credentialReference,
            kind: "connection",
          }
        : { kind: "configured" }
    ),
    testMode: environment.testMode,
  });
  const credential: BillingResolvedCredential = resolved.credential;
  const connectionId =
    "connectionId" in input.binding ? input.binding.connectionId : undefined;
  const connectionWebhookUrl =
    connectionId == null
      ? undefined
      : input.ingress?.classicWebhookUrlsByConnectionId?.[connectionId];
  const ingress =
    input.ingress != null && connectionWebhookUrl != null
      ? { ...input.ingress, classicWebhookUrl: connectionWebhookUrl }
      : input.ingress;
  return {
    binding: input.binding,
    credential,
    environment,
    provider: input.binding.provider,
    ...(input.operationScope === null
      ? {}
      : { operationScope: input.operationScope }),
    idempotencyKey: input.idempotencyKey,
    signal: input.signal,
    target: {
      profileId: input.target?.profileId,
    },
    ...(ingress ? { ingress } : {}),
  };
}
