import type { AthenaCliUI } from "../cli/ui/index.ts";
import type {
  AthenaPostgresClient,
  AthenaPostgresQueryable,
} from "../postgres/driver.ts";
import {
  type AthenaPostgresRuntime,
  createAthenaPostgresRuntime,
} from "../postgres/owned-runtime.ts";
import { PostgresDeadline } from "../postgres/pool/deadline.ts";
import type { PostgresPoolManager } from "../postgres/pool/manager.ts";
import { MigrationError } from "./types.ts";

export interface EmbeddedSqlRelation {
  readonly schema: string;
  readonly table: string;
}

export interface EmbeddedSqlColumn {
  readonly column: string;
  readonly schema: string;
  readonly table: string;
}

export interface EmbeddedSqlMigration {
  readonly checksum: string;
  readonly filename: string;
  readonly legacyChecksums?: readonly string[];
  readonly name: string;
  readonly requiredColumns?: readonly EmbeddedSqlColumn[];
  readonly requiredRelations?: readonly EmbeddedSqlRelation[];
  readonly sql: string;
  readonly version: number;
}

export type EmbeddedLedgerEntryStatus =
  | "applied"
  | "pending"
  | "legacy-compatible"
  | "checksum-mismatch";

export interface EmbeddedLedgerEntry {
  readonly checksum: string;
  readonly filename: string;
  readonly name: string;
  readonly status: EmbeddedLedgerEntryStatus;
  readonly storedChecksum?: string;
  readonly version: number;
}

export interface EmbeddedLedgerInspection {
  readonly entries: readonly EmbeddedLedgerEntry[];
  readonly ledgerExists: boolean;
  readonly ledgerTable: string;
  readonly missingColumns?: readonly string[];
  readonly missingRelations?: readonly string[];
}

const LEDGER_TABLE_PATTERN =
  /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

export function assertLedgerTableName(ledgerTable: string): string {
  if (!LEDGER_TABLE_PATTERN.test(ledgerTable)) {
    throw new MigrationError(
      "CONFIG",
      `Invalid embedded migration ledger table: ${ledgerTable}`
    );
  }
  return ledgerTable;
}

export function quoteLedgerTable(ledgerTable: string): string {
  return assertLedgerTableName(ledgerTable)
    .split(".")
    .map((part) => `"${part}"`)
    .join(".");
}

function ledgerChecksum(
  row: Record<string, unknown> | undefined
): string | undefined {
  const value = row?.checksum;
  return typeof value === "string" ? value : undefined;
}

export async function embeddedLedgerExists(
  queryable: AthenaPostgresQueryable,
  ledgerTable: string
): Promise<boolean> {
  const name = assertLedgerTableName(ledgerTable);
  const result = await queryable.query<{ oid: string | null }>(
    "SELECT to_regclass($1) AS oid",
    [name]
  );
  const oid = result.rows[0]?.oid;
  return oid != null && String(oid).length > 0;
}

async function readLedgerChecksum(
  queryable: AthenaPostgresQueryable,
  ledgerTable: string,
  version: number
): Promise<string | undefined> {
  const quoted = quoteLedgerTable(ledgerTable);
  const applied = await queryable.query(
    `SELECT checksum FROM ${quoted} WHERE version = $1`,
    [version]
  );
  return ledgerChecksum(applied.rows[0] as Record<string, unknown> | undefined);
}

export function isLegacyLedgerChecksum(
  migration: EmbeddedSqlMigration,
  stored: string
): boolean {
  return migration.legacyChecksums?.includes(stored) === true;
}

export async function physicalRelationsPresent(
  queryable: AthenaPostgresQueryable,
  relations: readonly EmbeddedSqlRelation[] | undefined
): Promise<boolean> {
  if (relations == null || relations.length === 0) {
    return false;
  }
  for (const relation of relations) {
    const qualified = `${relation.schema}.${relation.table}`;
    const result = await queryable.query<{ oid: string | null }>(
      "SELECT to_regclass($1) AS oid",
      [qualified]
    );
    const oid = result.rows[0]?.oid;
    if (oid == null || String(oid).length === 0) {
      return false;
    }
  }
  return true;
}

export async function physicalColumnsPresent(
  queryable: AthenaPostgresQueryable,
  columns: readonly EmbeddedSqlColumn[] | undefined
): Promise<boolean> {
  if (columns == null || columns.length === 0) {
    return false;
  }
  for (const column of columns) {
    const result = await queryable.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = $1
         AND table_name = $2
         AND column_name = $3`,
      [column.schema, column.table, column.column]
    );
    if (result.rows.length === 0) {
      return false;
    }
  }
  return true;
}

async function physicalSchemaPresent(
  queryable: AthenaPostgresQueryable,
  migration: EmbeddedSqlMigration
): Promise<boolean> {
  const relationsPresent =
    migration.requiredRelations == null || migration.requiredRelations.length === 0
      ? true
      : await physicalRelationsPresent(queryable, migration.requiredRelations);
  const columnsPresent =
    migration.requiredColumns == null || migration.requiredColumns.length === 0
      ? true
      : await physicalColumnsPresent(queryable, migration.requiredColumns);
  return relationsPresent && columnsPresent;
}

function checksumMismatchMessage(
  migration: EmbeddedSqlMigration,
  stored: string,
  physicalOk: boolean
): string {
  const legacy = isLegacyLedgerChecksum(migration, stored);
  if (legacy && !physicalOk) {
    return [
      `${migration.filename} version ${migration.version} ledger identity is legacy (${stored}) but the physical schema does not match the packaged generation.`,
      `Packaged checksum: ${migration.checksum}.`,
      "Athena will not rewrite the ledger. Restore the schema or apply a forward migration.",
    ].join(" ");
  }
  return [
    `${migration.filename} version ${migration.version} checksum mismatch.`,
    `Ledger: ${stored}.`,
    `Package: ${migration.checksum}.`,
    legacy
      ? "Legacy identity is listed but physical fingerprint was not confirmed."
      : "Unknown checksum drift fails closed.",
  ].join(" ");
}

async function classifyStoredChecksum(input: {
  migration: EmbeddedSqlMigration;
  queryable: AthenaPostgresQueryable;
  stored: string;
}): Promise<EmbeddedLedgerEntryStatus> {
  const { migration, queryable, stored } = input;
  if (stored === migration.checksum) {
    return "applied";
  }
  if (!isLegacyLedgerChecksum(migration, stored)) {
    return "checksum-mismatch";
  }
  const physicalOk = await physicalSchemaPresent(queryable, migration);
  return physicalOk ? "legacy-compatible" : "checksum-mismatch";
}

async function adoptLegacyLedgerChecksum(input: {
  client: AthenaPostgresClient;
  ledgerTable: string;
  migration: EmbeddedSqlMigration;
  stored: string;
}): Promise<void> {
  const quoted = quoteLedgerTable(input.ledgerTable);
  await input.client.query("BEGIN");
  try {
    const updated = await input.client.query(
      `UPDATE ${quoted}
			 SET checksum = $1, name = $2
			 WHERE version = $3 AND checksum = $4`,
      [
        input.migration.checksum,
        input.migration.name,
        input.migration.version,
        input.stored,
      ]
    );
    const rowCount =
      typeof (updated as { rowCount?: number }).rowCount === "number"
        ? (updated as { rowCount: number }).rowCount
        : 0;
    if (rowCount < 1) {
      throw new MigrationError(
        "INTEGRITY",
        `${input.migration.filename} version ${input.migration.version} legacy adoption updated 0 ledger rows.`
      );
    }
    await input.client.query("COMMIT");
  } catch (error) {
    try {
      await input.client.query("ROLLBACK");
    } catch {
      // Session may already be aborted.
    }
    throw error;
  }
}

export async function inspectEmbeddedSqlLedger(input: {
  ledgerTable: string;
  migrations: readonly EmbeddedSqlMigration[];
  queryable: AthenaPostgresQueryable;
}): Promise<EmbeddedLedgerInspection> {
  const ledgerExists = await embeddedLedgerExists(
    input.queryable,
    input.ledgerTable
  );
  const entries: EmbeddedLedgerEntry[] = [];
  for (const migration of input.migrations) {
    if (!ledgerExists) {
      entries.push({
        checksum: migration.checksum,
        filename: migration.filename,
        name: migration.name,
        status: "pending",
        version: migration.version,
      });
      continue;
    }
    const stored = await readLedgerChecksum(
      input.queryable,
      input.ledgerTable,
      migration.version
    );
    if (stored == null) {
      entries.push({
        checksum: migration.checksum,
        filename: migration.filename,
        name: migration.name,
        status: "pending",
        version: migration.version,
      });
      continue;
    }
    const status = await classifyStoredChecksum({
      migration,
      queryable: input.queryable,
      stored,
    });
    entries.push({
      checksum: migration.checksum,
      filename: migration.filename,
      name: migration.name,
      status,
      storedChecksum: stored,
      version: migration.version,
    });
  }
  const latest = input.migrations[input.migrations.length - 1];
  const latestEntry = entries[entries.length - 1];
  const missingRelations: string[] = [];
  const missingColumns: string[] = [];
  if (
    latest &&
    latestEntry?.status === "applied" &&
    latest.requiredRelations &&
    latest.requiredRelations.length > 0
  ) {
    for (const relation of latest.requiredRelations) {
      const qualified = `${relation.schema}.${relation.table}`;
      const present = await physicalRelationsPresent(input.queryable, [
        relation,
      ]);
      if (!present) {
        missingRelations.push(qualified);
      }
    }
  }
  if (
    latest &&
    latestEntry?.status === "applied" &&
    latest.requiredColumns &&
    latest.requiredColumns.length > 0
  ) {
    for (const column of latest.requiredColumns) {
      const present = await physicalColumnsPresent(input.queryable, [column]);
      if (!present) {
        missingColumns.push(
          `${column.schema}.${column.table}.${column.column}`
        );
      }
    }
  }
  return {
    entries,
    ledgerExists,
    ledgerTable: input.ledgerTable,
    ...(missingColumns.length > 0 ? { missingColumns } : {}),
    ...(missingRelations.length > 0 ? { missingRelations } : {}),
  };
}

/**
 * Ledger-first embedded SQL apply. Probe `to_regclass` outside BEGIN so a
 * missing ledger is not an undefined-table error that aborts the transaction.
 */
export async function applyEmbeddedSqlMigrationsWithRuntime(input: {
  connectionString: string;
  ledgerTable: string;
  migrations: readonly EmbeddedSqlMigration[];
  postgresRuntime?: AthenaPostgresRuntime;
  ui: AthenaCliUI;
}): Promise<void> {
  const owned =
    input.postgresRuntime ??
    createAthenaPostgresRuntime({ connectionString: input.connectionString });
  try {
    await applyEmbeddedSqlMigrations({
      ledgerTable: input.ledgerTable,
      manager: await owned.getPoolManager(),
      migrations: input.migrations,
      ui: input.ui,
    });
  } finally {
    if (!input.postgresRuntime) {
      await owned.close();
    }
  }
}

export async function applyEmbeddedSqlMigrations(input: {
  ledgerTable: string;
  migrations: readonly EmbeddedSqlMigration[];
  manager: PostgresPoolManager;
  ui: AthenaCliUI;
}): Promise<void> {
  const lease = await input.manager.acquire({
    deadline: PostgresDeadline.after(60_000),
    target: "direct",
    workload: "migration",
  });
  const client = lease.client;
  try {
    const latest = input.migrations[input.migrations.length - 1];
    let latestSkippedAsApplied = false;
    for (const migration of input.migrations) {
      const ledgerExists = await embeddedLedgerExists(
        client,
        input.ledgerTable
      );
      if (ledgerExists) {
        const stored = await readLedgerChecksum(
          client,
          input.ledgerTable,
          migration.version
        );
        if (stored != null) {
          if (stored === migration.checksum) {
            if (latest && migration.version === latest.version) {
              latestSkippedAsApplied = true;
            }
            continue;
          }
          if (isLegacyLedgerChecksum(migration, stored)) {
            const physicalOk = await physicalSchemaPresent(client, migration);
            if (!physicalOk) {
              throw new MigrationError(
                "INTEGRITY",
                checksumMismatchMessage(migration, stored, false)
              );
            }
            await adoptLegacyLedgerChecksum({
              client,
              ledgerTable: input.ledgerTable,
              migration,
              stored,
            });
            input.ui.info(
              `✓ ${migration.filename} adopted (legacy ${stored} → packaged checksum)`
            );
            continue;
          }
          throw new MigrationError(
            "INTEGRITY",
            checksumMismatchMessage(migration, stored, false)
          );
        }
      }
      await applyPendingMigration(client, input.ledgerTable, migration);
      input.ui.info(`✓ ${migration.filename} applied`);
    }
    if (latestSkippedAsApplied) {
      if (
        latest &&
        !(await physicalSchemaPresent(client, latest))
      ) {
        input.ui.info(
          `${latest.filename} is recorded as applied but the physical schema is incomplete; replaying packaged SQL`
        );
        for (const migration of input.migrations) {
          await applyPendingMigration(client, input.ledgerTable, migration);
        }
      }
      await assertLatestPhysicalSchema(client, input.migrations);
    }
  } finally {
    lease.release();
  }
}

async function assertLatestPhysicalSchema(
  queryable: AthenaPostgresQueryable,
  migrations: readonly EmbeddedSqlMigration[]
): Promise<void> {
  const latest = migrations[migrations.length - 1];
  if (
    !latest ||
    ((!latest.requiredRelations || latest.requiredRelations.length === 0) &&
      (!latest.requiredColumns || latest.requiredColumns.length === 0))
  ) {
    return;
  }
  const missingRelations: string[] = [];
  if (latest.requiredRelations) {
    for (const relation of latest.requiredRelations) {
      const present = await physicalRelationsPresent(queryable, [relation]);
      if (!present) {
        missingRelations.push(`${relation.schema}.${relation.table}`);
      }
    }
  }
  const missingColumns: string[] = [];
  if (latest.requiredColumns) {
    for (const column of latest.requiredColumns) {
      const present = await physicalColumnsPresent(queryable, [column]);
      if (!present) {
        missingColumns.push(
          `${column.schema}.${column.table}.${column.column}`
        );
      }
    }
  }
  if (missingRelations.length === 0 && missingColumns.length === 0) {
    return;
  }
  const missing =
    missingRelations.length > 0 && missingColumns.length > 0
      ? `required relations are missing: ${missingRelations.join(", ")}. required columns are missing: ${missingColumns.join(", ")}`
      : missingRelations.length > 0
        ? `required relations are missing: ${missingRelations.join(", ")}`
        : `required columns are missing: ${missingColumns.join(", ")}`;
  throw new MigrationError(
    "INTEGRITY",
    `${latest.filename} is recorded as applied but ${missing}. Run a forward migrate or restore the schema.`
  );
}

async function applyPendingMigration(
  client: AthenaPostgresClient,
  ledgerTable: string,
  migration: EmbeddedSqlMigration
): Promise<void> {
  const quoted = quoteLedgerTable(ledgerTable);
  await client.query("BEGIN");
  try {
    await client.query(migration.sql);
    await client.query(
      `INSERT INTO ${quoted} (version, name, checksum)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (version) DO NOTHING`,
      [migration.version, migration.name, migration.checksum]
    );
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Session may already be aborted.
    }
    throw error;
  }
}
