import { formatObjectRef, objectKey, type SchemaObjectRef } from "./ast.ts";
import {
  DIAGNOSTIC_CODES,
  type DriftClassification,
  type MigrationDiagnostic,
} from "./diagnostics.ts";
import {
  applyAnalysis,
  emptyProjectedSchema,
  missingObjects,
  type ProjectedSchema,
  schemaHas,
} from "./projected-schema.ts";
import { findSchemaProvider, type SchemaProvider } from "./schema-provider.ts";
import type { MigrationAnalysis, SemanticDependency } from "./semantic-ir.ts";

const SKIP_KINDS = new Set([
  "READS",
  "WRITES",
  "REFERENCES",
  "RETURNS",
  "CASTS_TO",
  "INVOKES",
]);

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
      if (
        mutation.kind === "add_column" &&
        objectKey(mutation.object) === key
      ) {
        return analysis;
      }
    }
  }
}

function shouldCheck(dependency: SemanticDependency): boolean {
  if (
    dependency.confidence === "dynamic" ||
    dependency.confidence === "unknown"
  ) {
    return false;
  }
  if (
    dependency.resolution === "cte" ||
    dependency.resolution === "unverified"
  ) {
    return false;
  }
  if (SKIP_KINDS.has(dependency.category)) {
    return false;
  }
  if (
    dependency.object.kind === "table" &&
    dependency.object.name.startsWith("<")
  ) {
    return false;
  }
  if (
    dependency.object.kind === "function" &&
    (dependency.resolution === "search_path" ||
      dependency.resolution === "catalog_builtin" ||
      !dependency.object.schema ||
      dependency.object.schema === "pg_catalog")
  ) {
    return false;
  }
  return (
    dependency.category === "REQUIRES_TABLE" ||
    dependency.category === "REQUIRES_COLUMN" ||
    dependency.category === "REQUIRES_SCHEMA" ||
    dependency.category === "REQUIRES_FUNCTION" ||
    dependency.category === "REQUIRES_TYPE" ||
    dependency.category === "REQUIRES_EXTENSION" ||
    dependency.category === "REQUIRES_SEQUENCE"
  );
}

function parentTableMissing(
  projected: ProjectedSchema,
  dependency: SemanticDependency
): boolean {
  if (dependency.object.kind !== "column") {
    return false;
  }
  return !schemaHas(projected, {
    kind: "table",
    name: dependency.object.table,
    schema: dependency.object.schema,
  });
}

export interface VerifyMigrationInput {
  analyses: readonly MigrationAnalysis[];
  analysis: MigrationAnalysis;
  appliedVersions: ReadonlySet<number>;
  externalProviders?: readonly SchemaProvider[];
  projected: ProjectedSchema;
}

export function verifyMigrationAgainstSchema(
  input: VerifyMigrationInput & { dependencies?: SemanticDependency[] }
): MigrationDiagnostic[] {
  const diagnostics: MigrationDiagnostic[] = [];
  const dependencies = input.dependencies ?? input.analysis.dependencies;

  for (const dependency of dependencies) {
    if (dependency.confidence === "dynamic") {
      diagnostics.push({
        classification: "dynamic_sql",
        code: DIAGNOSTIC_CODES.DYNAMIC,
        confidence: "dynamic",
        message: `Dynamic SQL detected in ${input.analysis.filename}`,
        object: dependency.object,
        requiredBy: dependency.owner
          ? formatObjectRef(dependency.owner)
          : undefined,
        snippet: dependency.snippet,
        statementIndex: dependency.statementIndex,
      });
      continue;
    }
    if (
      !shouldCheck(dependency) ||
      parentTableMissing(input.projected, dependency)
    ) {
      continue;
    }
    if (schemaHas(input.projected, dependency.object)) {
      continue;
    }
    const packaged = findSchemaProvider(
      input.externalProviders ?? [],
      dependency.object
    );
    if (packaged?.state === "pending") {
      continue;
    }
    const provider = findProvider(input.analyses, dependency.object);
    const declared = (input.analysis.declaredRequires ?? []).some(
      (item) => objectKey(item) === objectKey(dependency.object)
    );
    let classification: DriftClassification = declared
      ? "baseline_prerequisite"
      : "missing_dependency";
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
            : classification === "baseline_prerequisite"
              ? DIAGNOSTIC_CODES.BASELINE
              : isColumn
                ? DIAGNOSTIC_CODES.COL_MISSING
                : DIAGNOSTIC_CODES.DEP_MISSING,
      confidence: dependency.confidence,
      expectedProvider: provider
        ? { filename: provider.filename, version: provider.version }
        : packaged
          ? { filename: packaged.filename, version: packaged.version }
          : undefined,
      expectedSource: provider
        ? "migration"
        : packaged
          ? "embedded"
          : declared
            ? "baseline"
            : "unknown",
      ledgerState,
      location: dependency.location,
      message:
        classification === "physical_schema_drift"
          ? `${input.analysis.filename} requires ${formatObjectRef(dependency.object)} but the providing migration is marked applied while the object is absent.`
          : classification === "baseline_prerequisite"
            ? `${input.analysis.filename} declares baseline prerequisite ${formatObjectRef(dependency.object)} which is not in the projected schema.`
            : `${input.analysis.filename} requires ${formatObjectRef(dependency.object)} which is not in the projected schema.`,
      object: dependency.object,
      physicalState: "missing",
      requiredBy: dependency.owner
        ? formatObjectRef(dependency.owner)
        : undefined,
      snippet: dependency.snippet,
      statementIndex: dependency.statementIndex,
    });
  }
  return diagnostics;
}

export function verifyAppliedDrift(
  appliedAnalyses: readonly MigrationAnalysis[],
  physical: ProjectedSchema
): MigrationDiagnostic[] {
  let expected = emptyProjectedSchema();
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
      expectedSource: provider ? "migration" : "unknown",
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
    if (
      item.classification === "dynamic_sql" ||
      item.classification === "unresolved_search_path" ||
      item.classification === "unverified"
    ) {
      return strict;
    }
    return true;
  });
}
