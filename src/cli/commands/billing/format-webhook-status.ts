import type { BillingWebhookOperationalStatus } from "../../../billing/ingestion/observability/operational-status.ts";
import type { BillingAdminWebhookStatus } from "../../../billing/runtime/admin/types.ts";

function mountMark(
  mounted: BillingWebhookOperationalStatus["route"]["mounted"]
): string {
  if (mounted === true) {
    return "✓ mounted";
  }
  if (mounted === false) {
    return "✗ not mounted";
  }
  return "? unknown";
}

function formatChannel(
  label: string,
  channel: BillingWebhookOperationalStatus
): string {
  const lines = [
    label,
    `  Route              ${mountMark(channel.route.mounted)}`,
    `  Registration       ${channel.registration.status} (${channel.registration.health})`,
    `  Verification       ${channel.verification.strategy.replaceAll("_", " ")}`,
  ];
  const lastAccepted = channel.delivery.lastAcceptedAt;
  const lastRejected = channel.delivery.lastRejectedAt;
  if (lastRejected && (!lastAccepted || lastRejected > lastAccepted)) {
    lines.push("  Last delivery      ✗ rejected");
    if (channel.delivery.lastRejectionCode) {
      lines.push(`  Error              ${channel.delivery.lastRejectionCode}`);
    }
  } else if (lastAccepted) {
    lines.push(`  Last delivery      ${lastAccepted.toISOString()}`);
  } else {
    lines.push("  Last delivery      —");
  }
  const outcome = channel.reconciliation.lastOutcome;
  lines.push(`  Last reconciliation ${outcome ? outcome : "—"}`);
  return lines.join("\n");
}

export function formatBillingWebhookOperatorStatus(
  status: BillingAdminWebhookStatus
): string {
  return [
    "Billing webhook ingress",
    "",
    formatChannel("Classic", status.channels.classic),
    "",
    formatChannel("Next-gen", status.channels.nextGen),
  ].join("\n");
}
