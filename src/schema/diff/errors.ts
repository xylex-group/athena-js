/**
 * Typed errors for invalid schema snapshots and diff inputs.
 */

export type SchemaDiffErrorCode =
  | "duplicate_schema"
  | "duplicate_table"
  | "duplicate_column"
  | "duplicate_unique"
  | "duplicate_foreign_key"
  | "duplicate_index"
  | "missing_pk_column"
  | "missing_unique_column"
  | "missing_fk_column"
  | "missing_index_column"
  | "fk_arity_mismatch"
  | "invalid_snapshot"
  | "unsupported_snapshot_version";

export class SchemaDiffError extends Error {
  readonly code: SchemaDiffErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: SchemaDiffErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>
  ) {
    super(message);
    this.name = "SchemaDiffError";
    this.code = code;
    this.details = details;
  }
}
