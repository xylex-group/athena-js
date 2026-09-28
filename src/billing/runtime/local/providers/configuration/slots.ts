import type { BillingProviderName } from "../../../../types.ts";
import type { BillingConfiguredProviderSlot } from "./ir.ts";

export function credentialReferenceForConfiguredSlot(input: {
  environment: "test" | "live";
  provider: BillingProviderName;
  slotKey: string | null;
}): string {
  if (input.slotKey == null) {
    return input.environment === "live"
      ? `providers.${input.provider}-live`
      : `providers.${input.provider}`;
  }
  return `providers.${input.provider}:${input.slotKey}`;
}

export function slotName(slot: BillingConfiguredProviderSlot): string {
  return slot.slotKey ?? "default";
}
