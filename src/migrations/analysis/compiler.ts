import type { MigrationFile } from "../types.ts";
import { analyzeMigrationFile } from "./analyzer.ts";
import { cacheKey, loadAnalysisCache, saveAnalysisCache } from "./cache.ts";
import type { PhysicalCatalog } from "./catalog.ts";
import { emptyPhysicalCatalog } from "./catalog.ts";
import { buildMigrationGraph, type MigrationGraph } from "./dependency-graph.ts";
import {
  formatDiagnostic,
  type MigrationDiagnostic,
} from "./diagnostics.ts";
import {
  applyAnalysis,
  applyEffects,
  cloneProjectedSchema,
  emptyProjectedSchema,
  fingerprintProjectedSchema,
  type ProjectedSchema,
} from "./projected-schema.ts";
import type { MigrationAnalysis } from "./semantic-ir.ts";
import {
  blockingDiagnostics,
  verifyAppliedDrift,
  verifyMigrationAgainstSchema,
} from "./verifier.ts";

export interface CompileMigrationsInput {
  appliedVersions: ReadonlySet<number>;
  cacheDir?: string;
  catalog?: PhysicalCatalog;
  files: readonly MigrationFile[];
  strict?: boolean;
}

export interface CompileMigrationsResult {
  analyses: MigrationAnalysis[];
  diagnostics: MigrationDiagnostic[];
  expectedApplied: ProjectedSchema;
  fingerprint: string;
  graph: MigrationGraph;
  physical: ProjectedSchema;
  projectedFinal: ProjectedSchema;
}

export async function analyzeAll(
  files: readonly MigrationFile[],
  cacheDir?: string
): Promise<MigrationAnalysis[]> {
  const cache = cacheDir ? await loadAnalysisCache(cacheDir) : new Map();
  const analyses: MigrationAnalysis[] = [];
  for (const file of files) {
    const key = cacheKey(file.checksum, file.filename);
    const hit = cache.get(key);
    if (hit) {
      analyses.push(hit);
      continue;
    }
    analyses.push(await analyzeMigrationFile(file));
  }
  if (cacheDir) {
    await saveAnalysisCache(cacheDir, analyses);
  }
  return analyses;
}

export async function compileMigrations(
  input: CompileMigrationsInput
): Promise<CompileMigrationsResult> {
  const analyses = await analyzeAll(input.files, input.cacheDir);
  const catalog = input.catalog ?? emptyPhysicalCatalog();
  const physical = catalog.schema;
  const appliedAnalyses = analyses.filter((item) =>
    input.appliedVersions.has(item.version)
  );
  const pendingAnalyses = analyses.filter(
    (item) => !input.appliedVersions.has(item.version)
  );

  let expectedApplied = emptyProjectedSchema();
  for (const analysis of appliedAnalyses) {
    expectedApplied = applyAnalysis(expectedApplied, analysis);
  }

  const diagnostics: MigrationDiagnostic[] = [
    ...verifyAppliedDrift(appliedAnalyses, physical),
  ];

  let projected = cloneProjectedSchema(physical);
  for (const analysis of pendingAnalyses) {
    for (const statement of analysis.statements) {
      diagnostics.push(
        ...verifyMigrationAgainstSchema({
          analysis,
          analyses,
          appliedVersions: input.appliedVersions,
          dependencies: statement.dependencies,
          projected,
        })
      );
      projected = applyEffects(projected, statement.effects);
    }
  }

  let projectedFinal = cloneProjectedSchema(physical);
  for (const analysis of analyses) {
    if (!input.appliedVersions.has(analysis.version)) {
      projectedFinal = applyAnalysis(projectedFinal, analysis);
    }
  }
  // Applied effects are assumed in physical; pending layered on top.
  // Also compute empty-replay final for fingerprint of intent.
  let intent = emptyProjectedSchema();
  for (const analysis of analyses) {
    intent = applyAnalysis(intent, analysis);
  }

  return {
    analyses,
    diagnostics: blockingDiagnostics(diagnostics, Boolean(input.strict)),
    expectedApplied,
    fingerprint: fingerprintProjectedSchema(intent),
    graph: buildMigrationGraph(analyses),
    physical,
    projectedFinal,
  };
}

export function formatPreflightFailure(
  diagnostics: readonly MigrationDiagnostic[]
): string {
  const blocking = diagnostics.filter(
    (item) => item.classification !== "dynamic_sql"
  );
  const primary = blocking[0] ?? diagnostics[0];
  if (!primary) {
    return "Migration preflight failed.";
  }
  return [
    "Migration preflight failed",
    "",
    formatDiagnostic(primary),
    "",
    "No migrations were executed.",
  ].join("\n");
}

export function explainMigration(analysis: MigrationAnalysis): string {
  const creates = analysis.effects.creates.map((object) => `  ${object.kind} ${object.kind === "schema" || object.kind === "extension" ? object.name : `${"schema" in object ? object.schema + "." : ""}${"table" in object && object.kind === "column" ? object.table + "." : ""}${"name" in object ? object.name : ""}`}`);
  const reads = [
    ...new Set(
      analysis.dependencies
        .filter((item) => item.category === "REQUIRES_TABLE" || item.category === "READS")
        .map((item) => formatObjectLine(item.object))
    ),
  ];
  const columns = [
    ...new Set(
      analysis.dependencies
        .filter((item) => item.category === "REQUIRES_COLUMN")
        .map((item) => formatObjectLine(item.object))
    ),
  ];
  return [
    `Explain ${analysis.filename}`,
    "",
    `creates (${analysis.effects.creates.length})`,
    ...creates.slice(0, 40),
    "",
    `tables read (${reads.length})`,
    ...reads.slice(0, 40).map((line) => `  ${line}`),
    "",
    `columns read (${columns.length})`,
    ...columns.slice(0, 40).map((line) => `  ${line}`),
    "",
    analysis.warnings.length > 0 ? `warnings\n${analysis.warnings.map((w) => `  ${w}`).join("\n")}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function formatObjectLine(object: MigrationAnalysis["dependencies"][number]["object"]): string {
  if (object.kind === "schema" || object.kind === "extension") {
    return object.name;
  }
  if (object.kind === "column") {
    return `${object.schema}.${object.table}.${object.name}`;
  }
  return `${object.schema}.${object.name}`;
}
