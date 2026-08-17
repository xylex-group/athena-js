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
    case "drift":
      return "!";
    case "checksum-mismatch":
    case "failed":
    case "missing-local":
      return "✗";
    case "skipped":
      return "–";
    default:
      return "?";
  }
}

export function statusLabel(
  status: MigrationDisplayStatus,
  interactive: boolean
): string {
  if (!interactive) {
    return `[${status}]`;
  }
  return `${statusSymbol(status, true)} ${status}`;
}
