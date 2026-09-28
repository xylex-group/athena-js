import type { MigrationConflict, MigrationPlan } from "../types.ts";

export function formatConflictBlock(plan: MigrationPlan): string {
  const lines: string[] = [];
  for (const conflict of plan.conflicts) {
    lines.push(formatConflict(conflict));
  }
  return lines.join("\n\n");
}

function formatConflict(conflict: MigrationConflict): string {
  switch (conflict.kind) {
    case "checksum-mismatch": {
      const filename =
        conflict.local?.filename ??
        `${String(conflict.version).padStart(4, "0")}_${conflict.applied?.name ?? "unknown"}.sql`;
      return [
        "Migration integrity error",
        "",
        `${filename} was already applied but its contents have changed.`,
        "",
        `  Stored    ${conflict.applied?.checksum ?? "(missing)"}`,
        `  Current   ${conflict.local?.checksum ?? "(missing local file)"}`,
        "",
        "Applied migrations are immutable.",
        "Create a new forward migration instead of editing an applied file.",
      ].join("\n");
    }
    case "missing-local": {
      const label = conflict.applied
        ? `${String(conflict.version).padStart(4, "0")}_${conflict.applied.name}`
        : String(conflict.version).padStart(4, "0");
      return [
        "Migration history conflict",
        "",
        `Database contains migration ${label}`,
        "but no matching local migration exists.",
        "",
        "Refusing to continue because this checkout is older than the database migration history.",
      ].join("\n");
    }
    case "name-mismatch":
      return [
        "Migration identity changed",
        "",
        `Version ${conflict.version} checksum matches, but the name changed.`,
        "",
        `  Ledger   ${conflict.applied?.name ?? "(unknown)"}`,
        `  Local    ${conflict.local?.name ?? "(unknown)"}`,
        "",
        "Do not rename applied migrations. Add a new forward migration instead.",
      ].join("\n");
    case "historical-insertion":
      return [
        "Historical migration insertion refused",
        "",
        `${conflict.local?.filename ?? conflict.version} is a new local version`,
        "below an already-applied migration.",
        "",
        "Inserting migrations into published history is not allowed.",
        "Use a version greater than the current ledger tip.",
      ].join("\n");
    case "duplicate-version":
      return [
        "Duplicate migration version",
        "",
        `Version ${conflict.version} appears more than once in history.`,
      ].join("\n");
    default: {
      const _exhaustive: never = conflict.kind;
      return _exhaustive;
    }
  }
}
