import type { AthenaAuthMigrationPlan } from "../../auth/local/schema.ts";
import type { AthenaCliUI } from "../../cli/ui/index.ts";
import { ATHENA_MIGRATE_STATUS_COMMAND } from "../commands.ts";
import { buildMigrationReportView } from "../report.ts";
import type { MigrationRunSummary } from "../types.ts";

export function unknownAuthLedgerDiagnostics(
  authPlan: AthenaAuthMigrationPlan | undefined,
  level: "error" | "warn" = "warn"
): NonNullable<MigrationRunSummary["diagnostics"]> {
  if (!authPlan) {
    return [];
  }
  const unknown = authPlan.entries.filter(
    (entry) => entry.ledgerState === "unknown"
  );
  if (unknown.length === 0) {
    return [];
  }
  return [
    {
      code: "ATHENA_AUTH_LEDGER_UNKNOWN",
      hint: `Run the workspace CLI after building packages/athena-js (\`pnpm exec ${ATHENA_MIGRATE_STATUS_COMMAND}\`). A global or stale \`athena-js\` binary will treat newer generations as unknown.`,
      level,
      message: formatUnknownAuthLedgerError(authPlan),
    },
  ];
}

export function formatUnknownAuthLedgerError(
  authPlan: AthenaAuthMigrationPlan
): string {
  const unknown = authPlan.entries.filter(
    (entry) => entry.ledgerState === "unknown"
  );
  return [
    "Embedded Auth ledger contains generation(s) this CLI does not know:",
    ...unknown.map(
      (entry) => `  ${entry.name} (database version ${entry.version})`
    ),
    "",
    "CI verification (`migrate check` / `migrate drift`) fails closed until this CLI understands that history.",
  ].join("\n");
}

export function hasUnknownAuthGenerations(
  authPlan: AthenaAuthMigrationPlan | undefined
): boolean {
  return Boolean(
    authPlan?.entries.some((entry) => entry.ledgerState === "unknown")
  );
}

export function renderReport(
  ui: AthenaCliUI,
  summary: Pick<
    MigrationRunSummary,
    "providerLabel" | "databaseLabel" | "directory" | "plan" | "mode"
  >,
  authPlan: AthenaAuthMigrationPlan | undefined,
  outcome: string,
  diagnostics: MigrationRunSummary["diagnostics"] = [],
  modules?: import("../../cli/ui/types.ts").MigrationReportView["modules"]
): void {
  const report = buildMigrationReportView({
    authPlan,
    diagnostics,
    logPath: undefined,
    modules,
    outcome,
    summary,
  });
  ui.renderMigrationReport(report);
}
