import { formatObjectRef, objectKey, type SchemaObjectRef } from "./ast.ts";
import {
  DIAGNOSTIC_CODES,
  type DriftClassification,
  type MigrationDiagnostic,
} from "./diagnostics.ts";
import {
  applyAnalysis,
  cloneProjectedSchema,
  missingObjects,
  type ProjectedSchema,
  schemaHas,
} from "./projected-schema.ts";
import type { MigrationAnalysis, SemanticDependency } from "./semantic-ir.ts";

const BUILTIN_FUNCTIONS = new Set([
  "now",
  "greatest",
  "coalesce",
  "nullif",
  "btrim",
  "lower",
  "upper",
  "left",
  "trim",
  "replace",
  "length",
  "jsonb_array_length",
  "jsonb_array_elements",
  "jsonb_typeof",
  "sum",
  "count",
  "max",
  "min",
  "avg",
  "gen_random_uuid",
  "format",
  "pg_advisory_lock",
  "current_timestamp",
]);

const SKIP_KINDS = new Set(["READS", "WRITES", "REFERENCES", "RETURNS", "CASTS_TO", "INVOKES"]);

export interface ProviderHit {
  analysis: MigrationAnalysis;
}

export function findProvider(
  analyses: readonly MigrationAnalysis[],
  object: SchemaObjectRef
): MigrationAnalysis | undefined {
  const key = objectKey(object);
  for (const analysis of analyses) {
    for (const created of analysis.effects.creates) {
      if (objectKey(created) === key) {
        return analysis;
      }
    }
    for (const mutation of analysis.effects.modifies) {
      if (mutation.kind === "add_column" && objectKey(mutation.object) === key) {
        return analysis;
      }
    }
  }
  return undefined;
}

function shouldCheck(dependency: SemanticDependency): boolean {
  if (dependency.confidence === "dynamic") {
    return false;
  }
  if (SKIP_KINDS.has(dependency.category) && dependency.category !== "REQUIRES_FUNCTION") {
    return dependency.category.startsWith("REQUIRES_");
  }
  if (
    dependency.object.kind === "function" &&
    BUILTIN_FUNCTIONS.has(dependency.object.name)
  ) {
    return false;
  }
  if (dependency.object.kind === "table" && dependency.object.name === "<dynamic>") {
    return false;
  }
  return (
    dependency.category === "REQUIRES_TABLE" ||
    dependency.category === "REQUIRES_COLUMN" ||
    dependency.category === "REQUIRES_SCHEMA" ||
    dependency.category === "REQUIRES_FUNCTION" ||
    dependency.category === "REQUIRES_TYPE" ||
    dependency.category === "REQUIRES_EXTENSION"
  );
}

export interface VerifyMigrationInput {
  analysis: MigrationAnalysis;
  analyses: readonly MigrationAnalysis[];
  appliedVersions: ReadonlySet<number>;
  projected: ProjectedSchema;
}

export function verifyMigrationAgainstSchema(
  input: VerifyMigrationInput & { dependencies?: SemanticDependency[] }
): MigrationDiagnostic[] {
  const diagnostics: MigrationDiagnostic[] = [];
  const requiredBy = input.analysis.statements
    .map((statement) =>
      statement.object ? formatObjectRef(statement.object) : undefined
    )
    .find(Boolean);
  const dependencies = input.dependencies ?? input.analysis.dependencies;

  for (const dependency of dependencies) {
    if (dependency.confidence === "dynamic") {
      diagnostics.push({
        classification: "dynamic_sql",
        code: DIAGNOSTIC_CODES.DYNAMIC,
        confidence: "dynamic",
        message: `Dynamic SQL detected in ${input.analysis.filename}`,
        object: dependency.object,
        requiredBy,
        snippet: dependency.snippet,
      });
      continue;
    }
    if (!shouldCheck(dependency)) {
      continue;
    }
    if (schemaHas(input.projected, dependency.object)) {
      continue;
    }
    const provider = findProvider(input.analyses, dependency.object);
    let classification: DriftClassification = "missing_dependency";
    let ledgerState: MigrationDiagnostic["ledgerState"] = "missing";
    if (provider) {
      if (provider.version > input.analysis.version) {
        classification = "ordering";
        ledgerState = input.appliedVersions.has(provider.version)
          ? "applied"
          : "pending";
      } else if (input.appliedVersions.has(provider.version)) {
        classification = "physical_schema_drift";
        ledgerState = "applied";
      } else {
        classification = "ordering";
        ledgerState = "pending";
      }
    }
    const isColumn = dependency.object.kind === "column";
    diagnostics.push({
      classification,
      code:
        classification === "physical_schema_drift"
          ? DIAGNOSTIC_CODES.DRIFT
          : classification === "ordering"
            ? DIAGNOSTIC_CODES.ORDER
            : isColumn
              ? DIAGNOSTIC_CODES.COL_MISSING
              : DIAGNOSTIC_CODES.DEP_MISSING,
      confidence: dependency.confidence,
      expectedProvider: provider
        ? { filename: provider.filename, version: provider.version }
        : undefined,
      ledgerState,
      location: dependency.location,
      message:
        classification === "physical_schema_drift"
          ? `${input.analysis.filename} requires ${formatObjectRef(dependency.object)} but the providing migration is marked applied while the object is absent.`
          : `${input.analysis.filename} requires ${formatObjectRef(dependency.object)} which is not in the projected schema.`,
      object: dependency.object,
      physicalState: "missing",
      requiredBy,
      snippet: dependency.snippet,
    });
  }
  return diagnostics;
}

export function verifyAppliedDrift(
  appliedAnalyses: readonly MigrationAnalysis[],
  physical: ProjectedSchema
): MigrationDiagnostic[] {
  let expected = cloneProjectedSchema({
    extensions: new Set(),
    functions: new Set(),
    schemas: new Set(["public", "pg_catalog"]),
    tables: new Map(),
    types: new Set(),
    views: new Set(),
  });
  for (const analysis of appliedAnalyses) {
    expected = applyAnalysis(expected, analysis);
  }
  const missing = missingObjects(expected, physical);
  const diagnostics: MigrationDiagnostic[] = [];
  for (const object of missing) {
    const provider = findProvider(appliedAnalyses, object);
    diagnostics.push({
      classification: "physical_schema_drift",
      code: DIAGNOSTIC_CODES.DRIFT,
      expectedProvider: provider
        ? { filename: provider.filename, version: provider.version }
        : undefined,
      ledgerState: "applied",
      message: provider
        ? `${provider.filename} is marked applied but ${formatObjectRef(object)} is absent from the physical database.`
        : `Expected ${formatObjectRef(object)} is absent from the physical database.`,
      object,
      physicalState: "missing",
    });
  }
  return diagnostics;
}

export function blockingDiagnostics(
  diagnostics: readonly MigrationDiagnostic[],
  strict: boolean
): MigrationDiagnostic[] {
  return diagnostics.filter((item) => {
    if (item.classification === "dynamic_sql") {
      return strict;
    }
    return true;
  });
}
