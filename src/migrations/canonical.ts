import { sha256HexUtf8 } from "../node-crypto.ts";
import { objectKey } from "./analysis/ast.ts";
import type { MigrationAnalysis } from "./analysis/semantic-ir.ts";
import type { MigrationDiagnostic } from "./analysis/diagnostics.ts";
import type { AppliedMigration, MigrationFile } from "./types.ts";

export type CanonicalMigrationBackend = "postgres" | "sqlite";
export type CanonicalTransactionScope = "migration" | "plan";

export interface CanonicalMigrationDefinitionV1 {
  id: string;
  name: string;
  backend: CanonicalMigrationBackend;
  predecessor?: string;
  steps: Array<{ sql: string }>;
  sourceChecksum: string;
  definitionChecksum: string;
  execution: {
    checksum: string;
    transformId: string;
    transformVersion: string;
  };
}

export interface CanonicalMigrationPlanV1 {
  backend: CanonicalMigrationBackend;
  transactionScope: CanonicalTransactionScope;
  migrations: CanonicalMigrationDefinitionV1[];
}

export interface CanonicalMigrationReceiptV1 {
  id: string;
  name: string;
  sourceChecksum: string;
  definitionChecksum: string;
  executionChecksum: string;
  appliedAt: string;
  executionMs: number;
  preSchemaFingerprint: string;
  postSchemaFingerprint: string;
  executionId: string;
  provenance: {
    producer: "js_sql";
    attributes: Record<string, string>;
  };
}

export interface CanonicalMigrationAnalysisV1 {
  migrationId: string;
  statements: Array<{
    index: number;
    source: string;
    creates: string[];
    alters: string[];
    drops: string[];
    modifies: string[];
    dependencies: Array<{
      object: string;
      category: string;
      confidence: string;
      resolution: string;
    }>;
  }>;
  warnings: Array<{ kind: string; message: string }>;
}

export function toCanonicalMigration(
  migration: MigrationFile,
  backend: CanonicalMigrationBackend,
  predecessor?: string,
): CanonicalMigrationDefinitionV1 {
  const executionSql = migration.executionSql ?? migration.sql;
  const transform = migration.executionTransform ?? {
    id:
      migration.executionSql === undefined
        ? "athena.migration.identity"
        : "athena.migration.inline-sql",
    version: "1",
  };
  const id = String(migration.version).padStart(4, "0");
  return {
    id,
    name: migration.name,
    backend,
    ...(predecessor === undefined ? {} : { predecessor }),
    steps: [{ sql: migration.sql }],
    sourceChecksum: migration.checksum,
    definitionChecksum: definitionChecksum({
      backend,
      id,
      name: migration.name,
      predecessor: predecessor ?? null,
      steps: [{ sql: migration.sql }],
    }),
    execution: {
      checksum: sha256HexUtf8(executionSql),
      transformId: transform.id,
      transformVersion: transform.version,
    },
  };
}

export function toCanonicalAnalysis(
  migration: MigrationFile,
  analysis: MigrationAnalysis,
): CanonicalMigrationAnalysisV1 {
  return {
    migrationId: String(migration.version).padStart(4, "0"),
    statements: analysis.statements.map((statement, index) => ({
      index,
      source: migration.sql,
      creates: statement.effects.creates.map(objectKey),
      alters: [],
      drops: statement.effects.drops.map(objectKey),
      modifies: statement.effects.modifies.map((effect) => objectKey(effect.object)),
      dependencies: statement.dependencies.map((dependency) => ({
        object: objectKey(dependency.object),
        category: dependency.category,
        confidence: dependency.confidence,
        resolution: dependency.resolution ?? "unverified",
      })),
    })),
    warnings: analysis.warnings.map((message) => ({
      kind: "unverified",
      message,
    })),
  };
}

export function toCanonicalReceipt(
  migration: MigrationFile,
  applied: AppliedMigration,
): CanonicalMigrationReceiptV1 {
  return {
    id: String(applied.version).padStart(4, "0"),
    name: applied.name,
    sourceChecksum: applied.checksum,
    definitionChecksum: sha256HexUtf8(
      JSON.stringify({
        backend: "postgres",
        id: String(applied.version).padStart(4, "0"),
        name: applied.name,
        predecessor: null,
        steps: [{ sql: migration.sql }],
      }),
    ),
    executionChecksum: applied.executionChecksum ?? applied.checksum,
    appliedAt: applied.appliedAt.toISOString(),
    executionMs: applied.executionMs,
    preSchemaFingerprint: applied.preSchemaFingerprint ?? "unknown",
    postSchemaFingerprint: applied.postSchemaFingerprint ?? "unknown",
    executionId: applied.executionId ?? "",
    provenance: {
      producer: "js_sql",
      attributes: {
        ...(applied.sourcePath === undefined ? {} : { path: applied.sourcePath }),
        ...(applied.sourceCommit === undefined
          ? {}
          : { commit: applied.sourceCommit }),
        ...(applied.sourceBlobSha === undefined
          ? {}
          : { blobSha: applied.sourceBlobSha }),
      },
    },
  };
}

export function toCanonicalDiagnostic(
  diagnostic: MigrationDiagnostic,
): { kind: string; message: string; migrationId?: string; object?: string } {
  return {
    kind: diagnostic.classification.toUpperCase(),
    message: diagnostic.message,
    ...(diagnostic.location?.filename === undefined
      ? {}
      : { migrationId: diagnostic.location.filename }),
    object: objectKey(diagnostic.object),
  };
}

function definitionChecksum(identity: unknown): string {
  return sha256HexUtf8(JSON.stringify(identity));
}
