import type { ReconciliationReport, VersionReconciliation } from "./types.ts";

export function formatVersionReconciliation(
  diagnosis: VersionReconciliation
): string {
  const repo = diagnosis.repository;
  const ledger = diagnosis.ledger;
  const lines = [
    `Version ${diagnosis.version}`,
    "",
    "Repository:",
    repo
      ? `  ${repo.filename}\n  checksum ${repo.checksum.slice(0, 12)}...\n  ${repo.committed ? "committed" : "not committed"}`
      : "  (missing)",
    "",
    "Ledger:",
    ledger
      ? `  ${ledger.name}\n  checksum ${ledger.checksum.slice(0, 12)}...`
      : "  (missing)",
    "",
    "Physical schema:",
    diagnosis.evidence.physicalMatchesRepository
      ? "  matches repository expected postconditions"
      : "  does not fully match repository expected postconditions",
    diagnosis.evidence.physicalMatchesArchive
      ? "  matches archived executed SQL postconditions"
      : "  archived SQL postconditions unavailable or unmatched",
    "",
    "Historical evidence:",
    diagnosis.archive
      ? `  archived checksum ${diagnosis.archive.checksum.slice(0, 12)}...`
      : "  migration source archive unavailable",
    diagnosis.evidence.laterDependenciesSatisfied
      ? "  later migration dependencies are satisfied"
      : "  later migration dependencies are not satisfied",
    "",
    "Classification:",
    `  ${diagnosis.classification}`,
    "",
    "Confidence:",
    `  ${diagnosis.confidence}`,
    "",
    "Recommended repair:",
    `  ${formatAction(diagnosis)}`,
    "",
    diagnosis.confidence === "AMBIGUOUS"
      ? "Automatic repair is unsafe.\n"
      : "",
    "Migration SQL will NOT be executed.",
  ].filter((line) => line !== "");
  return lines.join("\n");
}

export function serializeReconciliationReport(report: ReconciliationReport): string {
  return JSON.stringify(report, null, 2);
}

function formatAction(diagnosis: VersionReconciliation): string {
  const action = diagnosis.action;
  switch (action.kind) {
    case "repair-ledger":
      return `Update ledger checksum for version ${action.version}:\n    ${action.fromChecksum.slice(0, 12)}... → ${action.toChecksum.slice(0, 12)}...`;
    case "restore-local-source":
      return `Restore local source for version ${action.version} from ${action.source}.`;
    case "create-forward-repair":
      return `Create a forward repair migration. Do not rewrite history.\n    ${action.reason}`;
    case "no-op":
      return "No change.";
    case "manual-review":
      return `Manual review required.\n    ${action.reason}`;
  }
}

export function formatReconciliationReport(
  diagnoses: readonly VersionReconciliation[]
): string {
  const body = diagnoses
    .filter((item) => item.classification !== "CONSISTENT")
    .map((item) => formatVersionReconciliation(item))
    .join(`\n\n${"─".repeat(40)}\n\n`);
  return ["Athena migration reconciliation", "", body || "No divergences detected."].join(
    "\n"
  );
}
