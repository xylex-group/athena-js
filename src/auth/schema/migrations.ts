/**
 * Immutable Embedded Auth migration SQL.
 *
 * CLI / managed-auth materialization may import this module.
 * Do not import auth/local/database, postgres/*, next/*, server.ts,
 * auth/server-entry, or server-only.
 */

import { ATHENA_AUTH_EMAIL_SCHEMA_STATEMENTS } from "../local/email/schema-sql.ts";

export interface AthenaAuthCanonicalMigration {
	name: string;
	sql: string;
	version: number;
}

const ATHENA_AUTH_SCHEMA_STATEMENTS: readonly AthenaAuthCanonicalMigration[] = [
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

export const ATHENA_AUTH_CANONICAL_MIGRATIONS: readonly AthenaAuthCanonicalMigration[] =
	ATHENA_AUTH_SCHEMA_STATEMENTS.filter((statement) => statement.version > 0).sort(
		(left, right) => left.version - right.version,
	);

export function listAthenaAuthCanonicalMigrations(): AthenaAuthCanonicalMigration[] {
	return [...ATHENA_AUTH_CANONICAL_MIGRATIONS];
}

export function listAthenaAuthSchemaSqlStatements(): AthenaAuthCanonicalMigration[] {
	return [...ATHENA_AUTH_SCHEMA_STATEMENTS];
}
