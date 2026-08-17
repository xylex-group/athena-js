import type { CliCapabilities } from "./types.ts";
import type { MigrationDisplayStatus } from "./types.ts";

const ANSI = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
} as const;

export function paint(
  text: string,
  color: keyof typeof ANSI | "none",
  capabilities: CliCapabilities
): string {
  if (!capabilities.color || color === "none" || color === "reset") {
    return text;
  }
  return `${ANSI[color]}${text}${ANSI.reset}`;
}

export function statusColor(
  status: MigrationDisplayStatus
): keyof typeof ANSI | "none" {
  switch (status) {
    case "applied":
    case "repaired":
      return "green";
    case "pending":
    case "drift":
      return "yellow";
    case "applying":
      return "cyan";
    case "checksum-mismatch":
    case "failed":
    case "missing-local":
      return "red";
    case "skipped":
    case "unknown":
      return "dim";
    default:
      return "none";
  }
}
