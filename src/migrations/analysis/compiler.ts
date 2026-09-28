import type { MigrationFile } from "../types.ts";
import { analyzeMigrationFile } from "./analyzer.ts";
import { formatObjectRef, objectKey } from "./ast.ts";
import { cacheKey, loadAnalysisCache, saveAnalysisCache } from "./cache.ts";
import type { PhysicalCatalog } from "./catalog.ts";
import { emptyPhysicalCatalog } from "./catalog.ts";
import {
  buildMigrationGraph,
  type MigrationGraph,
} from "./dependency-graph.ts";
import { formatDiagnostic, type MigrationDiagnostic } from "./diagnostics.ts";
import {
  applyAnalysis,
  applyEffects,
  cloneProjectedSchema,
  emptyProjectedSchema,
  fingerprintProjectedSchema,
  mergeProjectedSchemas,
  type ProjectedSchema,
} from "./projected-schema.ts";
import type { SchemaProvider } from "./schema-provider.ts";
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
  externalProviders?: readonly SchemaProvider[];
  files: readonly MigrationFile[];
  projectedPrerequisites?: ProjectedSchema;
  strict?: boolean;
}

export interface CompileMigrationsResult {
  analyses: MigrationAnalysis[];
  diagnostics: MigrationDiagnostic[];
  expectedApplied: ProjectedSchema;
  fingerprint: string;
  graph: MigrationGraph;
  packagedProviders: readonly SchemaProvider[];
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
  if (input.projectedPrerequisites) {
    projected = mergeProjectedSchemas(projected, input.projectedPrerequisites);
  }
  for (const analysis of pendingAnalyses) {
    if (analysis.declaredRequires && analysis.declaredRequires.length > 0) {
      diagnostics.push(
        ...verifyMigrationAgainstSchema({
          analyses,
          analysis,
          appliedVersions: input.appliedVersions,
          dependencies: analysis.declaredRequires.map((object) => ({
            category: "REQUIRES_TABLE" as const,
            confidence: "certain" as const,
            expectedSource: "baseline" as const,
            explicitlyQualified: "schema" in object && Boolean(object.schema),
            object,
            resolution: "exact" as const,
          })),
          externalProviders: input.externalProviders,
          projected,
        })
      );
    }
    for (const statement of analysis.statements) {
      diagnostics.push(
        ...verifyMigrationAgainstSchema({
          analyses,
          analysis,
          appliedVersions: input.appliedVersions,
          dependencies: statement.dependencies,
          externalProviders: input.externalProviders,
          projected,
        })
      );
      projected = applyEffects(projected, statement.effects);
    }
  }

  let projectedFinal = cloneProjectedSchema(physical);
  if (input.projectedPrerequisites) {
    projectedFinal = mergeProjectedSchemas(
      projectedFinal,
      input.projectedPrerequisites
    );
  }
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
    packagedProviders: input.externalProviders ?? [],
    physical,
    projectedFinal,
  };
}

function groupDiagnostics(
  items: readonly MigrationDiagnostic[]
): Array<{ count: number; diagnostic: MigrationDiagnostic }> {
  const grouped = new Map<
    string,
    { count: number; diagnostic: MigrationDiagnostic }
  >();
  for (const item of items) {
    const key = `${item.code}:${objectKey(item.object)}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    grouped.set(key, { count: 1, diagnostic: item });
  }
  return [...grouped.values()];
}

export function formatPreflightFailure(
  diagnostics: readonly MigrationDiagnostic[]
): string {
  const blocking = diagnostics.filter(
    (item) =>
      item.classification !== "dynamic_sql" &&
      item.classification !== "unresolved_search_path" &&
      item.classification !== "unverified"
  );
  if (blocking.length === 0) {
    return "Migration preflight failed.";
  }
  const byFile = new Map<string, MigrationDiagnostic[]>();
  for (const item of blocking) {
    const filename = item.location?.filename ?? item.message;
    const list = byFile.get(filename) ?? [];
    list.push(item);
    byFile.set(filename, list);
  }
  const grouped: string[] = [];
  for (const [filename, items] of byFile) {
    const unique = groupDiagnostics(items);
    grouped.push(filename);
    grouped.push(
      `  ${items.length} blocking finding(s) · ${unique.length} unique`
    );
    for (const { count, diagnostic } of unique) {
      const multiplier = count > 1 ? `${count}× ` : "";
      grouped.push(
        `  ${multiplier}${diagnostic.code}: ${formatObjectRef(diagnostic.object)}`
      );
    }
    grouped.push("");
  }
  const primary = blocking[0];
  return [
    "Migration preflight failed",
    "",
    `${blocking.length} blocking finding(s)`,
    "",
    ...grouped,
    formatDiagnostic(primary),
    "",
    "No migrations were executed.",
  ].join("\n");
}

export function explainMigration(
  analysis: MigrationAnalysis,
  packagedProviders: readonly SchemaProvider[] = []
): string {
  const creates = analysis.effects.creates.map(
    (object) =>
      `  ${object.kind} ${object.kind === "schema" || object.kind === "extension" ? object.name : `${"schema" in object ? object.schema + "." : ""}${"table" in object && object.kind === "column" ? object.table + "." : ""}${"name" in object ? object.name : ""}`}`
  );
  const reads = [
    ...new Set(
      analysis.dependencies
        .filter(
          (item) =>
            item.category === "REQUIRES_TABLE" || item.category === "READS"
        )
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
  const packaged = [
    ...new Set(
      analysis.dependencies
        .filter((item) => item.object.kind === "table")
        .flatMap((item) => {
          const provider = packagedProviders.find(
            (candidate) =>
              objectKey(candidate.object) === objectKey(item.object)
          );
          if (!provider) {
            return [];
          }
          const label =
            provider.source === "embedded-auth"
              ? "Embedded Auth"
              : provider.source === "embedded-chat"
                ? "Embedded Chat"
                : provider.source === "embedded-event-ingress"
                  ? "Embedded Event Ingress"
                  : provider.source === "embedded-billing"
                    ? "Embedded Billing"
                    : provider.source;
          return [
            `  ${formatObjectLine(item.object)} provided by ${label} ${provider.filename}`,
          ];
        })
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
    packaged.length > 0 ? "" : "",
    packaged.length > 0 ? "packaged providers" : "",
    ...packaged.slice(0, 40),
    "",
    analysis.warnings.length > 0
      ? `warnings\n${analysis.warnings.map((w) => `  ${w}`).join("\n")}`
      : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function formatObjectLine(
  object: MigrationAnalysis["dependencies"][number]["object"]
): string {
  if (object.kind === "schema" || object.kind === "extension") {
    return object.name;
  }
  if (object.kind === "column") {
    return `${object.schema}.${object.table}.${object.name}`;
  }
  return `${object.schema}.${object.name}`;
}
