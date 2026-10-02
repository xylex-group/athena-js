import { checksumMigrationSql } from "../../migrations/checksum.ts";
import {
  ATHENA_MIGRATE_REPAIR_COMMAND,
  ATHENA_MIGRATE_REPAIR_YES_COMMAND,
  ATHENA_NPX_MIGRATE_COMMAND,
} from "../../migrations/commands.ts";
import { PostgresAuthorizationStore } from "../../runtime/authorization/postgres.ts";
import { ATHENA_AUTH_MIGRATION_ADVISORY_LOCK } from "../contract/index.ts";
import {
  ATHENA_AUTH_CANONICAL_MIGRATIONS,
  ATHENA_AUTH_SCHEMA_GENERATION,
  ATHENA_AUTH_SCHEMA_STATEMENTS,
  type AthenaAuthCanonicalMigration,
} from "../schema/migrations.ts";
import {
  ATHENA_AUTH_SCHEMA_MIGRATE_TIMEOUT_MS,
  type AthenaAuthDatabase,
  assertQueryResult,
} from "./database.ts";
import { AthenaAuthRuntimeError } from "./errors.ts";
import {
  type AthenaAuthLedgerHealth,
  classifyAuthLedgerQueryError,
  healthFromAuthPlan,
} from "./ledger-health.ts";
import type { AthenaAuthSchemaDrift } from "./schema-inspect.ts";
import { inspectAthenaAuthMigrationExpectations } from "./schema-inspect.ts";
import {
  ATHENA_AUTH_MIGRATION_EXPECTATIONS,
  type MigrationRepairability,
  repairabilityForAuthMigration,
} from "./schema-manifest.ts";

const SCHEMA_STATEMENTS = ATHENA_AUTH_SCHEMA_STATEMENTS;

export type AthenaAuthSchemaDirection =
  | "current"
  | "upgrade-required"
  | "runtime-too-old"
  | "history-diverged";

export interface AthenaAuthLedgerEntry {
  checksum?: string | null;
  name: string;
  version: number;
}

export interface AthenaAuthSchemaCompatibility {
  checksumMismatch: number[];
  compatible: boolean;
  current: number;
  direction: AthenaAuthSchemaDirection;
  expected: number;
  missing: number[];
  unknown: number[];
}

export interface AthenaAuthSchemaReadiness {
  currentGeneration: number;
  ledger: AthenaAuthSchemaCompatibility;
  missingMigrations: number[];
  physicalSchemaDrift: AthenaAuthSchemaDrift[];
  physicalSchemaValid: boolean;
  ready: boolean;
  requiredGeneration: number;
}

export type AthenaAuthSchemaStatus = AthenaAuthSchemaCompatibility;

export type AthenaAuthLedgerState =
  | "absent"
  | "applied"
  | "checksum-mismatch"
  | "unknown";

export type AthenaAuthSchemaState = "unknown" | "healthy" | "drift";

export type AthenaAuthMigrationAction = "none" | "apply" | "repair" | "blocked";

export interface AthenaAuthMigrationPlanEntry {
  action: AthenaAuthMigrationAction;
  checksum: string;
  drift?: AthenaAuthSchemaDrift[];
  ledgerState: AthenaAuthLedgerState;
  name: string;
  repairability: MigrationRepairability;
  schemaState: AthenaAuthSchemaState;
  version: number;
}

export interface AthenaAuthMigrationPlan {
  appliedCount: number;
  conflictCount: number;
  driftCount: number;
  entries: AthenaAuthMigrationPlanEntry[];
  hasBlockingDrift: boolean;
  health: AthenaAuthLedgerHealth;
  pendingCount: number;
}

export interface AthenaAuthRepairResult {
  dryRun: boolean;
  repaired: AthenaAuthMigrationPlanEntry[];
  skipped: AthenaAuthMigrationPlanEntry[];
}

function ledgeredStatements(): (typeof SCHEMA_STATEMENTS)[number][] {
  return [...ATHENA_AUTH_CANONICAL_MIGRATIONS];
}

function statementByVersion(
  version: number,
): (typeof SCHEMA_STATEMENTS)[number] | undefined {
  return ATHENA_AUTH_CANONICAL_MIGRATIONS.find(
    (statement) => statement.version === version,
  );
}

export type { AthenaAuthCanonicalMigration } from "../schema/migrations.ts";

/** Package-owned Auth generations (ledgered, version > 0). Execution SSOT. */
export function listAthenaAuthCanonicalMigrations(): AthenaAuthCanonicalMigration[] {
  return [...ATHENA_AUTH_CANONICAL_MIGRATIONS];
}

export function getAthenaAuthExpectedLedger(): AthenaAuthLedgerEntry[] {
  return listAthenaAuthCanonicalMigrations().map((statement) => ({
    checksum: checksumMigrationSql(statement.sql),
    name: statement.name,
    version: statement.version,
  }));
}

export function getAthenaAuthSchemaManifest(): Record<string, string> {
  const manifest: Record<string, string> = {};
  for (const entry of getAthenaAuthExpectedLedger()) {
    manifest[String(entry.version).padStart(3, "0")] = entry.checksum ?? "";
  }
  return manifest;
}

function maxVersion(versions: Iterable<number>): number {
  let max = 0;
  for (const version of versions) {
    if (version > max) {
      max = version;
    }
  }
  return max;
}

export function compareAthenaAuthLedgers(
  actual: readonly Pick<AthenaAuthLedgerEntry, "checksum" | "version">[],
  expected: readonly AthenaAuthLedgerEntry[] = getAthenaAuthExpectedLedger(),
): AthenaAuthSchemaCompatibility {
  const expectedByVersion = new Map(
    expected.map((entry) => [entry.version, entry]),
  );
  const actualByVersion = new Map<number, (typeof actual)[number]>();
  for (const row of actual) {
    const version = Number(row.version);
    if (!Number.isFinite(version)) {
      continue;
    }
    actualByVersion.set(version, row);
  }

  const missing: number[] = [];
  const checksumMismatch: number[] = [];
  const checksumMissing: number[] = [];
  for (const entry of expected) {
    const applied = actualByVersion.get(entry.version);
    if (!applied) {
      missing.push(entry.version);
      continue;
    }
    const checksum = applied.checksum?.trim() ?? "";
    if (!checksum) {
      checksumMissing.push(entry.version);
      continue;
    }
    if (entry.checksum && checksum !== entry.checksum) {
      checksumMismatch.push(entry.version);
    }
  }

  const unknown = [...actualByVersion.keys()]
    .filter((version) => !expectedByVersion.has(version))
    .sort((a, b) => a - b);
  const current = maxVersion(actualByVersion.keys());
  const expectedGeneration = maxVersion(expected.map((entry) => entry.version));

  const appliedExpected = [...actualByVersion.keys()].filter((version) =>
    expectedByVersion.has(version),
  );
  const maxAppliedExpected = maxVersion(appliedExpected);
  const hasHole = missing.some((version) => version < maxAppliedExpected);
  const hasNewerUnknown = unknown.some(
    (version) => version > expectedGeneration,
  );

  let direction: AthenaAuthSchemaDirection;
  if (hasNewerUnknown) {
    direction = "runtime-too-old";
  } else if (checksumMismatch.length > 0 || unknown.length > 0 || hasHole) {
    direction = "history-diverged";
  } else if (missing.length > 0 || checksumMissing.length > 0) {
    direction = "upgrade-required";
  } else {
    direction = "current";
  }

  return {
    checksumMismatch,
    compatible: direction === "current",
    current,
    direction,
    expected: expectedGeneration || ATHENA_AUTH_SCHEMA_GENERATION,
    missing,
    unknown,
  };
}

export function toAthenaAuthSchemaCompatibility(
  current: number,
  expected: number = ATHENA_AUTH_SCHEMA_GENERATION,
): AthenaAuthSchemaCompatibility {
  const direction: AthenaAuthSchemaDirection =
    current === expected
      ? "current"
      : current > expected
        ? "runtime-too-old"
        : "upgrade-required";
  return {
    checksumMismatch: [],
    compatible: direction === "current",
    current,
    direction,
    expected,
    missing: [],
    unknown: current > expected ? [current] : [],
  };
}

function expectedName(version: number): string {
  return (
    getAthenaAuthExpectedLedger().find((entry) => entry.version === version)
      ?.name ?? String(version).padStart(3, "0")
  );
}

function formatMissingLines(versions: readonly number[]): string {
  if (versions.length === 0) {
    return "";
  }
  return `\n\nMissing:\n${versions.map((version) => `    ${expectedName(version)}`).join("\n")}`;
}

function formatSchemaCompatibilityError(
  status: AthenaAuthSchemaCompatibility,
): {
  code: string;
  message: string;
} {
  if (status.direction === "runtime-too-old") {
    return {
      code: "ATHENA_AUTH_SCHEMA_TOO_NEW",
      message: `ATHENA_AUTH_SCHEMA_TOO_NEW\n\nEmbedded Athena Auth requires schema generation ${status.expected}.\nDatabase currently has generation ${status.current}.\n\nUpgrade @xylex-group/athena.`,
    };
  }
  if (status.direction === "history-diverged") {
    const mismatch =
      status.checksumMismatch.length > 0
        ? `\n\nChecksum mismatch:\n${status.checksumMismatch.map((version) => `    ${expectedName(version)}`).join("\n")}`
        : "";
    const unknown =
      status.unknown.length > 0
        ? `\n\nUnknown:\n${status.unknown.map((version) => `    ${version}`).join("\n")}`
        : "";
    return {
      code: "ATHENA_AUTH_SCHEMA_DRIFT",
      message: `ATHENA_AUTH_SCHEMA_DRIFT\n\nEmbedded Athena Auth schema history diverged.\nRuntime generation ${status.expected}. Database generation ${status.current}.\n\nRun:\n\n    ${ATHENA_NPX_MIGRATE_COMMAND}\n${formatMissingLines(status.missing)}${mismatch}${unknown}`,
    };
  }
  if (status.current === 0) {
    return {
      code: "ATHENA_AUTH_SCHEMA_MISSING",
      message: `ATHENA_AUTH_SCHEMA_MISSING\n\nAthena Auth schema is not installed.\n\nRun:\n\n    ${ATHENA_NPX_MIGRATE_COMMAND}`,
    };
  }
  return {
    code: "ATHENA_AUTH_SCHEMA_OUTDATED",
    message: `ATHENA_AUTH_SCHEMA_OUTDATED\n\nEmbedded Athena Auth requires schema generation ${status.expected}.\nDatabase currently has generation ${status.current}.\n\nRun:\n\n    ${ATHENA_NPX_MIGRATE_COMMAND}${formatMissingLines(status.missing)}`,
  };
}

function formatSchemaPhysicalError(readiness: AthenaAuthSchemaReadiness): {
  code: string;
  message: string;
} {
  const missing = readiness.physicalSchemaDrift
    .map((item) => `    ${item.kind.replace("missing-", "")} ${item.object}`)
    .join("\n");
  return {
    code: "ATHENA_AUTH_SCHEMA_INVALID",
    message: [
      "ATHENA_AUTH_SCHEMA_INVALID",
      "",
      `Embedded Athena Auth schema generation ${readiness.requiredGeneration} has physical drift.`,
      `Database currently has generation ${readiness.currentGeneration}.`,
      "",
      "Missing invariants:",
      missing || "    (structural invariant)",
      "",
      "Run:",
      "",
      `    ${ATHENA_MIGRATE_REPAIR_YES_COMMAND}`,
    ].join("\n"),
  };
}

function authSchemaMigrationsRelationVisible(
  row: Record<string, unknown> | undefined,
): boolean {
  if (row == null) {
    return false;
  }
  if ("oid" in row) {
    const oid = row.oid;
    return oid != null && String(oid).length > 0;
  }
  // Test doubles often return ledger rows for any auth_schema_migrations SQL.
  return true;
}

async function authSchemaMigrationsTableExists(
  db: AthenaAuthDatabase,
): Promise<boolean> {
  const probed = assertQueryResult<Record<string, unknown>>(
    await db.query(
      "SELECT to_regclass('athena.auth_schema_migrations') AS oid",
    ),
    "probing migration ledger",
  );
  return authSchemaMigrationsRelationVisible(probed.rows[0]);
}

async function authSchemaMigrationsHasChecksumColumn(
  db: AthenaAuthDatabase,
): Promise<boolean> {
  const columns = assertQueryResult<{
    column_name?: string;
    version?: number;
  }>(
    await db.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'athena'
         AND table_name = 'auth_schema_migrations'
         AND column_name = 'checksum'`,
    ),
    "probing migration ledger checksum column",
  );
  if (columns.rows.some((row) => row.column_name === "checksum")) {
    return true;
  }
  return columns.rows.some((row) => row.version != null);
}

async function readAuthSchemaLedgerRows(
  db: AthenaAuthDatabase,
): Promise<AthenaAuthLedgerEntry[]> {
  try {
    if (!(await authSchemaMigrationsTableExists(db))) {
      return [];
    }
    const includeChecksum = await authSchemaMigrationsHasChecksumColumn(db);
    if (includeChecksum) {
      const applied = assertQueryResult<{
        checksum?: string | null;
        name?: string;
        version: number;
      }>(
        await db.query<{
          checksum?: string | null;
          name?: string;
          version: number;
        }>(
          "SELECT version, name, checksum FROM athena.auth_schema_migrations ORDER BY version",
        ),
        "reading migration ledger",
      );
      return applied.rows.map((row) => ({
        checksum: row.checksum,
        name: row.name ?? expectedName(Number(row.version)),
        version: Number(row.version),
      }));
    }
    const applied = assertQueryResult<{ name?: string; version: number }>(
      await db.query<{ name?: string; version: number }>(
        "SELECT version, name FROM athena.auth_schema_migrations ORDER BY version",
      ),
      "reading migration ledger (legacy columns)",
    );
    return applied.rows.map((row) => ({
      name: row.name ?? expectedName(Number(row.version)),
      version: Number(row.version),
    }));
  } catch (error) {
    if (
      error instanceof AthenaAuthRuntimeError &&
      error.code === "ATHENA_AUTH_DATABASE_RESULT_INVALID"
    ) {
      throw error;
    }
    const kind = classifyAuthLedgerQueryError(error);
    if (kind === "UNINITIALIZED") {
      return [];
    }
    throw wrapAuthLedgerQueryError(error);
  }
}

function wrapAuthLedgerQueryError(error: unknown): AthenaAuthRuntimeError {
  if (
    error instanceof AthenaAuthRuntimeError &&
    (error.code === "ATHENA_AUTH_DATABASE_RESULT_INVALID" ||
      error.code === "ATHENA_AUTH_LEDGER_UNREACHABLE" ||
      error.code === "ATHENA_AUTH_LEDGER_PERMISSION_DENIED" ||
      error.code === "ATHENA_AUTH_DATABASE_TIMEOUT")
  ) {
    return error;
  }
  const kind = classifyAuthLedgerQueryError(error);
  if (kind === "INVALID_LEDGER") {
    if (error instanceof AthenaAuthRuntimeError) {
      return error;
    }
    return new AthenaAuthRuntimeError(
      500,
      "ATHENA_AUTH_DATABASE_RESULT_INVALID",
      { cause: error, code: "ATHENA_AUTH_DATABASE_RESULT_INVALID" },
    );
  }
  if (kind === "PERMISSION_DENIED") {
    return new AthenaAuthRuntimeError(
      403,
      [
        "ATHENA_AUTH_LEDGER_PERMISSION_DENIED",
        "",
        "Embedded Auth cannot read athena.auth_schema_migrations.",
        "",
        error instanceof Error ? error.message : String(error),
      ].join("\n"),
      { cause: error, code: "ATHENA_AUTH_LEDGER_PERMISSION_DENIED" },
    );
  }
  const causeText = error instanceof Error ? error.message : String(error);
  const causeFirstLine = causeText.split(/\r?\n/, 1)[0] ?? causeText;
  return new AthenaAuthRuntimeError(
    503,
    [
      `ATHENA_AUTH_LEDGER_UNREACHABLE: ${causeFirstLine}`,
      "",
      "Embedded Auth could not reach the database to read the migration ledger.",
      "",
      causeText,
    ].join("\n"),
    { cause: error, code: "ATHENA_AUTH_LEDGER_UNREACHABLE" },
  );
}

/**
 * Transaction-owned advisory lock for Embedded Auth migrations.
 * Must not use pooled `pg_advisory_lock` — that lock is session-scoped and
 * `AthenaAuthDatabase.query()` does not pin a physical connection.
 * Distinct from application `pg_advisory_lock(ATHA, MIGS)` on the migrate
 * backend session.
 * Uses the schema-migrate budget, not the 15s request-path SQL timeout —
 * empty-DB apply of the full Auth catalog is one transaction.
 */
export async function withAthenaAuthMigrationLock<T>(
  db: AthenaAuthDatabase,
  fn: (tx: AthenaAuthDatabase) => Promise<T>,
  onTiming?: (phase: string, durationMs: number) => void,
): Promise<T> {
  return db.transaction(
    async (tx) => {
      const lockStarted = performance.now();
      await tx.query("SELECT pg_advisory_xact_lock($1)", [
        ATHENA_AUTH_MIGRATION_ADVISORY_LOCK,
      ]);
      reportAuthMigrationTiming(onTiming, "lock_acquisition", lockStarted);
      return fn(tx);
    },
    { operationTimeoutMs: ATHENA_AUTH_SCHEMA_MIGRATE_TIMEOUT_MS },
  );
}

function formatDriftBlock(
  entries: readonly AthenaAuthMigrationPlanEntry[],
): string {
  const drifted = entries.filter(
    (entry) => entry.schemaState === "drift" || entry.action === "repair",
  );
  if (drifted.length === 0) {
    return "";
  }
  const blocks = drifted.map((entry) => {
    const missing = (entry.drift ?? [])
      .map((item) => `    ${item.kind.replace("missing-", "")} ${item.object}`)
      .join("\n");
    return [
      entry.name,
      "",
      "  Missing:",
      missing || "    (structural invariant)",
    ].join("\n");
  });
  return blocks.join("\n\n");
}

/**
 * Sole planning authority for embedded Auth migrations.
 * Combines ledger history with physical schema expectations.
 */
export async function planAthenaAuthSchema(
  db: AthenaAuthDatabase,
  options: {
    inspectSchema?: boolean;
    ledgerRows?: readonly AthenaAuthLedgerEntry[];
  } = {},
): Promise<AthenaAuthMigrationPlan> {
  const inspectSchema = options.inspectSchema !== false;
  const expected = getAthenaAuthExpectedLedger();
  let actualRows: AthenaAuthLedgerEntry[];
  if (options.ledgerRows) {
    actualRows = [...options.ledgerRows];
  } else {
    try {
      actualRows = await readAuthSchemaLedgerRows(db);
    } catch (error) {
      throw wrapAuthLedgerQueryError(error);
    }
  }

  const actualByVersion = new Map(
    actualRows.map((row) => [Number(row.version), row]),
  );
  const expectedVersions = new Set(expected.map((entry) => entry.version));
  let driftByVersion = new Map<number, AthenaAuthSchemaDrift[]>();
  let inspectionError: unknown;
  const inspectAppliedSchema = inspectSchema && actualRows.length > 0;
  if (inspectAppliedSchema) {
    try {
      driftByVersion = new Map(
        await inspectAthenaAuthMigrationExpectations(
          db,
          expected.map((entry) => ({
            expectations:
              ATHENA_AUTH_MIGRATION_EXPECTATIONS[entry.version] ?? [],
            version: entry.version,
          })),
        ),
      );
    } catch (error) {
      if (
        error instanceof AthenaAuthRuntimeError &&
        (error.code === "ATHENA_AUTH_DATABASE_RESULT_INVALID" ||
          error.code === "ATHENA_AUTH_DATABASE_TIMEOUT" ||
          error.code === "ATHENA_AUTH_LEDGER_UNREACHABLE")
      ) {
        throw error;
      }
      inspectionError = error;
    }
  }

  const entries: AthenaAuthMigrationPlanEntry[] = [];

  for (const entry of expected) {
    const applied = actualByVersion.get(entry.version);
    let ledgerState: AthenaAuthLedgerState = "absent";
    if (applied) {
      const checksum = applied.checksum?.trim() ?? "";
      if (entry.checksum && checksum && checksum !== entry.checksum) {
        ledgerState = "checksum-mismatch";
      } else {
        ledgerState = "applied";
      }
    }

    let schemaState: AthenaAuthSchemaState = "unknown";
    let drift: AthenaAuthSchemaDrift[] | undefined;
    if (inspectSchema && ledgerState === "applied") {
      const expectations =
        ATHENA_AUTH_MIGRATION_EXPECTATIONS[entry.version] ?? [];
      if (expectations.length > 0) {
        if (inspectionError) {
          schemaState = "unknown";
        } else {
          drift = driftByVersion.get(entry.version);
          schemaState = drift ? "drift" : "healthy";
        }
      } else {
        schemaState = "healthy";
      }
    }

    let action: AthenaAuthMigrationAction = "none";
    if (ledgerState === "absent") {
      action = "apply";
    } else if (ledgerState === "checksum-mismatch") {
      action = "blocked";
    } else if (schemaState === "drift") {
      action = "repair";
    }

    entries.push({
      action,
      checksum: entry.checksum ?? "",
      drift,
      ledgerState,
      name: entry.name,
      repairability: repairabilityForAuthMigration(),
      schemaState,
      version: entry.version,
    });
  }

  for (const [version, row] of actualByVersion) {
    if (expectedVersions.has(version)) {
      continue;
    }
    entries.push({
      action: "blocked",
      checksum: row.checksum ?? "",
      ledgerState: "unknown",
      name: row.name ?? String(version).padStart(3, "0"),
      repairability: "manual",
      schemaState: "unknown",
      version,
    });
  }

  entries.sort((a, b) => a.version - b.version);

  const appliedCount = entries.filter(
    (e) => e.ledgerState === "applied" && e.schemaState !== "drift",
  ).length;
  const pendingCount = entries.filter((e) => e.action === "apply").length;
  const driftCount = entries.filter((e) => e.schemaState === "drift").length;
  const conflictCount = entries.filter(
    (e) => e.action === "blocked" || e.ledgerState === "checksum-mismatch",
  ).length;
  const hasBlockingDrift = driftCount > 0;

  return {
    appliedCount,
    conflictCount,
    driftCount,
    entries,
    hasBlockingDrift,
    health: healthFromAuthPlan({
      conflictCount,
      entries,
      hasBlockingDrift,
    }),
    pendingCount,
  };
}

export async function repairAthenaAuthSchema(
  db: AthenaAuthDatabase,
  options: { dryRun?: boolean } = {},
): Promise<AthenaAuthRepairResult> {
  return withAthenaAuthMigrationLock(db, async (tx) => {
    const plan = await planAthenaAuthSchema(tx, { inspectSchema: true });
    const toRepair = plan.entries.filter((entry) => entry.action === "repair");
    const skipped = toRepair.filter(
      (entry) => entry.repairability !== "idempotent",
    );
    const repairable = toRepair.filter(
      (entry) => entry.repairability === "idempotent",
    );

    if (options.dryRun) {
      return { dryRun: true, repaired: repairable, skipped };
    }

    if (skipped.length > 0 && repairable.length === 0) {
      throw new AthenaAuthRuntimeError(
        500,
        [
          "ATHENA_AUTH_SCHEMA_REPAIR_MANUAL",
          "",
          "Athena cannot safely repair these migrations automatically.",
          "",
          ...skipped.map((entry) => `  ${entry.name}`),
        ].join("\n"),
        { code: "ATHENA_AUTH_SCHEMA_REPAIR_MANUAL" },
      );
    }

    for (const entry of repairable) {
      const statement = statementByVersion(entry.version);
      if (!statement) {
        continue;
      }
      await tx.query(statement.sql);
    }

    return { dryRun: false, repaired: repairable, skipped };
  });
}

export async function migrateAthenaAuthSchema(
  db: AthenaAuthDatabase,
  options: {
    allowDrift?: boolean;
    onTiming?: (phase: string, durationMs: number) => void;
  } = {},
): Promise<AthenaAuthSchemaStatus> {
  await withAthenaAuthMigrationLock(db, async (tx) => {
    const expected = getAthenaAuthExpectedLedger();

    await tx.query("CREATE SCHEMA IF NOT EXISTS athena");
    await tx.query(`
      CREATE TABLE IF NOT EXISTS athena.auth_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL DEFAULT '',
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await tx.query(`
      ALTER TABLE athena.auth_schema_migrations
        ADD COLUMN IF NOT EXISTS checksum TEXT NOT NULL DEFAULT ''
    `);

    const appliedRows = await timeAuthMigrationPhase(
      "migration_history_read",
      () => readAuthSchemaLedgerRows(tx),
      options.onTiming,
    );

    // Fail closed: ledger-applied migrations with physical drift must not be
    // silently repaired by normal migrate.
    if (!options.allowDrift) {
      const plan = await timeAuthMigrationPhase(
        "physical_schema_validation",
        () => planAthenaAuthSchema(tx, { inspectSchema: true, ledgerRows: appliedRows }),
        options.onTiming,
      );
      if (plan.hasBlockingDrift) {
        throw new AthenaAuthRuntimeError(
          500,
          [
            "ATHENA_AUTH_SCHEMA_DRIFT",
            "",
            "Embedded Auth schema drift detected",
            "",
            formatDriftBlock(plan.entries),
            "",
            "Migration history says these migrations were already applied.",
            "",
            "Athena will not silently modify a drifted schema.",
            "",
            "Run:",
            "",
            `    ${ATHENA_MIGRATE_REPAIR_COMMAND}`,
          ].join("\n"),
          { code: "ATHENA_AUTH_SCHEMA_DRIFT" },
        );
      }
    }

    const preflight = compareAthenaAuthLedgers(appliedRows, expected);
    if (preflight.direction === "runtime-too-old") {
      const formatted = formatSchemaCompatibilityError(preflight);
      throw new AthenaAuthRuntimeError(500, formatted.message, {
        code: formatted.code,
      });
    }
    if (preflight.checksumMismatch.length > 0 || preflight.unknown.length > 0) {
      const formatted = formatSchemaCompatibilityError({
        ...preflight,
        compatible: false,
        direction: "history-diverged",
      });
      throw new AthenaAuthRuntimeError(500, formatted.message, {
        code: formatted.code,
      });
    }

    const appliedVersions = new Set(appliedRows.map((row) => row.version));

    // Ensure schema exists first (version 0), then apply in numeric order.
    const bootstrap = SCHEMA_STATEMENTS.find((s) => s.version === 0);
    if (bootstrap) {
      await timeAuthMigrationPhase(
        `migration.${String(bootstrap.version).padStart(3, "0")}.${bootstrap.name}`,
        () => tx.query(bootstrap.sql),
        options.onTiming,
      );
    }

    for (const statement of ledgeredStatements()) {
      if (appliedVersions.has(statement.version)) {
        continue;
      }
      const checksum = checksumMigrationSql(statement.sql);
      await timeAuthMigrationPhase(
        `migration.${String(statement.version).padStart(3, "0")}.${statement.name}`,
        async () => {
          await tx.query(statement.sql);
          await tx.query(
            "INSERT INTO athena.auth_schema_migrations (version, name, checksum) VALUES ($1, $2, $3) ON CONFLICT (version) DO NOTHING",
            [statement.version, statement.name, checksum],
          );
        },
        options.onTiming,
      );
    }

    for (const entry of expected) {
      if (!(appliedVersions.has(entry.version) && entry.checksum)) {
        continue;
      }
      await tx.query(
        `UPDATE athena.auth_schema_migrations
         SET checksum = $1
         WHERE version = $2 AND (checksum IS NULL OR checksum = '')`,
        [entry.checksum, entry.version],
      );
    }
  }, options.onTiming);

  return timeAuthMigrationPhase(
    "post_apply_validation",
    async () => {
      await new PostgresAuthorizationStore(db).ensureCatalog();
      await assertAthenaAuthSchemaCompatible(db, { inspectSchema: true });
      return readAthenaAuthSchemaStatus(db);
    },
    options.onTiming,
  );
}

function reportAuthMigrationTiming(
  onTiming: ((phase: string, durationMs: number) => void) | undefined,
  phase: string,
  startedAt: number,
): void {
  try {
    onTiming?.(phase, Math.round(performance.now() - startedAt));
  } catch {
    // Timing observers must not affect migration correctness.
  }
}

async function timeAuthMigrationPhase<T>(
  phase: string,
  run: () => Promise<T>,
  onTiming?: (phase: string, durationMs: number) => void,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await run();
  } finally {
    reportAuthMigrationTiming(onTiming, phase, startedAt);
  }
}

export async function readAthenaAuthSchemaStatus(
  db: AthenaAuthDatabase,
): Promise<AthenaAuthSchemaStatus> {
  const rows = await readAuthSchemaLedgerRows(db);
  return compareAthenaAuthLedgers(rows);
}

export async function inspectAthenaAuthSchema(
  db: AthenaAuthDatabase,
): Promise<AthenaAuthSchemaReadiness> {
  const ledgerRows = await readAuthSchemaLedgerRows(db);
  const ledger = compareAthenaAuthLedgers(ledgerRows);
  const plan = await planAthenaAuthSchema(db, {
    inspectSchema: true,
    ledgerRows,
  });
  const physicalSchemaDrift = plan.entries.flatMap(
    (entry) => entry.drift ?? [],
  );
  const physicalSchemaValid =
    !plan.hasBlockingDrift &&
    plan.entries.every(
      (entry) =>
        entry.ledgerState !== "applied" || entry.schemaState === "healthy",
    );
  return {
    currentGeneration: ledger.current,
    ledger,
    missingMigrations: ledger.missing,
    physicalSchemaDrift,
    physicalSchemaValid,
    ready: ledger.compatible && physicalSchemaValid,
    requiredGeneration: ledger.expected,
  };
}

export async function assertAthenaAuthSchemaCompatible(
  db: AthenaAuthDatabase,
  options: { inspectSchema?: boolean } = {},
): Promise<AthenaAuthSchemaCompatibility> {
  const readiness = options.inspectSchema
    ? await inspectAthenaAuthSchema(db)
    : undefined;
  const status = readiness?.ledger ?? (await readAthenaAuthSchemaStatus(db));
  if (status.compatible) {
    if (readiness && !readiness.physicalSchemaValid) {
      const formatted = formatSchemaPhysicalError(readiness);
      throw new AthenaAuthRuntimeError(500, formatted.message, {
        code: formatted.code,
      });
    }
    return status;
  }
  const formatted = formatSchemaCompatibilityError(status);
  throw new AthenaAuthRuntimeError(500, formatted.message, {
    code: formatted.code,
  });
}
