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

export interface SchemaExpectation {
  kind: SchemaExpectationKind;
  /** Fully-qualified display name, e.g. athena.users or athena.idx_users_email */
  object: string;
  schema?: string;
  table?: string;
  name?: string;
  column?: string;
}

export interface AthenaAuthMigrationDefinition {
  version: number;
  name: string;
  sql: string;
  expectations?: readonly SchemaExpectation[];
  repairability?: MigrationRepairability;
}

export function schema(name: string): SchemaExpectation {
  return { kind: "schema", name, object: name, schema: name };
}

export function table(schemaName: string, tableName: string): SchemaExpectation {
  return {
    kind: "table",
    schema: schemaName,
    table: tableName,
    name: tableName,
    object: `${schemaName}.${tableName}`,
  };
}

export function column(
  schemaName: string,
  tableName: string,
  columnName: string
): SchemaExpectation {
  return {
    kind: "column",
    schema: schemaName,
    table: tableName,
    column: columnName,
    name: columnName,
    object: `${schemaName}.${tableName}.${columnName}`,
  };
}

export function index(schemaName: string, indexName: string): SchemaExpectation {
  return {
    kind: "index",
    schema: schemaName,
    name: indexName,
    object: `${schemaName}.${indexName}`,
  };
}

export function constraint(
  schemaName: string,
  tableName: string,
  constraintName: string
): SchemaExpectation {
  return {
    kind: "constraint",
    schema: schemaName,
    table: tableName,
    name: constraintName,
    object: `${schemaName}.${tableName}.${constraintName}`,
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
};

/**
 * Auth migrations use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS and are
 * generally safe to re-apply for structural repair.
 */
export function repairabilityForAuthMigration(
  _version: number
): MigrationRepairability {
  return "idempotent";
}
