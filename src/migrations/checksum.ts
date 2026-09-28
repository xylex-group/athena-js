import { sha256HexUtf8 } from "../node-crypto.ts";
import type {
  MigrationExecutionTransform,
  MigrationFile,
} from "./types.ts";

/**
 * Deterministic SHA-256 checksum of exact UTF-8 migration SQL bytes.
 * No line-ending normalization — file content is hashed as authored.
 * Uses node-crypto helper (no static `node:crypto` import) so DTS stays green
 * without `@types/node` on the type path.
 */
export function checksumMigrationSql(sql: string): string {
  return sha256HexUtf8(sql);
}

export const IDENTITY_MIGRATION_EXECUTION_TRANSFORM: MigrationExecutionTransform =
  Object.freeze({
    id: "athena.migration.identity",
    version: "1",
  });

const INLINE_SQL_MIGRATION_EXECUTION_TRANSFORM: MigrationExecutionTransform =
  Object.freeze({
    id: "athena.migration.inline-sql",
    version: "1",
  });

export interface MigrationExecutionMetadata {
  checksum: string;
  sql: string;
  transform: MigrationExecutionTransform;
}

export function resolveMigrationExecution(
  migration: Pick<MigrationFile, "executionSql" | "executionTransform" | "sql">
): MigrationExecutionMetadata {
  if (
    migration.executionTransform !== undefined &&
    migration.executionSql === undefined
  ) {
    throw new Error("executionTransform requires executionSql");
  }
  const sql = migration.executionSql ?? migration.sql;
  const transform =
    migration.executionTransform ??
    (migration.executionSql === undefined
      ? IDENTITY_MIGRATION_EXECUTION_TRANSFORM
      : INLINE_SQL_MIGRATION_EXECUTION_TRANSFORM);

  return {
    checksum: checksumMigrationSql(sql),
    sql,
    transform,
  };
}
