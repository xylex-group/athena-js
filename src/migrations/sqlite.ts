import { normalizeSqliteError } from "../sqlite-local/errors.ts";
import { normalizeSqliteExecutionResult } from "../sqlite-local/binds.ts";
import type { AthenaSqliteExecutor } from "../sqlite-local/contracts.ts";
import {
  resolveMigrationExecution,
} from "./checksum.ts";
import type { PhysicalCatalog } from "./analysis/catalog.ts";
import { assertMigrationSqlAllowsOuterTransaction } from "./sql-guards.ts";
import type {
  AppliedMigration,
  AppliedMigrationResult,
  MigrationBackend,
  MigrationFile,
  MigrationRunSummary,
} from "./types.ts";
import { MigrationError } from "./types.ts";
import { planHasBlockingConflicts, planMigrations } from "./planner.ts";

const LEDGER = "athena_schema_migrations";

function rows(result: Awaited<ReturnType<AthenaSqliteExecutor["execute"]>>): Record<string, unknown>[] {
  const normalized = normalizeSqliteExecutionResult(result);
  return normalized.rows.map((row) =>
    Object.fromEntries(normalized.columns.map((column, index) => [column, row[index] ?? null])),
  );
}

function mapRow(row: Record<string, unknown>): AppliedMigration {
  return {
    appliedAt: new Date(String(row.applied_at ?? 0)),
    checksum: String(row.checksum ?? ""),
    executionChecksum: typeof row.execution_checksum === "string" ? row.execution_checksum : undefined,
    executionMs: Number(row.execution_ms ?? 0),
    name: String(row.name ?? ""),
    version: Number(row.version),
  };
}

function isMissingLedgerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /no such table(?::\s*(?:main\.)?)?athena_schema_migrations/i.test(
      message,
    ) ||
    /table ["']?athena_schema_migrations["']? does not exist/i.test(message)
  );
}

export interface SqliteMigrationBackendOptions {
  executor: AthenaSqliteExecutor;
}

export class SqliteLocalMigrationBackend implements MigrationBackend {
  readonly kind = "sqlite-local";
  private locked = false;

  constructor(private readonly options: SqliteMigrationBackendOptions) {}

  private execute(sql: string, parameters: readonly unknown[] = []) {
    return this.options.executor.execute(sql, parameters as never);
  }

  async acquireLock(): Promise<void> {
    if (this.locked) {
      throw new MigrationError("LOCK", "SQLite migration lock is already held.");
    }
    await this.execute("BEGIN IMMEDIATE");
    this.locked = true;
  }

  async releaseLock(): Promise<void> {
    if (!this.locked) return;
    try {
      await this.execute("COMMIT");
    } finally {
      this.locked = false;
    }
  }

  async ensureLedger(): Promise<void> {
    try {
      await this.execute(`
        CREATE TABLE IF NOT EXISTS ${LEDGER} (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          checksum TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          execution_ms INTEGER NOT NULL,
          execution_checksum TEXT
        )
      `);
    } catch (error) {
      throw new MigrationError("LEDGER", "Unable to create the SQLite migration ledger.", {
        cause: normalizeSqliteError(error),
      });
    }
  }

  async listAppliedMigrations(): Promise<AppliedMigration[]> {
    try {
      const result = await this.execute(
        `SELECT version, name, checksum, applied_at, execution_ms, execution_checksum FROM ${LEDGER} ORDER BY version`,
      );
      return rows(result).map(mapRow);
    } catch (error) {
      if (isMissingLedgerError(error)) return [];
      throw error;
    }
  }

  async applyMigration(migration: MigrationFile): Promise<AppliedMigrationResult> {
    assertMigrationSqlAllowsOuterTransaction(migration.sql, migration.filename);
    const execution = resolveMigrationExecution(migration);
    assertMigrationSqlAllowsOuterTransaction(execution.sql, migration.filename);
    const started = Date.now();
    try {
      const apply = async (tx: { execute: AthenaSqliteExecutor["execute"] }) => {
        await applySqliteMigration(tx, migration, execution, started);
      };
      if (this.locked) {
        await apply({
          execute: this.options.executor.execute.bind(this.options.executor),
        });
      } else {
        await this.options.executor.transaction(apply);
      }
      return {
        appliedAt: new Date(),
        checksum: migration.checksum,
        executionChecksum: execution.checksum,
        executionMs: Math.max(0, Date.now() - started),
        filename: migration.filename,
        name: migration.name,
        version: migration.version,
      };
    } catch (error) {
      if (this.locked) {
        try {
          await this.execute("ROLLBACK");
        } finally {
          this.locked = false;
        }
      }
      throw new MigrationError("EXECUTION", "SQLite migration failed and was rolled back.", {
        cause: normalizeSqliteError(error),
      });
    }
  }

  async applyMigrations(
    migrations: readonly MigrationFile[],
  ): Promise<AppliedMigrationResult[]> {
    const started = Date.now();
    const executions = migrations.map((migration) => {
      assertMigrationSqlAllowsOuterTransaction(migration.sql, migration.filename);
      const execution = resolveMigrationExecution(migration);
      assertMigrationSqlAllowsOuterTransaction(execution.sql, migration.filename);
      return { execution, migration };
    });
    const run = async (tx: { execute: AthenaSqliteExecutor["execute"] }) => {
      const results: AppliedMigrationResult[] = [];
      for (const { execution, migration } of executions) {
        await applySqliteMigration(tx, migration, execution, started);
        results.push({
          appliedAt: new Date(),
          checksum: migration.checksum,
          executionChecksum: execution.checksum,
          executionMs: Math.max(0, Date.now() - started),
          filename: migration.filename,
          name: migration.name,
          version: migration.version,
        });
      }
      return results;
    };
    try {
      return await this.options.executor.transaction(run);
    } catch (error) {
      throw new MigrationError("EXECUTION", "SQLite migration plan failed and was rolled back.", {
        cause: normalizeSqliteError(error),
      });
    }
  }

  async inspectCatalog(): Promise<PhysicalCatalog> {
    return { objects: [], schema: {} as PhysicalCatalog["schema"] };
  }

  async insertReconciliation(): Promise<void> {
    // SQLite Local intentionally keeps reconciliation in the generic coordinator;
    // no second ledger is created for an adapter that has no catalog authority.
  }

  async close(): Promise<void> {
    await this.releaseLock();
  }
}

async function applySqliteMigration(
  tx: { execute: AthenaSqliteExecutor["execute"] },
  migration: MigrationFile,
  execution: ReturnType<typeof resolveMigrationExecution>,
  started: number,
): Promise<void> {
  await tx.execute(execution.sql);
  await tx.execute(
    `INSERT INTO ${LEDGER} (version, name, checksum, execution_ms, execution_checksum) VALUES (?, ?, ?, ?, ?)`,
    [
      migration.version,
      migration.name,
      migration.checksum,
      Math.max(0, Date.now() - started),
      execution.checksum,
    ],
  );
}

export function createSqliteMigrationBackend(
  options: SqliteMigrationBackendOptions,
): MigrationBackend {
  return new SqliteLocalMigrationBackend(options);
}

/**
 * Explicit SQLite migration entry point. It is intentionally not called by
 * createClient and has no provider fallback: the caller supplies both the
 * executor and authored SQLite migration files.
 */
export async function runSqliteMigrations(input: {
  executor: AthenaSqliteExecutor;
  migrations: readonly MigrationFile[];
  dryRun?: boolean;
}): Promise<MigrationRunSummary> {
  const backend = new SqliteLocalMigrationBackend({ executor: input.executor });
  const mode = input.dryRun ? "dry-run" : "apply";
  try {
    const newlyApplied: AppliedMigrationResult[] = [];
    let plan: MigrationRunSummary["plan"];
    if (input.dryRun) {
      const applied = await backend.listAppliedMigrations();
      plan = planMigrations({ applied, local: [...input.migrations] });
    } else {
      await backend.acquireLock();
      try {
        await backend.ensureLedger();
        const applied = await backend.listAppliedMigrations();
        plan = planMigrations({ applied, local: [...input.migrations] });
        if (planHasBlockingConflicts(plan)) {
          throw new MigrationError(
            "HISTORY",
            "SQLite migration history has conflicts.",
          );
        }
        for (const entry of plan.pending) {
          newlyApplied.push(await backend.applyMigration(entry.migration));
        }
      } finally {
        await backend.releaseLock();
      }
    }
    return {
      appliedCount: plan.applied.length,
      conflicts: plan.conflicts,
      databaseLabel: "sqlite-local",
      directory: "injected",
      dryRun: Boolean(input.dryRun),
      failedCount: 0,
      mode,
      newlyApplied,
      pendingCount: plan.pending.length - newlyApplied.length,
      plan,
      providerLabel: "sqlite-local",
      skippedCount: 0,
    };
  } finally {
    await backend.close();
  }
}
