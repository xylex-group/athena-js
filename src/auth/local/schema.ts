import { checksumMigrationSql } from "../../migrations/checksum.ts";
import {
  ATHENA_AUTH_MIGRATION_ADVISORY_LOCK,
  ATHENA_AUTH_SCHEMA_GENERATION,
} from "../contract/index.ts";
import type { AthenaAuthDatabase } from "./database.ts";
import { assertQueryResult } from "./database.ts";
import { ATHENA_AUTH_EMAIL_SCHEMA_STATEMENTS } from "./email/schema-sql.ts";
import { AthenaAuthRuntimeError } from "./errors.ts";
import {
  type AthenaAuthLedgerHealth,
  classifyAuthLedgerQueryError,
  healthFromAuthPlan,
} from "./ledger-health.ts";
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
    {
      name: "022_add_updated_at_to_passkeys",
      sql: `
ALTER TABLE athena.passkeys ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
`,
      version: 22,
    },
    {
      name: "023_auth_observability",
      sql: `
CREATE TABLE IF NOT EXISTS athena.audit_log_auth (
    id UUID PRIMARY KEY,
    event_id UUID NOT NULL,
    trace_id TEXT NOT NULL,
    event TEXT NOT NULL,
    actor_kind TEXT NOT NULL,
    actor_user_id TEXT,
    actor_session_id TEXT,
    subject_type TEXT,
    subject_id TEXT,
    organization_id TEXT,
    previous JSONB,
    result JSONB,
    request_ip TEXT,
    request_user_agent TEXT,
    outcome TEXT NOT NULL DEFAULT 'success',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS audit_log_auth_event_id_idx
    ON athena.audit_log_auth(event_id);
CREATE INDEX IF NOT EXISTS audit_log_auth_trace_id_idx
    ON athena.audit_log_auth(trace_id);
CREATE INDEX IF NOT EXISTS audit_log_auth_event_created_at_idx
    ON athena.audit_log_auth(event, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_auth_actor_user_id_idx
    ON athena.audit_log_auth(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_auth_subject_idx
    ON athena.audit_log_auth(subject_type, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_auth_organization_id_idx
    ON athena.audit_log_auth(organization_id, created_at DESC);
CREATE TABLE IF NOT EXISTS athena.traces_auth (
    id UUID PRIMARY KEY,
    trace_id TEXT NOT NULL,
    event_id UUID,
    operation TEXT,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    actor_kind TEXT,
    actor_user_id TEXT,
    organization_id TEXT,
    outcome TEXT NOT NULL,
    status_code INTEGER,
    authorize_ms DOUBLE PRECISION,
    validate_ms DOUBLE PRECISION,
    before_hooks_ms DOUBLE PRECISION,
    transaction_ms DOUBLE PRECISION,
    after_hooks_ms DOUBLE PRECISION,
    total_ms DOUBLE PRECISION NOT NULL,
    error_code TEXT,
    error_phase TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS traces_auth_trace_id_idx
    ON athena.traces_auth(trace_id);
CREATE INDEX IF NOT EXISTS traces_auth_event_id_idx
    ON athena.traces_auth(event_id);
CREATE INDEX IF NOT EXISTS traces_auth_operation_started_at_idx
    ON athena.traces_auth(operation, started_at DESC);
CREATE INDEX IF NOT EXISTS traces_auth_outcome_started_at_idx
    ON athena.traces_auth(outcome, started_at DESC);
CREATE INDEX IF NOT EXISTS traces_auth_actor_user_id_idx
    ON athena.traces_auth(actor_user_id, started_at DESC);
`,
      version: 23,
    },
    ...ATHENA_AUTH_EMAIL_SCHEMA_STATEMENTS,
    {
      name: "025_add_aaguid_to_passkeys",
      sql: `
ALTER TABLE athena.passkeys ADD COLUMN IF NOT EXISTS aaguid TEXT;
`,
      version: 25,
    },
    {
      name: "026_passkey_resident_key_and_registration_transactions",
      sql: `
ALTER TABLE athena.passkeys ADD COLUMN IF NOT EXISTS resident_key BOOLEAN;
CREATE TABLE IF NOT EXISTS athena.passkey_registration_transactions (
    id TEXT PRIMARY KEY,
    challenge_hash TEXT NOT NULL,
    rp_id TEXT NOT NULL,
    user_handle TEXT NOT NULL,
    mode TEXT NOT NULL,
    context TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_passkey_reg_tx_challenge_hash
    ON athena.passkey_registration_transactions (challenge_hash);
CREATE INDEX IF NOT EXISTS idx_passkey_reg_tx_expires_at
    ON athena.passkey_registration_transactions (expires_at);
`,
      version: 26,
    },
    {
      name: "027_auth_bridge_codes",
      sql: `CREATE TABLE IF NOT EXISTS athena.auth_bridge_codes (id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL REFERENCES athena.sessions (id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES athena.users (id) ON DELETE CASCADE, organization_id TEXT, destination_origin TEXT NOT NULL, redirect_path TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ, consume_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE INDEX IF NOT EXISTS idx_auth_bridge_codes_expires_at ON athena.auth_bridge_codes (expires_at); CREATE INDEX IF NOT EXISTS idx_auth_bridge_codes_session_id ON athena.auth_bridge_codes (session_id); CREATE INDEX IF NOT EXISTS idx_auth_bridge_codes_user_id ON athena.auth_bridge_codes (user_id); CREATE INDEX IF NOT EXISTS idx_auth_bridge_codes_outstanding_session ON athena.auth_bridge_codes (session_id) WHERE consumed_at IS NULL;`,
      version: 27,
    },
    {
      name: "028_oauth_transactions",
      sql: `
CREATE TABLE IF NOT EXISTS athena.oauth_transactions (
    id TEXT PRIMARY KEY,
    state_hash TEXT NOT NULL UNIQUE,
    provider_id TEXT NOT NULL,
    intent TEXT NOT NULL,
    code_challenge_method TEXT NOT NULL,
    pkce_verifier_ciphertext TEXT NOT NULL,
    nonce_hash TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    user_id TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oauth_transactions_expires_at
    ON athena.oauth_transactions (expires_at);
`,
      version: 28,
    },
    {
      name: "029_notification_preferences",
      sql: `
CREATE TABLE IF NOT EXISTS athena.notification_preferences (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    organization_id TEXT NULL,
    channel TEXT NOT NULL,
    topic TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    digest TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_preferences_user_channel_topic
  ON athena.notification_preferences (user_id, channel, topic)
  WHERE organization_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_preferences_user_org_channel_topic
  ON athena.notification_preferences (user_id, organization_id, channel, topic)
  WHERE organization_id IS NOT NULL;
`,
      version: 29,
    },
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
  health: AthenaAuthLedgerHealth;
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

export interface AthenaAuthCanonicalMigration {
  name: string;
  sql: string;
  version: number;
}

/** Package-owned Auth generations (ledgered, version > 0). Execution SSOT. */
export function listAthenaAuthCanonicalMigrations(): AthenaAuthCanonicalMigration[] {
  return ledgeredStatements().map((statement) => ({
    name: statement.name,
    sql: statement.sql,
    version: statement.version,
  }));
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
    const kind = classifyAuthLedgerQueryError(error);
    if (kind === "UNINITIALIZED") {
      return [];
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
      if (classifyAuthLedgerQueryError(inner) === "UNINITIALIZED") {
        return [];
      }
      throw wrapAuthLedgerQueryError(inner);
    }
  }
}

function wrapAuthLedgerQueryError(error: unknown): AthenaAuthRuntimeError {
  if (
    error instanceof AthenaAuthRuntimeError &&
    (error.code === "ATHENA_AUTH_DATABASE_RESULT_INVALID" ||
      error.code === "ATHENA_AUTH_LEDGER_UNREACHABLE" ||
      error.code === "ATHENA_AUTH_LEDGER_PERMISSION_DENIED")
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
      { cause: error, code: "ATHENA_AUTH_DATABASE_RESULT_INVALID" }
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
      { cause: error, code: "ATHENA_AUTH_LEDGER_PERMISSION_DENIED" }
    );
  }
  return new AthenaAuthRuntimeError(
    503,
    [
      "ATHENA_AUTH_LEDGER_UNREACHABLE",
      "",
      "Embedded Auth could not reach the database to read the migration ledger.",
      "",
      error instanceof Error ? error.message : String(error),
    ].join("\n"),
    { cause: error, code: "ATHENA_AUTH_LEDGER_UNREACHABLE" }
  );
}

/**
 * Session advisory lock on this Auth database connection.
 * Distinct from application `pg_advisory_lock(ATHA, MIGS)` — that lock is held
 * on the migrate backend session and does not cover this connection.
 */
export async function withAthenaAuthMigrationLock<T>(
  db: AthenaAuthDatabase,
  fn: () => Promise<T>
): Promise<T> {
  await db.query(`SELECT pg_advisory_lock($1)`, [
    ATHENA_AUTH_MIGRATION_ADVISORY_LOCK,
  ]);
  try {
    return await fn();
  } finally {
    try {
      await db.query(`SELECT pg_advisory_unlock($1)`, [
        ATHENA_AUTH_MIGRATION_ADVISORY_LOCK,
      ]);
    } catch {
      // Session end / pool release drops session-level locks.
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
    throw wrapAuthLedgerQueryError(error);
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
      repairability: repairabilityForAuthMigration(),
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
  const hasBlockingDrift = driftCount > 0;

  return {
    entries,
    appliedCount,
    pendingCount,
    driftCount,
    conflictCount,
    hasBlockingDrift,
    health: healthFromAuthPlan({
      conflictCount,
      entries,
      hasBlockingDrift,
    }),
  };
}

export async function repairAthenaAuthSchema(
  db: AthenaAuthDatabase,
  options: { dryRun?: boolean } = {}
): Promise<AthenaAuthRepairResult> {
  return withAthenaAuthMigrationLock(db, async () => {
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
    // Transaction-scoped lock on the same key as the session lock (reentrant
    // in this session; blocks other Auth connections).
    await tx.query(`SELECT pg_advisory_xact_lock($1)`, [
      ATHENA_AUTH_MIGRATION_ADVISORY_LOCK,
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
  });
}

export async function migrateAthenaAuthSchema(
  db: AthenaAuthDatabase,
  options: { allowDrift?: boolean } = {}
): Promise<AthenaAuthSchemaStatus> {
  return withAthenaAuthMigrationLock(db, async () => {
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
      ATHENA_AUTH_MIGRATION_ADVISORY_LOCK,
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
  });
}

export async function readAthenaAuthSchemaStatus(
  db: AthenaAuthDatabase
): Promise<AthenaAuthSchemaStatus> {
  const rows = await readAuthSchemaLedgerRows(db);
  return compareAthenaAuthLedgers(rows);
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
