import { checksumMigrationSql } from "../../migrations/checksum.ts";
import {
  ATHENA_AUTH_INIT_ADVISORY_LOCK,
  ATHENA_AUTH_SCHEMA_GENERATION,
} from "../contract/index.ts";
import type { AthenaAuthDatabase } from "./database.ts";
import { assertQueryResult } from "./database.ts";
import { ATHENA_AUTH_EMAIL_SCHEMA_STATEMENTS } from "./email/schema-sql.ts";
import { AthenaAuthRuntimeError } from "./errors.ts";
import type { AthenaAuthSchemaDrift } from "./schema-inspect.ts";
import { inspectAthenaAuthExpectations } from "./schema-inspect.ts";
import {
  ATHENA_AUTH_MIGRATION_EXPECTATIONS,
  type MigrationRepairability,
  repairabilityForAuthMigration,
} from "./schema-manifest.ts";

const SCHEMA_STATEMENTS: ReadonlyArray<{ name: string; sql: string; version: number }> = [
    {
      name: "001_create_schema",
      sql: "CREATE SCHEMA IF NOT EXISTS athena",
      version: 0,
    },
    {
      name: "001_create_core_tables",
      sql: `
CREATE TABLE IF NOT EXISTS athena.users (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT UNIQUE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    image TEXT,
    username TEXT UNIQUE,
    display_username TEXT,
    two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    role TEXT,
    banned BOOLEAN NOT NULL DEFAULT FALSE,
    ban_reason TEXT,
    ban_expires TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS athena.sessions (
    id TEXT PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL,
    token TEXT NOT NULL UNIQUE,
    ip_address TEXT,
    user_agent TEXT,
    user_id TEXT NOT NULL REFERENCES athena.users (id) ON DELETE CASCADE,
    impersonated_by TEXT,
    active_organization_id TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS athena.accounts (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES athena.users (id) ON DELETE CASCADE,
    access_token TEXT,
    refresh_token TEXT,
    id_token TEXT,
    access_token_expires_at TIMESTAMPTZ,
    refresh_token_expires_at TIMESTAMPTZ,
    scope TEXT,
    password TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider_id, account_id)
);
CREATE TABLE IF NOT EXISTS athena.verifications (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON athena.users (email);
CREATE INDEX IF NOT EXISTS idx_users_username ON athena.users (username);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON athena.sessions (token);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON athena.sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON athena.sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON athena.accounts (user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_provider_account ON athena.accounts (provider_id, account_id);
`,
      version: 1,
    },
    {
      name: "002_create_organization_tables",
      sql: `
CREATE TABLE IF NOT EXISTS athena.organization (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    logo TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS athena.member (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES athena.organization (id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES athena.users (id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, user_id)
);
CREATE TABLE IF NOT EXISTS athena.invitation (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES athena.organization (id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    status TEXT NOT NULL DEFAULT 'pending',
    inviter_id TEXT NOT NULL REFERENCES athena.users (id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_organization_slug ON athena.organization (slug);
CREATE INDEX IF NOT EXISTS idx_member_organization_id ON athena.member (organization_id);
CREATE INDEX IF NOT EXISTS idx_member_user_id ON athena.member (user_id);
CREATE INDEX IF NOT EXISTS idx_invitation_organization_id ON athena.invitation (organization_id);
CREATE INDEX IF NOT EXISTS idx_invitation_email ON athena.invitation (email);
`,
      version: 2,
    },
    {
      name: "003_create_two_factor_table",
      sql: `
CREATE TABLE IF NOT EXISTS athena.two_factor (
    id TEXT PRIMARY KEY,
    secret TEXT NOT NULL,
    backup_codes TEXT,
    user_id TEXT NOT NULL REFERENCES athena.users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id)
);
CREATE INDEX IF NOT EXISTS idx_two_factor_user_id ON athena.two_factor (user_id);
`,
      version: 3,
    },
    {
      name: "004_create_api_key_table",
      sql: `
CREATE TABLE IF NOT EXISTS athena.api_keys (
    id TEXT PRIMARY KEY,
    name TEXT,
    start TEXT,
    prefix TEXT,
    key TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES athena.users (id) ON DELETE CASCADE,
    refill_interval INTEGER,
    refill_amount INTEGER,
    last_refill_at TIMESTAMPTZ,
    enabled BOOLEAN NOT NULL DEFAULT true,
    rate_limit_enabled BOOLEAN NOT NULL DEFAULT false,
    rate_limit_time_window INTEGER,
    rate_limit_max INTEGER,
    request_count INTEGER DEFAULT 0,
    remaining INTEGER,
    last_request TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    permissions TEXT,
    metadata TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON athena.api_keys (user_id);
`,
      version: 4,
    },
    {
      name: "005_create_passkey_table",
      sql: `
CREATE TABLE IF NOT EXISTS athena.passkeys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES athena.users (id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL UNIQUE,
    counter BIGINT NOT NULL DEFAULT 0,
    device_type TEXT NOT NULL DEFAULT 'singleDevice',
    backed_up BOOLEAN NOT NULL DEFAULT FALSE,
    transports TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_passkeys_user_id ON athena.passkeys (user_id);
CREATE INDEX IF NOT EXISTS idx_passkeys_credential_id ON athena.passkeys (credential_id);
`,
      version: 5,
    },
    {
      name: "009_add_last_sign_in_at_to_users",
      sql: `
ALTER TABLE athena.users ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_last_sign_in_at ON athena.users (last_sign_in_at);
`,
      version: 9,
    },
    {
      name: "021_runtime_key_and_ledger",
      sql: `
CREATE TABLE IF NOT EXISTS athena.auth_schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS athena.runtime_key (
    key_id TEXT PRIMARY KEY,
    purpose TEXT NOT NULL,
    key_material TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retired_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_key_active_purpose
    ON athena.runtime_key (purpose)
    WHERE retired_at IS NULL;
`,
      version: 21,
    },
    ...ATHENA_AUTH_EMAIL_SCHEMA_STATEMENTS,
  ];

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

export type AthenaAuthSchemaStatus = AthenaAuthSchemaCompatibility;

export type AthenaAuthLedgerState =
  | "absent"
  | "applied"
  | "checksum-mismatch"
  | "unknown";

export type AthenaAuthSchemaState = "unknown" | "healthy" | "drift";

export type AthenaAuthMigrationAction =
  | "none"
  | "apply"
  | "repair"
  | "blocked";

export interface AthenaAuthMigrationPlanEntry {
  version: number;
  name: string;
  checksum: string;
  ledgerState: AthenaAuthLedgerState;
  schemaState: AthenaAuthSchemaState;
  action: AthenaAuthMigrationAction;
  repairability: MigrationRepairability;
  drift?: AthenaAuthSchemaDrift[];
}

export interface AthenaAuthMigrationPlan {
  entries: AthenaAuthMigrationPlanEntry[];
  appliedCount: number;
  pendingCount: number;
  driftCount: number;
  conflictCount: number;
  hasBlockingDrift: boolean;
}

export interface AthenaAuthRepairResult {
  repaired: AthenaAuthMigrationPlanEntry[];
  skipped: AthenaAuthMigrationPlanEntry[];
  dryRun: boolean;
}

function ledgeredStatements(): Array<(typeof SCHEMA_STATEMENTS)[number]> {
  return SCHEMA_STATEMENTS.filter((statement) => statement.version > 0).sort(
    (a, b) => a.version - b.version
  );
}

function statementByVersion(
  version: number
): (typeof SCHEMA_STATEMENTS)[number] | undefined {
  return SCHEMA_STATEMENTS.find((statement) => statement.version === version);
}

export function getAthenaAuthExpectedLedger(): AthenaAuthLedgerEntry[] {
  return ledgeredStatements().map((statement) => ({
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
  actual: ReadonlyArray<Pick<AthenaAuthLedgerEntry, "checksum" | "version">>,
  expected: readonly AthenaAuthLedgerEntry[] = getAthenaAuthExpectedLedger()
): AthenaAuthSchemaCompatibility {
  const expectedByVersion = new Map(
    expected.map((entry) => [entry.version, entry])
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
    expectedByVersion.has(version)
  );
  const maxAppliedExpected = maxVersion(appliedExpected);
  const hasHole = missing.some((version) => version < maxAppliedExpected);
  const hasNewerUnknown = unknown.some((version) => version > expectedGeneration);

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
  expected: number = ATHENA_AUTH_SCHEMA_GENERATION
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

function formatSchemaCompatibilityError(status: AthenaAuthSchemaCompatibility): {
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
      message: `ATHENA_AUTH_SCHEMA_DRIFT\n\nEmbedded Athena Auth schema history diverged.\nRuntime generation ${status.expected}. Database generation ${status.current}.\n\nRun:\n\n    npx athena-js migrate\n${formatMissingLines(status.missing)}${mismatch}${unknown}`,
    };
  }
  if (status.current === 0) {
    return {
      code: "ATHENA_AUTH_SCHEMA_MISSING",
      message:
        "ATHENA_AUTH_SCHEMA_MISSING\n\nAthena Auth schema is not installed.\n\nRun:\n\n    npx athena-js migrate",
    };
  }
  return {
    code: "ATHENA_AUTH_SCHEMA_OUTDATED",
    message: `ATHENA_AUTH_SCHEMA_OUTDATED\n\nEmbedded Athena Auth requires schema generation ${status.expected}.\nDatabase currently has generation ${status.current}.\n\nRun:\n\n    npx athena-js migrate${formatMissingLines(status.missing)}`,
  };
}

async function readAuthSchemaLedgerRows(
  db: AthenaAuthDatabase
): Promise<AthenaAuthLedgerEntry[]> {
  try {
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
        "SELECT version, name, checksum FROM athena.auth_schema_migrations ORDER BY version"
      ),
      "reading migration ledger"
    );
    return applied.rows.map((row) => ({
      checksum: row.checksum,
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
    try {
      const applied = assertQueryResult<{ name?: string; version: number }>(
        await db.query<{ name?: string; version: number }>(
          "SELECT version, name FROM athena.auth_schema_migrations ORDER BY version"
        ),
        "reading migration ledger (legacy columns)"
      );
      return applied.rows.map((row) => ({
        name: row.name ?? expectedName(Number(row.version)),
        version: Number(row.version),
      }));
    } catch (inner) {
      if (
        inner instanceof AthenaAuthRuntimeError &&
        inner.code === "ATHENA_AUTH_DATABASE_RESULT_INVALID"
      ) {
        throw inner;
      }
      throw error;
    }
  }
}

function formatDriftBlock(entries: readonly AthenaAuthMigrationPlanEntry[]): string {
  const drifted = entries.filter(
    (entry) => entry.schemaState === "drift" || entry.action === "repair"
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
  options: { inspectSchema?: boolean } = {}
): Promise<AthenaAuthMigrationPlan> {
  const inspectSchema = options.inspectSchema !== false;
  const expected = getAthenaAuthExpectedLedger();
  let actualRows: AthenaAuthLedgerEntry[] = [];
  try {
    actualRows = await readAuthSchemaLedgerRows(db);
  } catch (error) {
    if (
      error instanceof AthenaAuthRuntimeError &&
      error.code === "ATHENA_AUTH_DATABASE_RESULT_INVALID"
    ) {
      throw error;
    }
    actualRows = [];
  }

  const actualByVersion = new Map(
    actualRows.map((row) => [Number(row.version), row])
  );
  const expectedVersions = new Set(expected.map((entry) => entry.version));

  const entries: AthenaAuthMigrationPlanEntry[] = [];

  for (const entry of expected) {
    const applied = actualByVersion.get(entry.version);
    let ledgerState: AthenaAuthLedgerState = "absent";
    if (applied) {
      const checksum = applied.checksum?.trim() ?? "";
      if (
        entry.checksum &&
        checksum &&
        checksum !== entry.checksum
      ) {
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
        try {
          drift = await inspectAthenaAuthExpectations(db, expectations);
          schemaState = drift.length > 0 ? "drift" : "healthy";
        } catch (error) {
          if (
            error instanceof AthenaAuthRuntimeError &&
            error.code === "ATHENA_AUTH_DATABASE_RESULT_INVALID"
          ) {
            throw error;
          }
          schemaState = "unknown";
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
      version: entry.version,
      name: entry.name,
      checksum: entry.checksum ?? "",
      ledgerState,
      schemaState,
      action,
      repairability: repairabilityForAuthMigration(entry.version),
      drift,
    });
  }

  for (const [version, row] of actualByVersion) {
    if (expectedVersions.has(version)) {
      continue;
    }
    entries.push({
      version,
      name: row.name ?? String(version).padStart(3, "0"),
      checksum: row.checksum ?? "",
      ledgerState: "unknown",
      schemaState: "unknown",
      action: "blocked",
      repairability: "manual",
    });
  }

  entries.sort((a, b) => a.version - b.version);

  const appliedCount = entries.filter((e) => e.ledgerState === "applied" && e.schemaState !== "drift").length;
  const pendingCount = entries.filter((e) => e.action === "apply").length;
  const driftCount = entries.filter((e) => e.schemaState === "drift").length;
  const conflictCount = entries.filter(
    (e) => e.action === "blocked" || e.ledgerState === "checksum-mismatch"
  ).length;

  return {
    entries,
    appliedCount,
    pendingCount,
    driftCount,
    conflictCount,
    hasBlockingDrift: driftCount > 0,
  };
}

export async function repairAthenaAuthSchema(
  db: AthenaAuthDatabase,
  options: { dryRun?: boolean } = {}
): Promise<AthenaAuthRepairResult> {
  const plan = await planAthenaAuthSchema(db, { inspectSchema: true });
  const toRepair = plan.entries.filter((entry) => entry.action === "repair");
  const skipped = toRepair.filter((entry) => entry.repairability !== "idempotent");
  const repairable = toRepair.filter((entry) => entry.repairability === "idempotent");

  if (options.dryRun) {
    return { repaired: repairable, skipped, dryRun: true };
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
      { code: "ATHENA_AUTH_SCHEMA_REPAIR_MANUAL" }
    );
  }

  await db.transaction(async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock($1)`, [
      ATHENA_AUTH_INIT_ADVISORY_LOCK,
    ]);
    for (const entry of repairable) {
      const statement = statementByVersion(entry.version);
      if (!statement) {
        continue;
      }
      await tx.query(statement.sql);
    }
  });

  return { repaired: repairable, skipped, dryRun: false };
}

export async function migrateAthenaAuthSchema(
  db: AthenaAuthDatabase,
  options: { allowDrift?: boolean } = {}
): Promise<AthenaAuthSchemaStatus> {
  const expected = getAthenaAuthExpectedLedger();

  // Fail closed: ledger-applied migrations with physical drift must not be
  // silently repaired by normal migrate.
  if (!options.allowDrift) {
    const plan = await planAthenaAuthSchema(db, { inspectSchema: true });
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
          "    athena-js migrate repair",
        ].join("\n"),
        { code: "ATHENA_AUTH_SCHEMA_DRIFT" }
      );
    }
  }

  await db.transaction(async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock($1)`, [
      ATHENA_AUTH_INIT_ADVISORY_LOCK,
    ]);
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

    const appliedRows = await readAuthSchemaLedgerRows(tx);
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
        direction: "history-diverged",
        compatible: false,
      });
      throw new AthenaAuthRuntimeError(500, formatted.message, {
        code: formatted.code,
      });
    }

    const appliedVersions = new Set(appliedRows.map((row) => row.version));

    // Ensure schema exists first (version 0), then apply in numeric order.
    const bootstrap = SCHEMA_STATEMENTS.find((s) => s.version === 0);
    if (bootstrap) {
      await tx.query(bootstrap.sql);
    }

    for (const statement of ledgeredStatements()) {
      if (appliedVersions.has(statement.version)) {
        continue;
      }
      const checksum = checksumMigrationSql(statement.sql);
      await tx.query(statement.sql);
      await tx.query(
        "INSERT INTO athena.auth_schema_migrations (version, name, checksum) VALUES ($1, $2, $3) ON CONFLICT (version) DO NOTHING",
        [statement.version, statement.name, checksum]
      );
    }

    for (const entry of expected) {
      if (!appliedVersions.has(entry.version) || !entry.checksum) {
        continue;
      }
      await tx.query(
        `UPDATE athena.auth_schema_migrations
         SET checksum = $1
         WHERE version = $2 AND (checksum IS NULL OR checksum = '')`,
        [entry.checksum, entry.version]
      );
    }
  });

  return readAthenaAuthSchemaStatus(db);
}

export async function readAthenaAuthSchemaStatus(
  db: AthenaAuthDatabase
): Promise<AthenaAuthSchemaStatus> {
  try {
    const rows = await readAuthSchemaLedgerRows(db);
    return compareAthenaAuthLedgers(rows);
  } catch {
    return compareAthenaAuthLedgers([]);
  }
}

export async function assertAthenaAuthSchemaCompatible(
  db: AthenaAuthDatabase
): Promise<AthenaAuthSchemaCompatibility> {
  const status = await readAthenaAuthSchemaStatus(db);
  if (status.compatible) {
    return status;
  }
  const formatted = formatSchemaCompatibilityError(status);
  throw new AthenaAuthRuntimeError(500, formatted.message, {
    code: formatted.code,
  });
}
