import {
  type AthenaPostgresClient,
  type AthenaPostgresPool,
  createPostgresPool,
} from "../postgres/driver.ts";
import type { MigrationBackend } from "./backend.ts";
import { assertMigrationSqlAllowsOuterTransaction } from "./sql-guards.ts";
import {
  type AppliedMigration,
  type AppliedMigrationResult,
  type MigrationBackendContext,
  MigrationError,
  type MigrationFile,
} from "./types.ts";

/**
 * Stable session advisory-lock key pair for Athena JS app migrations.
 * Derived from ASCII "ATHA" / "MIGS" — not a secret; must remain fixed.
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
`.trim();

const LIST_APPLIED_SQL = `
SELECT version, name, checksum, applied_at, execution_ms
FROM athena.schema_migrations
ORDER BY version ASC
`.trim();

interface LedgerRow {
  applied_at: Date | string;
  checksum: string;
  execution_ms: string | number | bigint;
  name: string;
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
    executionMs: toNumber(row.execution_ms),
    name: row.name,
    version: toNumber(row.version),
  };
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
      const result = await client.query<LedgerRow>(LIST_APPLIED_SQL);
      return result.rows.map(mapLedgerRow);
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
        // Execute the full SQL file as authored (no semicolon splitting).
        await client.query(migration.sql);

      const executionMs = Math.max(0, Date.now() - started);
      await client.query(
        `
INSERT INTO athena.schema_migrations (version, name, checksum, execution_ms)
VALUES ($1, $2, $3, $4)
`.trim(),
        [migration.version, migration.name, migration.checksum, executionMs]
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
