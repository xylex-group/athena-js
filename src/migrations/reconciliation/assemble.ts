import { analyzeMigrationFile } from "../analysis/analyzer.ts";
import { objectKey } from "../analysis/ast.ts";
import {
  type ProjectedSchema,
  schemaHas,
} from "../analysis/projected-schema.ts";
import type { MigrationAnalysis } from "../analysis/semantic-ir.ts";
import { checksumMigrationSql } from "../checksum.ts";
import type { AppliedMigration, MigrationFile } from "../types.ts";
import { buildReconciliationReport, reconcileVersion } from "./engine.ts";
import type {
  ArchivedMigrationSource,
  ReconciliationReport,
  VersionReconciliation,
} from "./types.ts";

function effectObjectsProvidedByMigration(
  analysis: MigrationAnalysis
): Set<string> {
  const provided = new Set(
    analysis.effects.creates.map((object) => objectKey(object))
  );
  for (const mutation of analysis.effects.modifies) {
    if (mutation.kind === "add_column") {
      provided.add(objectKey(mutation.object));
    }
  }
  return provided;
}

function laterDependenciesSatisfied(
  version: number,
  analyses: readonly MigrationAnalysis[],
  physical: ProjectedSchema
): boolean {
  const provider = analyses.find((item) => item.version === version);
  if (!provider) {
    return true;
  }
  const provided = effectObjectsProvidedByMigration(provider);
  for (const analysis of analyses) {
    if (analysis.version <= version) {
      continue;
    }
    for (const dependency of analysis.dependencies) {
      if (
        dependency.category !== "REQUIRES_TABLE" &&
        dependency.category !== "REQUIRES_COLUMN"
      ) {
        continue;
      }
      if (!provided.has(objectKey(dependency.object))) {
        continue;
      }
      if (!schemaHas(physical, dependency.object)) {
        return false;
      }
    }
  }
  return true;
}

export async function assembleReconciliationReport(input: {
  analyses: readonly MigrationAnalysis[];
  applied: readonly AppliedMigration[];
  archives: readonly ArchivedMigrationSource[];
  files: readonly MigrationFile[];
  physical: ProjectedSchema;
}): Promise<ReconciliationReport> {
  const versions = new Set<number>([
    ...input.files.map((file) => file.version),
    ...input.applied.map((row) => row.version),
    ...input.archives.map((row) => row.version),
  ]);
  const diagnoses: VersionReconciliation[] = [];
  for (const version of [...versions].sort((a, b) => a - b)) {
    const file = input.files.find((item) => item.version === version);
    const ledger = input.applied.find((item) => item.version === version);
    const versionArchives = input.archives.filter(
      (item) => item.version === version
    );
    const archive = ledger
      ? versionArchives.find((item) => item.checksum === ledger.checksum)
      : versionArchives.length === 1
        ? versionArchives[0]
        : undefined;
    const archiveSelectionAmbiguous =
      versionArchives.length > 1 &&
      (ledger === undefined ||
        !versionArchives.some((item) => item.checksum === ledger.checksum));
    const repositoryAnalysis = input.analyses.find(
      (item) => item.version === version
    );
    let archiveAnalysis: MigrationAnalysis | undefined;
    if (archive) {
      archiveAnalysis = await analyzeMigrationFile({
        checksum: archive.checksum || checksumMigrationSql(archive.sql),
        filename: archive.sourcePath ?? `${version}_archive.sql`,
        name: "archive",
        path: archive.sourcePath ?? "archive",
        sql: archive.sql,
        version,
      });
    }
    const archiveExecutionAnalysis =
      archive?.executionSql === undefined
        ? archiveAnalysis
        : await analyzeMigrationFile({
            checksum:
              archive.executionChecksum ??
              checksumMigrationSql(archive.executionSql),
            filename: `${archive.sourcePath ?? `${version}_archive.sql`}#execution`,
            name: "archive-execution",
            path: archive.sourcePath ?? "archive",
            sql: archive.executionSql,
            version,
          });
    const repositoryExecutionAnalysis =
      file?.executionSql === undefined
        ? repositoryAnalysis
        : await analyzeMigrationFile({
            checksum: checksumMigrationSql(file.executionSql),
            filename: `${file.filename}#execution`,
            name: `${file.name}-execution`,
            path: file.path,
            sql: file.executionSql,
            version,
          });
    diagnoses.push(
      reconcileVersion({
        archive,
        archiveAnalysis,
        archiveExecutionAnalysis,
        archiveSelectionAmbiguous,
        laterDependenciesSatisfied: laterDependenciesSatisfied(
          version,
          input.analyses,
          input.physical
        ),
        ledger: ledger
          ? {
              checksum: ledger.checksum,
              executionChecksum: ledger.executionChecksum,
              executionTransformId: ledger.executionTransformId,
              executionTransformVersion: ledger.executionTransformVersion,
              name: ledger.name,
              sourceBlobSha: ledger.sourceBlobSha,
              sourceCommit: ledger.sourceCommit,
              sourceDirty: ledger.sourceDirty,
              version: ledger.version,
            }
          : undefined,
        physical: input.physical,
        repository: file
          ? {
              checksum: file.checksum,
              committed: Boolean(
                file.provenance?.tracked && !file.provenance.dirty
              ),
              ...(file.executionSql === undefined
                ? {}
                : { executionSql: file.executionSql }),
              ...(file.executionTransform === undefined
                ? {}
                : { executionTransform: file.executionTransform }),
              filename: file.filename,
              gitBlobSha: file.provenance?.gitBlobSha,
              name: file.name,
              path: file.path,
              sql: file.sql,
              version: file.version,
            }
          : undefined,
        repositoryAnalysis,
        repositoryExecutionAnalysis,
      })
    );
  }
  return buildReconciliationReport(diagnoses);
}
