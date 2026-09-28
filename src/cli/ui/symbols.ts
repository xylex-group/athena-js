import type { MigrationDisplayStatus } from "./types.ts";

export function statusSymbol(
  status: MigrationDisplayStatus,
  interactive: boolean
): string {
  if (!interactive) {
    return `[${status}]`;
  }
  switch (status) {
    case "applied":
    case "repaired":
      return "✓";
    case "pending":
      return "○";
    case "applying":
      return "◐";
    case "legacy-compatible":
    case "drift":
      return "!";
    case "checksum-mismatch":
    case "failed":
    case "missing-local":
    case "name-mismatch":
    case "historical-insertion":
      return "✗";
    case "skipped":
      return "–";
    default:
      return "?";
  }
}

export function statusPhrase(status: MigrationDisplayStatus): string {
  switch (status) {
    case "checksum-mismatch":
      return "checksum mismatch";
    case "legacy-compatible":
      return "legacy ledger identity";
    case "missing-local":
      return "missing locally";
    case "name-mismatch":
      return "name mismatch";
    case "historical-insertion":
      return "historical insertion";
    default:
      return status;
  }
}

export function statusLabel(
  status: MigrationDisplayStatus,
  interactive: boolean
): string {
  if (!interactive) {
    return `[${status}]`;
  }
  return `${statusSymbol(status, true)} ${statusPhrase(status)}`;
}
