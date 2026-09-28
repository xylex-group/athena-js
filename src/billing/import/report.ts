import type { BillingImportPlan, BillingImportRunReport } from "./types.ts";

function evidenceLine(plan: BillingImportPlan): string {
  if (plan.evidence.length === 0) {
    return "    (none)";
  }
  return plan.evidence
    .map((item) => `    - ${item.kind}${item.value ? `: ${item.value}` : ""}`)
    .join("\n");
}

function actionLine(plan: BillingImportPlan): string {
  switch (plan.action) {
    case "create_active_binding":
      return "create active binding";
    case "noop":
      return "noop";
    case "resume_pending":
      return "resume pending binding";
    case "mark_conflict":
      return "mark conflict";
    case "none":
      return "no automatic binding";
    default: {
      const _exhaustive: never = plan.action;
      return _exhaustive;
    }
  }
}

export function formatBillingImportPlan(plan: BillingImportPlan): string {
  if (plan.decision === "conflict" && plan.candidates.length > 1) {
    const candidateLines = plan.candidates
      .map((subject) => `    - ${subject.id}`)
      .join("\n");
    return [
      plan.providerCustomerId,
      "  → no automatic binding",
      "  candidates:",
      candidateLines,
      "  reason:",
      `    ${plan.reason}`,
    ].join("\n");
  }
  const target = plan.subject?.id ?? "no automatic binding";
  return [
    plan.providerCustomerId,
    `  → ${target}`,
    `  confidence: ${plan.confidence}`,
    "  evidence:",
    evidenceLine(plan),
    "  action:",
    `    ${actionLine(plan)}`,
    "  reason:",
    `    ${plan.reason}`,
  ].join("\n");
}

export function formatBillingImportReport(
  report: BillingImportRunReport
): string {
  const summary = [
    report.runId ? `run ID: ${report.runId}` : null,
    report.traceId ? `trace ID: ${report.traceId}` : null,
    `connection: ${report.connectionId}`,
    report.provider
      ? `provider: ${report.provider}${report.environment ? `/${report.environment}` : ""}`
      : null,
    report.pagesProcessed === null ? null : `pages: ${report.pagesProcessed}`,
    `scanned: ${report.customersScanned}`,
    `bound: ${report.bindingsCreated + report.bindingsActivated}`,
    `conflicts: ${report.conflicts}`,
    report.status
      ? `checkpoint: ${report.hasMore ? "checkpointed" : "caught-up"} (${report.status})`
      : null,
  ]
    .filter((line): line is string => line != null)
    .join("\n");
  if (report.plans.length === 0) {
    if (report.pagesProcessed != null || report.traceId) {
      return `${summary}\nNo subject candidates. Email is never auto-merged.`;
    }
    return "No subject candidates. Email is never auto-merged.";
  }
  return `${summary}\n\n${report.plans.map(formatBillingImportPlan).join("\n\n")}`;
}
