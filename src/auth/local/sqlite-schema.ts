/**
 * SQLite-authored Auth schema. Independently specified from PostgreSQL
 * migrations; createClient never executes these statements.
 */
export const ATHENA_AUTH_SQLITE_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS athena_auth_user (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    name TEXT,
    image TEXT,
    username TEXT UNIQUE,
    display_username TEXT,
    email_verified INTEGER NOT NULL DEFAULT 0,
    two_factor_enabled INTEGER NOT NULL DEFAULT 0,
    role TEXT,
    banned INTEGER NOT NULL DEFAULT 0,
    ban_reason TEXT,
    ban_expires TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS athena_auth_session (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    impersonated_by TEXT,
    active_organization_id TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    authenticated_at TEXT NOT NULL,
    authentication_methods TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES athena_auth_user(id)
  )`,
  `CREATE TABLE IF NOT EXISTS athena_auth_account (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    password TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES athena_auth_user(id)
  )`,
  `CREATE TABLE IF NOT EXISTS athena_auth_verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS athena_auth_organization (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    logo TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_by_user_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS athena_auth_member (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (organization_id) REFERENCES athena_auth_organization(id),
    FOREIGN KEY (user_id) REFERENCES athena_auth_user(id)
  )`,
  `CREATE TABLE IF NOT EXISTS athena_auth_user_role (
    user_id TEXT NOT NULL,
    role_key TEXT NOT NULL,
    PRIMARY KEY (user_id, role_key),
    FOREIGN KEY (user_id) REFERENCES athena_auth_user(id)
  )`,
  `CREATE TABLE IF NOT EXISTS athena_auth_member_role (
    member_id TEXT NOT NULL,
    role_key TEXT NOT NULL,
    PRIMARY KEY (member_id, role_key),
    FOREIGN KEY (member_id) REFERENCES athena_auth_member(id)
  )`,
] as const);
