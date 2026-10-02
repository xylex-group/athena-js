/**
 * Immutable Embedded Auth migration SQL.
 *
 * CLI / managed-auth materialization may import this module.
 * Do not import auth/local/database, postgres/*, next/*, server.ts,
 * auth/server-entry, or server-only.
 */

import {
  ATHENA_AUTHORIZATION_ASSIGNMENT_SQL,
  ATHENA_AUTHORIZATION_CONSTRAINTS_SQL,
  ATHENA_AUTHORIZATION_MULTI_ROLE_SQL,
} from "../local/authorization-sql.ts";
import { ATHENA_AUTH_EMAIL_SCHEMA_STATEMENTS } from "../local/email/schema-sql.ts";
import {
  ATHENA_AUTH_EMAIL_FAILURE_PROVENANCE_SQL,
  ATHENA_AUTH_SIGNING_KEYS_SQL,
} from "../local/signing-keys-sql.ts";
import { ATHENA_AUTH_SCHEMA_GENERATION } from "./generation.ts";

export { ATHENA_AUTH_SCHEMA_GENERATION } from "./generation.ts";

export interface AthenaAuthCanonicalMigration {
  name: string;
  sql: string;
  version: number;
}

export const ATHENA_AUTH_SCHEMA_STATEMENTS: readonly AthenaAuthCanonicalMigration[] = [
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
    sql: "CREATE TABLE IF NOT EXISTS athena.auth_bridge_codes (id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL REFERENCES athena.sessions (id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES athena.users (id) ON DELETE CASCADE, organization_id TEXT, destination_origin TEXT NOT NULL, redirect_path TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ, consume_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE INDEX IF NOT EXISTS idx_auth_bridge_codes_expires_at ON athena.auth_bridge_codes (expires_at); CREATE INDEX IF NOT EXISTS idx_auth_bridge_codes_session_id ON athena.auth_bridge_codes (session_id); CREATE INDEX IF NOT EXISTS idx_auth_bridge_codes_user_id ON athena.auth_bridge_codes (user_id); CREATE INDEX IF NOT EXISTS idx_auth_bridge_codes_outstanding_session ON athena.auth_bridge_codes (session_id) WHERE consumed_at IS NULL;",
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
  {
    name: "030_organization_created_by",
    sql: `
ALTER TABLE athena.organization
  ADD COLUMN IF NOT EXISTS created_by_user_id TEXT;
UPDATE athena.organization AS org
SET created_by_user_id = founder.user_id
FROM (
  SELECT DISTINCT ON (organization_id)
    organization_id,
    user_id
  FROM athena.member
  WHERE role = 'owner'
  ORDER BY organization_id, created_at ASC, id ASC
) AS founder
WHERE org.created_by_user_id IS NULL
  AND founder.organization_id = org.id;
CREATE INDEX IF NOT EXISTS idx_organization_created_by_user_id
  ON athena.organization (created_by_user_id);
`,
    version: 30,
  },
  {
    name: "031_authorization_assignment",
    sql: ATHENA_AUTHORIZATION_ASSIGNMENT_SQL,
    version: 31,
  },
  {
    name: "032_authorization_assignment_constraints",
    sql: ATHENA_AUTHORIZATION_CONSTRAINTS_SQL,
    version: 32,
  },
  {
    name: "033_auth_signing_keys",
    sql: ATHENA_AUTH_SIGNING_KEYS_SQL,
    version: 33,
  },
  {
    name: "034_email_failure_provenance",
    sql: ATHENA_AUTH_EMAIL_FAILURE_PROVENANCE_SQL,
    version: 34,
  },
  {
    name: "035_authorization_multi_role_assignments",
    sql: ATHENA_AUTHORIZATION_MULTI_ROLE_SQL,
    version: 35,
  },
  {
    name: "036_api_key_organization_scope",
    sql: `
ALTER TABLE athena.api_keys
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES athena.organization (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_organization_id
  ON athena.api_keys (organization_id);
`,
    version: 36,
  },
  {
    name: "037_api_key_scope_discriminator",
    sql: `
ALTER TABLE athena.api_keys
  ADD COLUMN IF NOT EXISTS scope_kind TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE athena.api_keys
  DROP CONSTRAINT IF EXISTS api_keys_organization_id_fkey;
ALTER TABLE athena.api_keys
  ADD CONSTRAINT api_keys_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES athena.organization (id) ON DELETE CASCADE;
ALTER TABLE athena.api_keys
  DROP CONSTRAINT IF EXISTS api_keys_scope_kind_check;
ALTER TABLE athena.api_keys
  ADD CONSTRAINT api_keys_scope_kind_check
  CHECK (
    (scope_kind = 'organization' AND organization_id IS NOT NULL)
    OR
    (scope_kind IN ('legacy', 'platform') AND organization_id IS NULL)
  );
`,
    version: 37,
  },
  {
    name: "038_auth_rate_limits",
    sql: `
CREATE TABLE IF NOT EXISTS athena.auth_rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_reset_at
  ON athena.auth_rate_limits (reset_at);
`,
    version: 38,
  },
  {
    name: "039_oauth_clients",
    sql: `
CREATE TABLE IF NOT EXISTS athena.oauth_clients (
    id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    client_type TEXT NOT NULL DEFAULT 'public',
    registration_kind TEXT NOT NULL DEFAULT 'pre-registered',
    provider TEXT,
    response_type TEXT NOT NULL DEFAULT 'code',
    grant_type TEXT NOT NULL DEFAULT 'authorization_code',
    token_authentication_method TEXT NOT NULL DEFAULT 'none',
    redirect_uris TEXT[] NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT '{}',
    resource_uris TEXT[] NOT NULL DEFAULT '{}',
    client_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT oauth_clients_type_check CHECK (client_type = 'public'),
    CONSTRAINT oauth_clients_response_type_check CHECK (response_type = 'code'),
    CONSTRAINT oauth_clients_grant_type_check CHECK (grant_type = 'authorization_code'),
    CONSTRAINT oauth_clients_token_auth_check CHECK (token_authentication_method = 'none')
);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_active
  ON athena.oauth_clients (is_active);
`,
    version: 39,
  },
  {
    name: "040_oauth_authorization_grants",
    sql: `
CREATE TABLE IF NOT EXISTS athena.oauth_authorization_grants (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES athena.users (id) ON DELETE CASCADE,
    organization_id TEXT REFERENCES athena.organization (id) ON DELETE CASCADE,
    client_id TEXT NOT NULL REFERENCES athena.oauth_clients (id) ON DELETE CASCADE,
    resource TEXT NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    authorized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoked_by TEXT,
    revoke_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT oauth_grants_status_check
      CHECK (status IN ('active', 'expired', 'revoked')),
    CONSTRAINT oauth_grants_revoked_state_check
      CHECK ((status = 'revoked' AND revoked_at IS NOT NULL) OR status <> 'revoked')
);
CREATE INDEX IF NOT EXISTS idx_oauth_grants_user_id
  ON athena.oauth_authorization_grants (user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_grants_client_id
  ON athena.oauth_authorization_grants (client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_grants_organization_id
  ON athena.oauth_authorization_grants (organization_id);
CREATE INDEX IF NOT EXISTS idx_oauth_grants_status
  ON athena.oauth_authorization_grants (status);
CREATE INDEX IF NOT EXISTS idx_oauth_grants_expires_at
  ON athena.oauth_authorization_grants (expires_at);
DROP INDEX IF EXISTS athena.uq_oauth_grants_client_user_resource;
CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_grants_client_user_resource_org
  ON athena.oauth_authorization_grants (client_id, user_id, organization_id, resource)
  WHERE status = 'active' AND organization_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_grants_client_user_resource_platform
  ON athena.oauth_authorization_grants (client_id, user_id, resource)
  WHERE status = 'active' AND organization_id IS NULL;
`,
    version: 40,
  },
  {
    name: "041_oauth_authorization_requests",
    sql: `
CREATE TABLE IF NOT EXISTS athena.oauth_authorization_requests (
    id TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL REFERENCES athena.oauth_clients (id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL,
    resource TEXT NOT NULL,
    requested_scopes TEXT[] NOT NULL DEFAULT '{}',
    state_ciphertext TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    code_challenge_method TEXT NOT NULL DEFAULT 'S256',
    user_id TEXT REFERENCES athena.users (id) ON DELETE CASCADE,
    organization_id TEXT REFERENCES athena.organization (id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    CONSTRAINT oauth_requests_status_check
      CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'consumed')),
    CONSTRAINT oauth_requests_pkce_check
      CHECK (code_challenge_method = 'S256')
);
CREATE INDEX IF NOT EXISTS idx_oauth_requests_expires_at
  ON athena.oauth_authorization_requests (expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_requests_user_id
  ON athena.oauth_authorization_requests (user_id);
`,
    version: 41,
  },
  {
    name: "042_oauth_authorization_codes",
    sql: `
CREATE TABLE IF NOT EXISTS athena.oauth_authorization_codes (
    id TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,
    grant_id TEXT NOT NULL REFERENCES athena.oauth_authorization_grants (id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES athena.users (id) ON DELETE CASCADE,
    organization_id TEXT REFERENCES athena.organization (id) ON DELETE CASCADE,
    client_id TEXT NOT NULL REFERENCES athena.oauth_clients (id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL,
    resource TEXT NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT '{}',
    code_challenge TEXT NOT NULL,
    code_challenge_method TEXT NOT NULL DEFAULT 'S256',
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    consume_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT oauth_codes_pkce_check
      CHECK (code_challenge_method = 'S256')
);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires_at
  ON athena.oauth_authorization_codes (expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_grant_id
  ON athena.oauth_authorization_codes (grant_id);
`,
    version: 42,
  },
  {
    name: "043_oauth_refresh_tokens",
    sql: `
CREATE TABLE IF NOT EXISTS athena.oauth_refresh_tokens (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    family_id TEXT NOT NULL,
    grant_id TEXT NOT NULL REFERENCES athena.oauth_authorization_grants (id) ON DELETE CASCADE,
    client_id TEXT NOT NULL REFERENCES athena.oauth_clients (id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES athena.users (id) ON DELETE CASCADE,
    organization_id TEXT REFERENCES athena.organization (id) ON DELETE CASCADE,
    resource TEXT NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT '{}',
    parent_token_id TEXT REFERENCES athena.oauth_refresh_tokens (id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active',
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    rotated_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoke_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT oauth_refresh_status_check
      CHECK (status IN ('active', 'rotated', 'revoked', 'expired', 'reuse_detected'))
);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_family_id
  ON athena.oauth_refresh_tokens (family_id);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_grant_id
  ON athena.oauth_refresh_tokens (grant_id);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_expires_at
  ON athena.oauth_refresh_tokens (expires_at);
`,
    version: 43,
  },
  {
    name: "044_oauth_revoked_access_tokens",
    sql: `
CREATE TABLE IF NOT EXISTS athena.oauth_revoked_access_tokens (
    jti TEXT PRIMARY KEY,
    grant_id TEXT NOT NULL REFERENCES athena.oauth_authorization_grants (id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_oauth_revoked_access_tokens_expires_at
  ON athena.oauth_revoked_access_tokens (expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_revoked_access_tokens_grant_id
  ON athena.oauth_revoked_access_tokens (grant_id);
`,
    version: 44,
  },
  {
    name: "045_session_authentication_context",
    sql: `
ALTER TABLE athena.sessions
  ADD COLUMN IF NOT EXISTS authenticated_at TIMESTAMPTZ;
UPDATE athena.sessions
  SET authenticated_at = created_at
  WHERE authenticated_at IS NULL;
ALTER TABLE athena.sessions
  ALTER COLUMN authenticated_at SET NOT NULL;
ALTER TABLE athena.sessions
  ADD COLUMN IF NOT EXISTS authentication_methods TEXT[] NOT NULL DEFAULT '{}';
`,
    version: 45,
  },
  {
    name: "046_oauth_oidc_authorization_context",
    sql: `
ALTER TABLE athena.oauth_authorization_grants
  ADD COLUMN IF NOT EXISTS identity_scopes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE athena.oauth_authorization_requests
  ADD COLUMN IF NOT EXISTS identity_scopes TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS nonce TEXT,
  ADD COLUMN IF NOT EXISTS max_age INTEGER,
  ADD COLUMN IF NOT EXISTS prompt TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE athena.oauth_authorization_codes
  ADD COLUMN IF NOT EXISTS nonce TEXT,
  ADD COLUMN IF NOT EXISTS identity_scopes TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS authenticated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS authentication_methods TEXT[] NOT NULL DEFAULT '{}';
UPDATE athena.oauth_authorization_codes
  SET authenticated_at = created_at
  WHERE authenticated_at IS NULL;
ALTER TABLE athena.oauth_authorization_codes
  ALTER COLUMN authenticated_at SET NOT NULL;
ALTER TABLE athena.oauth_authorization_requests
  ADD CONSTRAINT oauth_requests_max_age_check
    CHECK (max_age IS NULL OR max_age BETWEEN 0 AND 2147483647),
  ADD CONSTRAINT oauth_requests_prompt_check
    CHECK (prompt <@ ARRAY['none', 'login', 'consent']::TEXT[]
      AND NOT ('none' = ANY(prompt) AND cardinality(prompt) > 1));
ALTER TABLE athena.oauth_authorization_grants
  ADD CONSTRAINT oauth_grants_identity_scopes_check
    CHECK (identity_scopes <@ ARRAY['openid', 'profile', 'email']::TEXT[]);
ALTER TABLE athena.oauth_authorization_codes
  ADD CONSTRAINT oauth_codes_identity_scopes_check
    CHECK (identity_scopes <@ ARRAY['openid', 'profile', 'email']::TEXT[]);
ALTER TABLE athena.oauth_authorization_requests
  ADD CONSTRAINT oauth_requests_identity_scopes_check
    CHECK (identity_scopes <@ ARRAY['openid', 'profile', 'email']::TEXT[]);
`,
    version: 46,
  },
  {
    name: "047_oidc_refresh_scope_and_signing_algorithms",
    sql: `
ALTER TABLE athena.oauth_refresh_tokens
  ADD COLUMN IF NOT EXISTS identity_scopes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE athena.oauth_refresh_tokens
  ADD CONSTRAINT oauth_refresh_identity_scopes_check
    CHECK (identity_scopes <@ ARRAY['openid', 'profile', 'email']::TEXT[]);
DROP INDEX IF EXISTS athena.uq_auth_signing_keys_active_issuer;
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_signing_keys_active_issuer
  ON athena.auth_signing_keys (issuer, algorithm)
  WHERE status = 'active';
`,
    version: 47,
  },
  {
    name: "048_identity_connections",
    sql: `
CREATE TABLE IF NOT EXISTS athena.identity_connections (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES athena.organization (id) ON DELETE CASCADE,
    connection_type TEXT NOT NULL DEFAULT 'oidc',
    name TEXT NOT NULL,
    issuer TEXT NOT NULL,
    client_id TEXT NOT NULL,
    resource_uri TEXT,
    token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
    credential_ref TEXT,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    domains TEXT[] NOT NULL DEFAULT '{}',
    jit_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    jit_default_role_id TEXT REFERENCES athena.authorization_roles (id) ON DELETE RESTRICT,
    authentication_required BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT identity_connections_type_check CHECK (connection_type = 'oidc'),
    CONSTRAINT identity_connections_auth_method_check
      CHECK (token_endpoint_auth_method IN ('client_secret_basic', 'client_secret_post', 'none'))
);
CREATE INDEX IF NOT EXISTS idx_identity_connections_organization
  ON athena.identity_connections (organization_id, enabled);
CREATE INDEX IF NOT EXISTS idx_identity_connections_domains
  ON athena.identity_connections USING GIN (domains);

CREATE TABLE IF NOT EXISTS athena.federated_identities (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES athena.identity_connections (id) ON DELETE CASCADE,
    issuer TEXT NOT NULL,
    subject TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES athena.users (id) ON DELETE CASCADE,
    last_authenticated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT federated_identities_connection_issuer_subject_key
      UNIQUE (connection_id, issuer, subject)
);
CREATE INDEX IF NOT EXISTS idx_federated_identities_user
  ON athena.federated_identities (user_id);
`,
    version: 48,
  },
];

export const ATHENA_AUTH_CANONICAL_MIGRATIONS: readonly AthenaAuthCanonicalMigration[] =
  ATHENA_AUTH_SCHEMA_STATEMENTS.filter(
    (statement) => statement.version > 0
  ).sort((left, right) => left.version - right.version);

function latestCanonicalMigration(): AthenaAuthCanonicalMigration {
  const latest = ATHENA_AUTH_CANONICAL_MIGRATIONS.at(-1);
  if (latest == null) {
    throw new Error("Embedded Auth canonical migration catalog is empty.");
  }
  return latest;
}

export const ATHENA_AUTH_LATEST_MIGRATION = latestCanonicalMigration();

if (ATHENA_AUTH_LATEST_MIGRATION.version !== ATHENA_AUTH_SCHEMA_GENERATION) {
  throw new Error(
    `Embedded Auth catalog latest version ${String(ATHENA_AUTH_LATEST_MIGRATION.version)} does not match ATHENA_AUTH_SCHEMA_GENERATION ${String(ATHENA_AUTH_SCHEMA_GENERATION)}.`
  );
}

export function listAthenaAuthCanonicalMigrations(): AthenaAuthCanonicalMigration[] {
  return [...ATHENA_AUTH_CANONICAL_MIGRATIONS];
}

export function listAthenaAuthSchemaSqlStatements(): AthenaAuthCanonicalMigration[] {
  return [...ATHENA_AUTH_SCHEMA_STATEMENTS];
}
