import {
  formatObjectRef,
  type SchemaObjectRef,
  type SqlSourceLocation,
} from "./ast.ts";
import type { DependencyConfidence } from "./semantic-ir.ts";

export type DriftClassification =
  | "physical_schema_drift"
  | "missing_dependency"
  | "baseline_prerequisite"
  | "ordering"
  | "dropped_before_use"
  | "dynamic_sql"
  | "unresolved_search_path"
  | "unverified"
  | "parse_error";

export interface MigrationDiagnostic {
  classification: DriftClassification;
  code: string;
  confidence?: DependencyConfidence;
  expectedProvider?: {
    filename: string;
    version: number;
  };
  expectedSource?: "baseline" | "migration" | "embedded" | "unknown";
  ledgerState?: "applied" | "pending" | "missing";
  location?: SqlSourceLocation;
  message: string;
  object: SchemaObjectRef;
  physicalState?: "present" | "missing";
  requiredBy?: string;
  snippet?: string;
  statementIndex?: number;
}

export const DIAGNOSTIC_CODES = {
  BASELINE: "ATHENA-MIG-DEP-003",
  COL_MISSING: "ATHENA-MIG-DEP-002",
  DEP_MISSING: "ATHENA-MIG-DEP-001",
  DRIFT: "ATHENA-MIG-DRIFT-001",
  DYNAMIC: "ATHENA-MIG-DYN-001",
  ORDER: "ATHENA-MIG-ORD-001",
  PARSE: "ATHENA-MIG-PARSE-001",
  PREFLIGHT: "ATHENA-MIG-PREFLIGHT",
} as const;

export function formatDiagnostic(diagnostic: MigrationDiagnostic): string {
  const lines = [`ERROR ${diagnostic.code}`, "", diagnostic.message];
  if (diagnostic.location) {
    lines.push(
      "",
      `${diagnostic.location.filename}:${diagnostic.location.start.line}:${diagnostic.location.start.column}`
    );
  }
  if (diagnostic.snippet) {
    lines.push("", diagnostic.snippet);
  }
  lines.push(
    "",
    "Missing dependency:",
    `  ${formatObjectRef(diagnostic.object)}`
  );
  if (diagnostic.requiredBy) {
    lines.push("", "Statement:", `  ${diagnostic.requiredBy}`);
  }
  if (diagnostic.expectedSource) {
    lines.push(
      "",
      "Expected source:",
      diagnostic.expectedSource === "migration" && diagnostic.expectedProvider
        ? `  earlier migration ${diagnostic.expectedProvider.filename}`
        : diagnostic.expectedSource === "baseline"
          ? "  existing database prerequisite"
          : diagnostic.expectedSource === "embedded"
            ? "  Embedded Auth migration"
            : `  ${diagnostic.expectedSource}`
    );
  }
  if (diagnostic.expectedProvider) {
    lines.push(
      "",
      "Expected provider:",
      `  ${diagnostic.expectedProvider.filename}`
    );
  }
  if (diagnostic.ledgerState) {
    lines.push(`Ledger: ${diagnostic.ledgerState}`);
  }
  if (diagnostic.physicalState) {
    lines.push(`Physical database: ${diagnostic.physicalState}`);
  }
  if (diagnostic.classification) {
    lines.push(
      "",
      "Classification:",
      `  ${diagnostic.classification.replaceAll("_", " ")}`
    );
  }
  return lines.join("\n");
}
