import { createHash } from "node:crypto";
import { billingWebhookOwnershipMarker } from "../ownership.ts";
import type {
  BillingWebhookDesiredState,
  BillingWebhookReconcileInput,
} from "./types.ts";

export function billingWebhookConfigHash(input: {
  eventTypes: readonly string[];
  kind: string;
  url: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        eventTypes: [...input.eventTypes].sort(),
        kind: input.kind,
        url: input.url,
      }),
      "utf8"
    )
    .digest("hex")
    .slice(0, 32);
}

export function buildDesiredBillingWebhookState(
  input: BillingWebhookReconcileInput
): BillingWebhookDesiredState {
  const marker = billingWebhookOwnershipMarker({
    applicationId: input.applicationId,
    connectionId: input.connectionId,
  });
  const mollie = input.webhooks.providers.mollie;
  const classicEnabled =
    mollie.classic.enabled && mollie.strategy !== "next_gen";
  const nextGenWanted =
    mollie.nextGen.enabled !== false && mollie.strategy !== "classic";
  const nextGenEnabled =
    nextGenWanted &&
    (mollie.nextGen.enabled === "required" ||
      input.capability.nextGen.available);
  return {
    marker,
    ...(classicEnabled
      ? {
          classic: {
            enabled: true,
            url: input.endpoints.classic,
          },
        }
      : {}),
    ...(nextGenWanted
      ? {
          nextGen: {
            enabled: nextGenEnabled,
            eventTypes: mollie.nextGen.eventTypes,
            name: marker,
            required: mollie.nextGen.enabled === "required",
            url: input.endpoints.nextGen,
          },
        }
      : {}),
  };
}
