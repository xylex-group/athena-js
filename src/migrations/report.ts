import type {
  AthenaAuthMigrationPlan,
  AthenaAuthMigrationPlanEntry,
} from "../auth/local/schema.ts";
import type {
  MigrationDisplayStatus,
  MigrationReportView,
  MigrationRowView,
} from "../cli/ui/types.ts";
import type { MigrationPlan, MigrationRunSummary } from "./types.ts";

function authEntryStatus(
  entry: AthenaAuthMigrationPlanEntry
): MigrationDisplayStatus {
  if (entry.schemaState === "drift") {
    return "drift";
  }
  if (entry.ledgerState === "checksum-mismatch") {
    return "checksum-mismatch";
  }
  if (entry.ledgerState === "unknown") {
    return "unknown";
  }
  if (entry.ledgerState === "absent") {
    return "pending";
  }
  return "applied";
}

function authEntryDetail(
  entry: AthenaAuthMigrationPlanEntry
): string | undefined {
  if (!entry.drift || entry.drift.length === 0) {
    return undefined;
  }
  return entry.drift
    .map((item) => `Missing ${item.kind.replace("missing-", "")}: ${item.object}`)
    .join("\n");
}

export function applicationRowsFromPlan(plan: MigrationPlan): MigrationRowView[] {
  const rows: MigrationRowView[] = [];
  for (const entry of plan.applied) {
    rows.push({ name: entry.migration.filename, status: "applied" });
  }
  for (const conflict of plan.conflicts) {
    if (conflict.kind === "checksum-mismatch") {
      rows.push({
        name:
          conflict.local?.filename ??
          `${String(conflict.version).padStart(4, "0")}_*.sql`,
        status: "checksum-mismatch",
      });
    } else {
      rows.push({
        name: conflict.applied
          ? `${String(conflict.version).padStart(4, "0")}_${conflict.applied.name}`
          : String(conflict.version),
        status: "missing-local",
      });
    }
  }
  for (const entry of plan.pending) {
    rows.push({ name: entry.migration.filename, status: "pending" });
  }
  return rows;
}

export function authRowsFromPlan(
  plan: AthenaAuthMigrationPlan
): MigrationRowView[] {
  return plan.entries.map((entry) => ({
    name: entry.name,
    status: authEntryStatus(entry),
    detail: authEntryDetail(entry),
  }));
}

export function buildMigrationReportView(input: {
  summary: Pick<
    MigrationRunSummary,
    "providerLabel" | "databaseLabel" | "directory" | "plan" | "mode"
  >;
  authPlan?: AthenaAuthMigrationPlan;
  outcome: string;
  logPath?: string;
  diagnostics?: MigrationReportView["diagnostics"];
}): MigrationReportView {
  const applicationRows = applicationRowsFromPlan(input.summary.plan);
  const authRows = input.authPlan
    ? authRowsFromPlan(input.authPlan)
    : [];

  const appApplied = applicationRows.filter((r) => r.status === "applied").length;
  const appPending = applicationRows.filter((r) => r.status === "pending").length;
  const appConflicts = applicationRows.filter(
    (r) =>
      r.status === "checksum-mismatch" ||
      r.status === "missing-local" ||
      r.status === "drift"
  ).length;

  const authApplied = authRows.filter((r) => r.status === "applied").length;
  const authPending = authRows.filter((r) => r.status === "pending").length;
  const authConflicts = authRows.filter(
    (r) =>
      r.status === "drift" ||
      r.status === "checksum-mismatch" ||
      r.status === "failed"
  ).length;

  return {
    title: "Athena migrations",
    target: {
      provider: input.summary.providerLabel,
      database: input.summary.databaseLabel,
      directory: input.summary.directory,
    },
    application: {
      title: "Application",
      rows: applicationRows,
      summary: `${appApplied} applied · ${appPending} pending · ${appConflicts} conflicts`,
    },
    auth: {
      title: "Embedded Auth",
      rows: authRows,
      summary:
        authRows.length === 0
          ? undefined
          : `${authApplied} applied · ${authPending} pending · ${authConflicts} conflicts`,
    },
    outcome: input.outcome,
    diagnostics: input.diagnostics ?? [],
    logPath: input.logPath,
  };
}
