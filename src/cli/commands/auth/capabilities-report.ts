import { ATHENA_AUTH_SCHEMA_GENERATION } from "../../../auth/contract/index.ts";
import { ATHENA_AUTH_OPERATIONS } from "../../../auth/contract/operations.generated.ts";
import type { AthenaAuthOperationDefinition } from "../../../auth/contract/operations.ts";
import { resolveCliCapabilities } from "../../ui/capabilities.ts";
import { paint } from "../../ui/colors.ts";
import { frameBlock } from "../../ui/rail.ts";
import type { CliCapabilities } from "../../ui/types.ts";

export type AuthRuntimeSupportMark = "yes" | "partial" | "no";

export interface AuthCapabilityRow {
  capability: string;
  embedded: AuthRuntimeSupportMark;
  rust: AuthRuntimeSupportMark;
}

const CAPABILITY_ORDER = [
  "password",
  "organizations",
  "invitations",
  "apiKeys",
  "twoFactor",
  "passkeys",
  "social",
  "jwt",
  "oidc",
] as const;

function mark(
  operations: readonly AthenaAuthOperationDefinition[],
  side: "rust" | "embedded"
): AuthRuntimeSupportMark {
  const portable = operations.filter(
    (operation) => operation.nonportable !== true
  );
  if (portable.length === 0) {
    return "no";
  }
  const supported = portable.filter(
    (operation) => operation[side] === "supported"
  );
  if (supported.length === portable.length) {
    return "yes";
  }
  if (supported.length === 0) {
    return "no";
  }
  return "partial";
}

export function buildAuthCapabilityMatrix(
  operations: readonly AthenaAuthOperationDefinition[] = ATHENA_AUTH_OPERATIONS
): AuthCapabilityRow[] {
  const seen = new Set<string>();
  const rows: AuthCapabilityRow[] = [];
  const ordered = [
    ...CAPABILITY_ORDER,
    ...operations.map((operation) => operation.capability),
  ];
  for (const capability of ordered) {
    if (seen.has(capability)) {
      continue;
    }
    seen.add(capability);
    const subset = operations.filter(
      (operation) => operation.capability === capability
    );
    if (subset.length === 0) {
      continue;
    }
    rows.push({
      capability,
      embedded: mark(subset, "embedded"),
      rust: mark(subset, "rust"),
    });
  }
  return rows;
}

function glyph(value: AuthRuntimeSupportMark): string {
  if (value === "yes") {
    return "✓";
  }
  if (value === "partial") {
    return "partial";
  }
  return "no";
}

function markColor(value: AuthRuntimeSupportMark): "green" | "yellow" | "dim" {
  if (value === "yes") {
    return "green";
  }
  if (value === "partial") {
    return "yellow";
  }
  return "dim";
}

export function formatAuthCapabilityMatrix(
  rows: readonly AuthCapabilityRow[] = buildAuthCapabilityMatrix(),
  capabilities: CliCapabilities = resolveCliCapabilities({ plain: true }),
  options: { framed?: boolean } = {}
): string {
  const lines = [
    paint("Athena Auth capabilities", "bold", capabilities),
    "",
    `${paint("Embedded schema generation", "dim", capabilities)}  ${paint(String(ATHENA_AUTH_SCHEMA_GENERATION), "cyan", capabilities)}`,
    "",
    paint("Capability          Embedded       Rust", "dim", capabilities),
  ];
  for (const row of rows) {
    const name = row.capability.padEnd(19);
    const embedded = paint(
      glyph(row.embedded).padEnd(14),
      markColor(row.embedded),
      capabilities
    );
    const rust = paint(glyph(row.rust), markColor(row.rust), capabilities);
    lines.push(`${name} ${embedded} ${rust}`);
  }
  const body = `${lines.join("\n")}\n`;
  if (options.framed === false) {
    return body;
  }
  return `${frameBlock(body.trimEnd(), capabilities)}\n`;
}
