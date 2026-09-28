import { billingWebhookRegistrationOperationalHealth } from "../observability/operational-status.ts";
import type { BillingConnectionIngestionHealth } from "../types.ts";
import type { BillingWebhookRegistrationRecord } from "./types.ts";

export function connectionIngestionHealthFromRegistrations(
  rows: readonly BillingWebhookRegistrationRecord[]
): BillingConnectionIngestionHealth {
  const classic = rows.find((row) => row.kind === "classic");
  const nextGen = rows.find((row) => row.kind === "next_gen");
  const mapClassic = (): BillingConnectionIngestionHealth["classic"] => {
    if (!classic) {
      return "unsupported";
    }
    if (
      classic.status === "error" ||
      billingWebhookRegistrationOperationalHealth(classic) === "unhealthy"
    ) {
      return "error";
    }
    if (classic.status === "disabled") {
      return "disabled";
    }
    return "active";
  };
  const mapNextGen = (): BillingConnectionIngestionHealth["nextGen"] => {
    if (!nextGen) {
      return "unsupported";
    }
    if (
      nextGen.status === "error" ||
      billingWebhookRegistrationOperationalHealth(nextGen) === "unhealthy"
    ) {
      return "error";
    }
    if (nextGen.status === "degraded") {
      return "degraded";
    }
    if (nextGen.status === "disabled") {
      return "disabled";
    }
    if (nextGen.status === "drifted") {
      return "degraded";
    }
    return "active";
  };
  return {
    classic: mapClassic(),
    drifted: rows.some((row) => row.status === "drifted"),
    nextGen: mapNextGen(),
    ...((classic?.lastVerifiedAt ?? nextGen?.lastVerifiedAt)
      ? { lastVerifiedAt: classic?.lastVerifiedAt ?? nextGen?.lastVerifiedAt }
      : {}),
    ...((classic?.lastDeliveryAt ?? nextGen?.lastDeliveryAt)
      ? { lastDeliveryAt: classic?.lastDeliveryAt ?? nextGen?.lastDeliveryAt }
      : {}),
  };
}
