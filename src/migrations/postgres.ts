import {
  type AthenaPostgresClient,
  type AthenaPostgresPool,
  createPostgresPool,
} from "../postgres/driver.ts";
import type { MigrationBackend } from "./backend.ts";
import {
  type PhysicalCatalog,
  inspectPhysicalCatalog,
} from "./analysis/catalog.ts";
import { fingerprintProjectedSchema } from "./analysis/projected-schema.ts";
import { sha256HexUtf8 } from "../node-crypto.ts";
import { assertMigrationSqlAllowsOuterTransaction } from "./sql-guards.ts";
import { randomUUID } from "node:crypto";
import { PACKAGE_VERSION } from "../sdk-version.ts";
import type { ArchivedMigrationSource } from "./reconciliation/types.ts";
import {
  type AppliedMigration,
  type AppliedMigrationResult,
  type MigrationBackendContext,
  MigrationError,
  type MigrationFile,
} from "./types.ts";

/**
 * Stable session advisory-lock key pair for Athena JS **application** migrations.
 * Derived from ASCII "ATHA" / "MIGS" — not a secret; must remain fixed.
 * Does not serialize Embedded Auth migrations; those use
 * `ATHENA_AUTH_MIGRATION_ADVISORY_LOCK` on the Auth database connection.
 */
export const ATHENA_MIGRATION_LOCK_KEY1 = 0x41_54_48_41; // ATHA
export const ATHENA_MIGRATION_LOCK_KEY2 = 0x4d_49_47_53; // MIGS

const LEDGER_BOOTSTRAP_SQL = `
CREATE SCHEMA IF NOT EXISTS athena;

CREATE TABLE IF NOT EXISTS athena.schema_migrations (
  version BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  execution_ms BIGINT NOT NULL
);

ALTER TABLE athena.schema_migrations
  ADD COLUMN IF NOT EXISTS source_commit text,
  ADD COLUMN IF NOT EXISTS source_path text,
  ADD COLUMN IF NOT EXISTS source_blob_sha text,
  ADD COLUMN IF NOT EXISTS source_branch text,
  ADD COLUMN IF NOT EXISTS source_repository text,
  ADD COLUMN IF NOT EXISTS runner_version text,
  ADD COLUMN IF NOT EXISTS runner_package_version text,
  ADD COLUMN IF NOT EXISTS execution_id uuid,
  ADD COLUMN IF NOT EXISTS source_dirty boolean,
  ADD COLUMN IF NOT EXISTS pre_schema_fingerprint text,
  ADD COLUMN IF NOT EXISTS post_schema_fingerprint text;

CREATE TABLE IF NOT EXISTS athena.schema_migration_sources (
  version BIGINT NOT NULL,
  checksum TEXT NOT NULL,
  sql TEXT NOT NULL,
  source_commit text,
  source_blob_sha text,
  source_path text,
  execution_id uuid,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (version, checksum)
);

CREATE TABLE IF NOT EXISTS athena.schema_migration_reconciliations (
  id uuid PRIMARY KEY,
  version BIGINT NOT NULL,
  classification text NOT NULL,
  confidence text NOT NULL,
  old_checksum text,
  new_checksum text,
  action text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  repository_commit text,
  physical_fingerprint text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  runner_version text
);
`.trim();

const LIST_APPLIED_SQL = `
SELECT version, name, checksum, applied_at, execution_ms
FROM athena.schema_migrations
ORDER BY version ASC
`.trim();

const LIST_APPLIED_SQL_RICH = `
SELECT version, name, checksum, applied_at, execution_ms,
  source_commit, source_blob_sha, source_dirty, post_schema_fingerprint, execution_id
FROM athena.schema_migrations
ORDER BY version ASC
`.trim();

interface LedgerRow {
  applied_at: Date | string;
  checksum: string;
  execution_id?: string | null;
  execution_ms: string | number | bigint;
  name: string;
  post_schema_fingerprint?: string | null;
  source_blob_sha?: string | null;
  source_commit?: string | null;
  source_dirty?: boolean | null;
  version: string | number | bigint;
}

function toNumber(value: string | number | bigint): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return Number.parseInt(value, 10);
}

function toDate(value: Date | string): Date {
  if (value instanceof Date) {
    return value;
  }
  return new Date(value);
}

function mapLedgerRow(row: LedgerRow): AppliedMigration {
  return {
    appliedAt: toDate(row.applied_at),
    checksum: row.checksum,
    executionId: row.execution_id ?? undefined,
    executionMs: toNumber(row.execution_ms),
    name: row.name,
    sourceBlobSha: row.source_blob_sha ?? undefined,
    sourceCommit: row.source_commit ?? undefined,
    sourceDirty: row.source_dirty ?? undefined,
    version: toNumber(row.version),
  };
}

function isUndefinedColumnError(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code) === "42703";
  }
  return /column .* does not exist/i.test(
    error instanceof Error ? error.message : String(error)
  );
}

function catalogFingerprint(catalog: PhysicalCatalog): string {
  return sha256HexUtf8(fingerprintProjectedSchema(catalog.schema));
}

function sanitizePgMessage(message: string): string {
  // Strip common connection-string shapes if a driver ever embeds them.
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, "[redacted-connection]")
    .replace(/password\s*=\s*[^;\s]+/gi, "password=[redacted]");
}

/** True when athena.schema_migrations (or schema athena) is not present yet. */
function isMissingLedgerError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const code =
      "code" in error && (error as { code?: unknown }).code != null
        ? String((error as { code?: unknown }).code)
        : "";
    // 42P01 undefined_table, 3F000 invalid_schema_name
    if (code === "42P01" || code === "3F000") {
      return true;
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  return (
    /relation ["']?athena\.schema_migrations["']? does not exist/i.test(
      message
    ) ||
    /relation ["']?schema_migrations["']? does not exist/i.test(message) ||
    /schema ["']?athena["']? does not exist/i.test(message)
  );
}

export interface PostgresMigrationBackendOptions extends MigrationBackendContext {
  pool?: AthenaPostgresPool;
}

/**
 * Applies `provider.database` (or PGDATABASE fallback) onto the connection URL
 * path so the pool targets the configured database even when the URL omits it
 * or names a different database.
 *
 * Does not log or return secrets beyond rewriting the pathname.
 */
export function applyDatabaseToConnectionString(
  connectionString: string,
  database?: string
): string {
  const trimmed = typeof database === "string" ? database.trim() : "";
  if (trimmed.length === 0) {
    return connectionString;
  }

  try {
    const usesPostgresql = /^postgresql:/i.test(connectionString);
    const normalized = connectionString.replace(/^postgresql:/i, "postgres:");
    const url = new URL(normalized);
    if (url.protocol !== "postgres:") {
      return connectionString;
    }

    const current = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (current === trimmed) {
      return connectionString;
    }

    url.pathname = `/${encodeURIComponent(trimmed)}`;
    const rewritten = url.toString();
    return usesPostgresql
      ? rewritten.replace(/^postgres:/i, "postgresql:")
      : rewritten;
  } catch {
    return connectionString;
  }
}

/**
 * Pool options for migration backends: connection string plus explicit database
 * override so node-pg cannot silently ignore a configured database name.
 */
export function buildPostgresMigrationPoolOptions(
  connectionString: string,
  database?: string
): {
  connectionString: string;
  poolConfig: { database?: string };
} {
  const trimmed = typeof database === "string" ? database.trim() : "";
  const resolvedConnectionString = applyDatabaseToConnectionString(
    connectionString,
    trimmed || undefined
  );
  return {
    connectionString: resolvedConnectionString,
    poolConfig: trimmed.length > 0 ? { database: trimmed } : {},
  };
}

/**
 * PostgreSQL direct-mode migration backend.
 *
 * - Idempotent ledger bootstrap under schema `athena`
 * - Session advisory lock held for the full run
 * - One transaction per migration (SQL + ledger insert)
 */
export class PostgresMigrationBackend implements MigrationBackend {
  readonly kind = "postgres";

  private readonly connectionString: string;
  private readonly database?: string;
  private pool: AthenaPostgresPool | undefined;
  private ownsPool: boolean;
  private client: AthenaPostgresClient | undefined;
  private lockHeld = false;

  constructor(options: PostgresMigrationBackendOptions) {
    this.connectionString = options.connectionString;
    this.database =
      typeof options.database === "string" && options.database.trim().length > 0
        ? options.database.trim()
        : undefined;
    this.pool = options.pool;
    this.ownsPool = !options.pool;
  }

  private async ensureClient(): Promise<AthenaPostgresClient> {
    if (this.client) {
      return this.client;
    }
    if (!this.pool) {
      const { connectionString, poolConfig } = buildPostgresMigrationPoolOptions(
        this.connectionString,
        this.database
      );
      this.pool = await createPostgresPool(connectionString, poolConfig);
      this.ownsPool = true;
    }
    this.client = await this.pool.connect();
    return this.client;
  }

  async acquireLock(): Promise<void> {
    const client = await this.ensureClient();
    try {
      await client.query("SELECT pg_advisory_lock($1, $2)", [
        ATHENA_MIGRATION_LOCK_KEY1,
        ATHENA_MIGRATION_LOCK_KEY2,
      ]);
      this.lockHeld = true;
    } catch (error) {
      throw new MigrationError(
        "LOCK",
        `Unable to acquire migration advisory lock: ${sanitizePgMessage(
          error instanceof Error ? error.message : String(error)
        )}`,
        { cause: error }
      );
    }
  }

  async releaseLock(): Promise<void> {
    if (!(this.client && this.lockHeld)) {
      return;
    }
    try {
      await this.client.query("SELECT pg_advisory_unlock($1, $2)", [
        ATHENA_MIGRATION_LOCK_KEY1,
        ATHENA_MIGRATION_LOCK_KEY2,
      ]);
    } catch {
      // Session end / pool release will drop session-level locks.
    } finally {
      this.lockHeld = false;
    }
  }

  async ensureLedger(): Promise<void> {
    const client = await this.ensureClient();
    try {
      await client.query(LEDGER_BOOTSTRAP_SQL);
    } catch (error) {
      throw new MigrationError(
        "LEDGER",
        `Unable to create migration ledger (athena.schema_migrations): ${sanitizePgMessage(
          error instanceof Error ? error.message : String(error)
        )}`,
        { cause: error }
      );
    }
  }

  async listAppliedMigrations(): Promise<AppliedMigration[]> {
    const client = await this.ensureClient();
    try {
      try {
        const result = await client.query<LedgerRow>(LIST_APPLIED_SQL_RICH);
        return result.rows.map(mapLedgerRow);
      } catch (error) {
        if (!isUndefinedColumnError(error)) {
          throw error;
        }
        const result = await client.query<LedgerRow>(LIST_APPLIED_SQL);
        return result.rows.map(mapLedgerRow);
      }
    } catch (error) {
        // status / plan / dry-run may run before the ledger exists; treat as empty.
        if (isMissingLedgerError(error)) {
          return [];
        }
        throw new MigrationError(
          "LEDGER",
          `Unable to read migration ledger: ${sanitizePgMessage(
            error instanceof Error ? error.message : String(error)
          )}`,
          { cause: error }
        );
      }
    }

  async inspectCatalog(): Promise<PhysicalCatalog> {
    const client = await this.ensureClient();
    return inspectPhysicalCatalog(client);
  }

  async applyMigration(
    migration: MigrationFile
  ): Promise<AppliedMigrationResult> {
      // Fail closed before opening a transaction if SQL could terminate it.
      assertMigrationSqlAllowsOuterTransaction(migration.sql, migration.filename);

      const client = await this.ensureClient();
      const started = Date.now();

      try {
        await client.query("BEGIN");
      } catch (error) {
        throw new MigrationError(
          "EXECUTION",
          `Failed to begin transaction for ${migration.filename}: ${sanitizePgMessage(
            error instanceof Error ? error.message : String(error)
          )}`,
          { cause: error }
        );
      }

      try {
        let preFingerprint: string | null = null;
        try {
          preFingerprint = catalogFingerprint(await inspectPhysicalCatalog(client));
        } catch {
          preFingerprint = null;
        }

        // Execute the full SQL file as authored (no semicolon splitting).
        await client.query(migration.sql);

      const executionMs = Math.max(0, Date.now() - started);
      let postFingerprint: string | null = null;
      try {
        postFingerprint = catalogFingerprint(await inspectPhysicalCatalog(client));
      } catch {
        postFingerprint = null;
      }
      const provenance = migration.provenance;
      const executionId = migration.executionId ?? randomUUID();
      await client.query(
        `
INSERT INTO athena.schema_migrations (
  version, name, checksum, execution_ms,
  source_commit, source_path, source_blob_sha, source_branch, source_repository,
  runner_version, runner_package_version, execution_id, source_dirty,
  pre_schema_fingerprint, post_schema_fingerprint
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::uuid, $13, $14, $15)
`.trim(),
        [
          migration.version,
          migration.name,
          migration.checksum,
          executionMs,
          provenance?.headCommit ?? null,
          provenance?.relativePath ?? migration.filename,
          provenance?.gitBlobSha ?? null,
          provenance?.branch ?? null,
          provenance?.repositoryRoot ?? null,
          PACKAGE_VERSION,
          PACKAGE_VERSION,
          executionId,
          Boolean(migration.sourceDirty ?? provenance?.dirty),
          preFingerprint,
          postFingerprint,
        ]
      );
      await client.query(
        `
INSERT INTO athena.schema_migration_sources (
  version, checksum, sql, source_commit, source_blob_sha, source_path, execution_id
) VALUES ($1, $2, $3, $4, $5, $6, $7::uuid)
ON CONFLICT (version, checksum) DO NOTHING
`.trim(),
        [
          migration.version,
          migration.checksum,
          migration.sql,
          provenance?.headCommit ?? null,
          provenance?.gitBlobSha ?? null,
          provenance?.relativePath ?? migration.filename,
          executionId,
        ]
      );

      await client.query("COMMIT");

      return {
        appliedAt: new Date(),
        checksum: migration.checksum,
        executionMs,
        filename: migration.filename,
        name: migration.name,
        version: migration.version,
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback errors; surface original failure
      }

      throw new MigrationError(
        "EXECUTION",
        [
          "Migration failed",
          "",
          migration.filename,
          "",
          "PostgreSQL:",
          sanitizePgMessage(
            error instanceof Error ? error.message : String(error)
          ),
          "",
          "The migration was rolled back.",
          "No later migrations were attempted.",
        ].join("\n"),
        { cause: error }
      );
    }
  }

  async listArchivedSources(): Promise<ArchivedMigrationSource[]> {
    const client = await this.ensureClient();
    try {
      const result = await client.query<{
        checksum: string;
        execution_id: string | null;
        source_blob_sha: string | null;
        source_commit: string | null;
        source_path: string | null;
        sql: string;
        version: string | number | bigint;
      }>(
        `
SELECT version, checksum, sql, source_commit, source_blob_sha, source_path, execution_id
FROM athena.schema_migration_sources
ORDER BY version ASC
`.trim()
      );
      return result.rows.map((row) => ({
        checksum: row.checksum,
        executionId: row.execution_id ?? undefined,
        sourceBlobSha: row.source_blob_sha ?? undefined,
        sourceCommit: row.source_commit ?? undefined,
        sourcePath: row.source_path ?? undefined,
        sql: row.sql,
        version: toNumber(row.version),
      }));
    } catch (error) {
      if (isMissingLedgerError(error)) {
        return [];
      }
      throw error;
    }
  }

  async repairLedgerChecksum(version: number, checksum: string): Promise<void> {
    const client = await this.ensureClient();
    await client.query(
      `UPDATE athena.schema_migrations SET checksum = $2 WHERE version = $1`,
      [version, checksum]
    );
  }

  async insertReconciliation(row: {
    action: string;
    classification: string;
    confidence: string;
    evidence: unknown;
    newChecksum?: string;
    oldChecksum?: string;
    physicalFingerprint?: string;
    repositoryCommit?: string;
    version: number;
  }): Promise<void> {
    const client = await this.ensureClient();
    await client.query(
      `
INSERT INTO athena.schema_migration_reconciliations (
  id, version, classification, confidence, old_checksum, new_checksum,
  action, evidence, repository_commit, physical_fingerprint, runner_version
) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
`.trim(),
      [
        randomUUID(),
        row.version,
        row.classification,
        row.confidence,
        row.oldChecksum ?? null,
        row.newChecksum ?? null,
        row.action,
        JSON.stringify(row.evidence ?? {}),
        row.repositoryCommit ?? null,
        row.physicalFingerprint ?? null,
        PACKAGE_VERSION,
      ]
    );
  }

  async close(): Promise<void> {
    try {
      await this.releaseLock();
    } finally {
      if (this.client) {
        try {
          this.client.release();
        } catch {
          // ignore
        }
        this.client = undefined;
      }
      if (this.pool && this.ownsPool) {
        try {
          await this.pool.end();
        } catch {
          // ignore
        }
      }
      this.pool = undefined;
    }
  }
}

export async function createPostgresMigrationBackend(
  context: MigrationBackendContext
): Promise<MigrationBackend> {
  return new PostgresMigrationBackend(context);
}
