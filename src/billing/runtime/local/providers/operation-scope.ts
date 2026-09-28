export type MollieOperationScope = "organization" | "profile" | "automatic";

/**
 * Organization/control-plane calls must not send a profile-restricted SDK
 * client (`profileId` / defaultProfileId). Profile/data-plane calls may.
 */
export function mollieOperationScopeFor(
  operation: string
): MollieOperationScope {
  if (operation.startsWith("webhooks.")) {
    return "organization";
  }
  if (
    operation.startsWith("payments.") ||
    operation.startsWith("refunds.") ||
    operation.startsWith("paymentLinks.") ||
    operation.startsWith("subscriptions.")
  ) {
    return "profile";
  }
  if (operation.startsWith("customers.") || operation.startsWith("invoices.")) {
    return "organization";
  }
  return "automatic";
}
