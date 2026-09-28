/**
 * Structural expectations for embedded Athena Auth migrations.
 * Used for ledger/schema drift detection — not full DDL equivalence.
 */

export type MigrationRepairability = "idempotent" | "inspect-only" | "manual";

export type SchemaExpectationKind =
  | "schema"
  | "table"
  | "column"
  | "index"
  | "constraint";

export type SchemaForeignKeyAction =
  | "cascade"
  | "no-action"
  | "restrict"
  | "set-default"
  | "set-null";

export interface SchemaForeignKeyExpectation {
  columns: readonly string[];
  kind: "foreign-key";
  onDelete?: SchemaForeignKeyAction;
  onUpdate?: SchemaForeignKeyAction;
  references: {
    columns: readonly string[];
    schema: string;
    table: string;
  };
}

export interface SchemaExpectation {
  column?: string;
  definition?: string;
  foreignKey?: SchemaForeignKeyExpectation;
  kind: SchemaExpectationKind;
  name?: string;
  /** Fully-qualified display name, e.g. athena.users or athena.idx_users_email */
  object: string;
  schema?: string;
  table?: string;
}

export interface AthenaAuthMigrationDefinition {
  expectations?: readonly SchemaExpectation[];
  name: string;
  repairability?: MigrationRepairability;
  sql: string;
  version: number;
}

export function schema(name: string): SchemaExpectation {
  return { kind: "schema", name, object: name, schema: name };
}

export function table(
  schemaName: string,
  tableName: string
): SchemaExpectation {
  return {
    kind: "table",
    name: tableName,
    object: `${schemaName}.${tableName}`,
    schema: schemaName,
    table: tableName,
  };
}

export function column(
  schemaName: string,
  tableName: string,
  columnName: string
): SchemaExpectation {
  return {
    column: columnName,
    kind: "column",
    name: columnName,
    object: `${schemaName}.${tableName}.${columnName}`,
    schema: schemaName,
    table: tableName,
  };
}

export function index(
  schemaName: string,
  indexName: string
): SchemaExpectation {
  return {
    kind: "index",
    name: indexName,
    object: `${schemaName}.${indexName}`,
    schema: schemaName,
  };
}

export function constraint(
  schemaName: string,
  tableName: string,
  constraintName: string,
  definitionOrForeignKey?: string | SchemaForeignKeyExpectation
): SchemaExpectation {
  return {
    kind: "constraint",
    name: constraintName,
    object: `${schemaName}.${tableName}.${constraintName}`,
    schema: schemaName,
    table: tableName,
    ...(typeof definitionOrForeignKey === "string"
      ? { definition: definitionOrForeignKey }
      : definitionOrForeignKey
        ? { foreignKey: definitionOrForeignKey }
        : {}),
  };
}

/** Core structural invariants keyed by migration version. */
export const ATHENA_AUTH_MIGRATION_EXPECTATIONS: Readonly<
  Record<number, readonly SchemaExpectation[]>
> = {
  1: [
    table("athena", "users"),
    table("athena", "sessions"),
    table("athena", "accounts"),
    table("athena", "verifications"),
    index("athena", "idx_users_email"),
    index("athena", "idx_sessions_token"),
  ],
  2: [
    table("athena", "organization"),
    table("athena", "member"),
    table("athena", "invitation"),
    index("athena", "idx_organization_slug"),
  ],
  3: [table("athena", "two_factor"), index("athena", "idx_two_factor_user_id")],
  4: [table("athena", "api_keys"), index("athena", "idx_api_keys_user_id")],
  5: [table("athena", "passkeys"), index("athena", "idx_passkeys_user_id")],
  6: [table("athena", "email_send_failures")],
  7: [table("athena", "emails")],
  9: [column("athena", "users", "last_sign_in_at")],
  11: [table("athena", "email_templates")],
  12: [
    column("athena", "email_send_failures", "resolved"),
    column("athena", "emails", "flow"),
  ],
  14: [table("athena", "email_event_types")],
  15: [column("athena", "email_templates", "attachments")],
  21: [
    table("athena", "auth_schema_migrations"),
    table("athena", "runtime_key"),
  ],
  22: [
    column("athena", "passkeys", "updated_at"),
    index("athena", "idx_passkeys_user_id"),
    index("athena", "idx_passkeys_credential_id"),
  ],
  23: [
    table("athena", "audit_log_auth"),
    table("athena", "traces_auth"),
    index("athena", "audit_log_auth_event_id_idx"),
    index("athena", "traces_auth_trace_id_idx"),
    index("athena", "traces_auth_event_id_idx"),
  ],
  24: [table("athena", "email_event_types")],
  25: [column("athena", "passkeys", "aaguid")],
  26: [
    column("athena", "passkeys", "resident_key"),
    table("athena", "passkey_registration_transactions"),
    index("athena", "idx_passkey_reg_tx_challenge_hash"),
  ],
  27: [
    table("athena", "auth_bridge_codes"),
    index("athena", "idx_auth_bridge_codes_expires_at"),
    index("athena", "idx_auth_bridge_codes_session_id"),
    index("athena", "idx_auth_bridge_codes_user_id"),
    index("athena", "idx_auth_bridge_codes_outstanding_session"),
  ],
  28: [
    table("athena", "oauth_transactions"),
    index("athena", "idx_oauth_transactions_expires_at"),
  ],
  29: [
    table("athena", "notification_preferences"),
    index("athena", "uq_notification_preferences_user_channel_topic"),
    index("athena", "uq_notification_preferences_user_org_channel_topic"),
  ],
  30: [
    column("athena", "organization", "created_by_user_id"),
    index("athena", "idx_organization_created_by_user_id"),
  ],
  31: [
    table("athena", "authorization_rights"),
    table("athena", "authorization_roles"),
    table("athena", "authorization_role_rights"),
    table("athena", "authorization_user_roles"),
    table("athena", "authorization_member_roles"),
    table("athena", "authorization_revisions"),
    table("athena", "authorization_audit_log"),
  ],
  32: [
    constraint(
      "athena",
      "authorization_roles",
      "authorization_roles_scope_organization_id"
    ),
    constraint(
      "athena",
      "authorization_revisions",
      "authorization_revisions_scope_nullability"
    ),
  ],
  33: [table("athena", "auth_signing_keys")],
  34: [
    column("athena", "email_send_failures", "error_code"),
    column("athena", "email_send_failures", "template_id"),
    column("athena", "email_send_failures", "template_key"),
  ],
  35: [
    constraint(
      "athena",
      "authorization_user_roles",
      "authorization_user_roles_pkey",
      "PRIMARY KEY (user_id, role_id)"
    ),
    constraint(
      "athena",
      "authorization_member_roles",
      "authorization_member_roles_pkey",
      "PRIMARY KEY (member_id, role_id)"
    ),
    index("athena", "idx_authorization_user_roles_user"),
    index("athena", "idx_authorization_member_roles_member"),
  ],
  36: [
    column("athena", "api_keys", "organization_id"),
    index("athena", "idx_api_keys_organization_id"),
  ],
  37: [
    column("athena", "api_keys", "scope_kind"),
    constraint("athena", "api_keys", "api_keys_organization_id_fkey", {
      columns: ["organization_id"],
      kind: "foreign-key",
      onDelete: "cascade",
      onUpdate: "no-action",
      references: {
        columns: ["id"],
        schema: "athena",
        table: "organization",
      },
    }),
    constraint(
      "athena",
      "api_keys",
      "api_keys_scope_kind_check",
      "CHECK (((scope_kind = 'organization'::text) AND (organization_id IS NOT NULL)) OR ((scope_kind = ANY (ARRAY['legacy'::text, 'platform'::text])) AND (organization_id IS NULL)))"
    ),
  ],
  38: [
    table("athena", "auth_rate_limits"),
    index("athena", "idx_auth_rate_limits_reset_at"),
  ],
  39: [
    table("athena", "oauth_clients"),
    column("athena", "oauth_clients", "resource_uris"),
    index("athena", "idx_oauth_clients_active"),
  ],
  40: [
    table("athena", "oauth_authorization_grants"),
    index("athena", "idx_oauth_grants_user_id"),
    index("athena", "idx_oauth_grants_client_id"),
    index("athena", "uq_oauth_grants_client_user_resource_org"),
    index("athena", "uq_oauth_grants_client_user_resource_platform"),
  ],
  41: [
    table("athena", "oauth_authorization_requests"),
    column("athena", "oauth_authorization_requests", "code_challenge"),
    index("athena", "idx_oauth_requests_expires_at"),
  ],
  42: [
    table("athena", "oauth_authorization_codes"),
    column("athena", "oauth_authorization_codes", "code_hash"),
    index("athena", "idx_oauth_codes_expires_at"),
  ],
  43: [
    table("athena", "oauth_refresh_tokens"),
    column("athena", "oauth_refresh_tokens", "family_id"),
    index("athena", "idx_oauth_refresh_family_id"),
  ],
  44: [
    table("athena", "oauth_revoked_access_tokens"),
    column("athena", "oauth_revoked_access_tokens", "jti"),
    index("athena", "idx_oauth_revoked_access_tokens_expires_at"),
  ],
  45: [
    column("athena", "sessions", "authenticated_at"),
    column("athena", "sessions", "authentication_methods"),
  ],
};

/**
 * Auth migrations use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS and are
 * generally safe to re-apply for structural repair.
 */
export function repairabilityForAuthMigration(): MigrationRepairability {
  return "idempotent";
}
