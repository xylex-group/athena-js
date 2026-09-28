import type { BillingProviderWebhook } from "../../runtime/local/providers/types.ts";
import { isAthenaOwnedWebhookName } from "../ownership.ts";
import { billingWebhookUrlIsLoopback } from "../urls.ts";
import type {
  BillingWebhookDesiredState,
  BillingWebhookReconciliationPlan,
} from "./types.ts";

function sameEventTypes(
  left: readonly string[],
  right: readonly string[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

export function planBillingWebhookReconciliation(input: {
  actual: readonly BillingProviderWebhook[];
  desired: BillingWebhookDesiredState;
  hasDecryptableLocalSecret?: boolean;
  management: "automatic" | "manual";
}): {
  foreign: readonly BillingProviderWebhook[];
  plans: readonly BillingWebhookReconciliationPlan[];
} {
  const foreign = input.actual.filter(
    (webhook) => !isAthenaOwnedWebhookName(webhook.name, input.desired.marker)
  );
  const owned = input.actual.filter((webhook) =>
    isAthenaOwnedWebhookName(webhook.name, input.desired.marker)
  );
  const plans: BillingWebhookReconciliationPlan[] = [];
  const nextGen = input.desired.nextGen;
  if (nextGen) {
    if (billingWebhookUrlIsLoopback(nextGen.url)) {
      plans.push({
        action: "noop",
        kind: "next_gen",
        owned: true,
        reason: "loopback_webhook_url",
      });
    } else if (nextGen.enabled) {
      const match = owned.find((webhook) => webhook.url.length > 0);
      if (!match) {
        plans.push({
          action: input.management === "manual" ? "conflict" : "create",
          kind: "next_gen",
          owned: true,
          reason: "owned_webhook_missing",
        });
      } else if (
        match.url !== nextGen.url ||
        !sameEventTypes(match.eventTypes, nextGen.eventTypes) ||
        match.status === "disabled"
      ) {
        plans.push({
          action: input.management === "manual" ? "conflict" : "update",
          kind: "next_gen",
          owned: true,
          providerWebhook: match,
          reason:
            match.status === "disabled"
              ? "registration_disabled"
              : "owned_webhook_drift",
        });
      } else if (input.hasDecryptableLocalSecret === false) {
        plans.push({
          action: input.management === "manual" ? "conflict" : "update",
          kind: "next_gen",
          owned: true,
          providerWebhook: match,
          reason: "owned_webhook_drift",
        });
      } else {
        plans.push({
          action: "noop",
          kind: "next_gen",
          owned: true,
          providerWebhook: match,
          reason: "in_sync",
        });
      }
    } else {
      plans.push({
        action: "noop",
        kind: "next_gen",
        owned: false,
        reason: "next_gen_unsupported",
      });
    }
  }
  if (input.desired.classic) {
    plans.push({
      action: "noop",
      kind: "classic",
      owned: true,
      reason: "classic_url_injection",
    });
  }
  return { foreign, plans };
}
