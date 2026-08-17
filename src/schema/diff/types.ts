/**
 * Canonical Athena-managed schema IR and structured schema-diff results.
 *
 * Diff compares normalized snapshots only — never SQL strings or live DB handles.
 * Versioned for future N/N-1 snapshot compatibility.
 */

/** Snapshot IR version. Bump only on breaking shape changes. */
export const ATHENA_SCHEMA_SNAPSHOT_VERSION = 1 as const;

/** Schema-qualified table identity (never table-name alone). */
export interface SchemaTableIdentity {
  readonly schema: string;
  readonly name: string;
}

/** Canonical column type after normalization. */
export interface SchemaColumnType {
  /**
   * Normalized base type name (e.g. `integer`, `bigint`, `text`, `varchar`).
   * Postgres aliases are folded in {@link normalizeSchemaSnapshot}.
   */
  readonly name: string;
  /** Character length for `varchar`/`char` when known. */
  readonly length?: number | null;
  /** Numeric precision when known. */
  readonly precision?: number | null;
  /** Numeric scale when known. */
  readonly scale?: number | null;
  /** Array dimensions (`0` = scalar). */
  readonly arrayDimensions: number;
  /** Enum labels when type is a managed enum. */
  readonly enumValues?: readonly string[] | null;
}

/** Canonical column definition. */
export interface SchemaColumn {
  readonly name: string;
  readonly type: SchemaColumnType;
  readonly nullable: boolean;
  /**
   * Normalized default expression, or `null` when absent.
   * Prefer `null` over `undefined` for stable serialization.
   */
  readonly default: string | null;
  readonly isGenerated: boolean;
}

export interface SchemaPrimaryKey {
  /** Physical name when known; structural identity is `columns` order. */
  readonly name?: string | null;
  readonly columns: readonly string[];
}

export interface SchemaUniqueConstraint {
  readonly name?: string | null;
  readonly columns: readonly string[];
}

export type SchemaReferentialAction =
  | "no_action"
  | "restrict"
  | "cascade"
  | "set_null"
  | "set_default";

export interface SchemaForeignKey {
  readonly name?: string | null;
  readonly columns: readonly string[];
  readonly target: SchemaTableIdentity;
  readonly targetColumns: readonly string[];
  readonly onDelete: SchemaReferentialAction;
  readonly onUpdate: SchemaReferentialAction;
}

export interface SchemaIndexColumn {
  readonly name: string;
  /** `asc` | `desc`; default treated as `asc` after normalize. */
  readonly direction?: "asc" | "desc" | null;
}

export interface SchemaIndex {
  readonly name?: string | null;
  readonly columns: readonly SchemaIndexColumn[];
  readonly unique: boolean;
  /** Partial index predicate when modeled; otherwise null. */
  readonly predicate?: string | null;
  /** Index method (`btree`, …) when known. */
  readonly method?: string | null;
}

export interface SchemaTable {
  readonly schema: string;
  readonly name: string;
  readonly columns: readonly SchemaColumn[];
  readonly primaryKey: SchemaPrimaryKey | null;
  readonly uniqueConstraints: readonly SchemaUniqueConstraint[];
  readonly foreignKeys: readonly SchemaForeignKey[];
  readonly indexes: readonly SchemaIndex[];
}

export interface SchemaNamespace {
  readonly name: string;
  readonly tables: readonly SchemaTable[];
}

/**
 * Canonical schema snapshot for Athena-managed surfaces.
 * Unmodeled DB objects (views, functions, triggers, extensions, RLS) are out of scope.
 */
export interface AthenaSchemaSnapshot {
  readonly version: typeof ATHENA_SCHEMA_SNAPSHOT_VERSION;
  /** Optional backend hint (`postgresql`, `d1`, …). */
  readonly backend?: string | null;
  readonly schemas: readonly SchemaNamespace[];
}

export type SchemaDiffOperationKind =
  | "create_schema"
  | "drop_schema"
  | "create_table"
  | "drop_table"
  | "rename_table"
  | "add_column"
  | "drop_column"
  | "rename_column"
  | "alter_column"
  | "add_primary_key"
  | "drop_primary_key"
  | "add_unique_constraint"
  | "drop_unique_constraint"
  | "add_foreign_key"
  | "drop_foreign_key"
  | "alter_foreign_key"
  | "add_index"
  | "drop_index";

export interface SchemaDiffBase {
  readonly kind: SchemaDiffOperationKind;
}

export interface CreateSchemaOperation extends SchemaDiffBase {
  readonly kind: "create_schema";
  readonly schema: string;
}

export interface DropSchemaOperation extends SchemaDiffBase {
  readonly kind: "drop_schema";
  readonly schema: string;
}

export interface CreateTableOperation extends SchemaDiffBase {
  readonly kind: "create_table";
  readonly table: SchemaTable;
}

export interface DropTableOperation extends SchemaDiffBase {
  readonly kind: "drop_table";
  readonly table: SchemaTableIdentity;
  /** Full prior definition when known (for later analysis). */
  readonly previous?: SchemaTable | null;
}

export interface RenameTableOperation extends SchemaDiffBase {
  readonly kind: "rename_table";
  readonly from: SchemaTableIdentity;
  readonly to: SchemaTableIdentity;
}

export interface AddColumnOperation extends SchemaDiffBase {
  readonly kind: "add_column";
  readonly table: SchemaTableIdentity;
  readonly column: SchemaColumn;
}

export interface DropColumnOperation extends SchemaDiffBase {
  readonly kind: "drop_column";
  readonly table: SchemaTableIdentity;
  readonly column: SchemaColumn;
}

export interface RenameColumnOperation extends SchemaDiffBase {
  readonly kind: "rename_column";
  readonly table: SchemaTableIdentity;
  readonly from: string;
  readonly to: string;
}

export interface SchemaColumnChange<T> {
  readonly from: T;
  readonly to: T;
}

export interface SchemaColumnChanges {
  readonly type?: SchemaColumnChange<SchemaColumnType>;
  readonly nullable?: SchemaColumnChange<boolean>;
  readonly default?: SchemaColumnChange<string | null>;
  readonly isGenerated?: SchemaColumnChange<boolean>;
}

/**
 * Consolidated column alter: one operation per column with explicit before/after deltas.
 * Multiple property changes on the same column stay a single operation (planning-safe).
 */
export interface AlterColumnOperation extends SchemaDiffBase {
  readonly kind: "alter_column";
  readonly table: SchemaTableIdentity;
  readonly column: string;
  readonly before: SchemaColumn;
  readonly after: SchemaColumn;
  readonly changes: SchemaColumnChanges;
}

export interface AddPrimaryKeyOperation extends SchemaDiffBase {
  readonly kind: "add_primary_key";
  readonly table: SchemaTableIdentity;
  readonly primaryKey: SchemaPrimaryKey;
}

export interface DropPrimaryKeyOperation extends SchemaDiffBase {
  readonly kind: "drop_primary_key";
  readonly table: SchemaTableIdentity;
  readonly primaryKey: SchemaPrimaryKey;
}

export interface AddUniqueConstraintOperation extends SchemaDiffBase {
  readonly kind: "add_unique_constraint";
  readonly table: SchemaTableIdentity;
  readonly unique: SchemaUniqueConstraint;
}

export interface DropUniqueConstraintOperation extends SchemaDiffBase {
  readonly kind: "drop_unique_constraint";
  readonly table: SchemaTableIdentity;
  readonly unique: SchemaUniqueConstraint;
}

export interface AddForeignKeyOperation extends SchemaDiffBase {
  readonly kind: "add_foreign_key";
  readonly table: SchemaTableIdentity;
  readonly foreignKey: SchemaForeignKey;
}

export interface DropForeignKeyOperation extends SchemaDiffBase {
  readonly kind: "drop_foreign_key";
  readonly table: SchemaTableIdentity;
  readonly foreignKey: SchemaForeignKey;
}

export interface AlterForeignKeyOperation extends SchemaDiffBase {
  readonly kind: "alter_foreign_key";
  readonly table: SchemaTableIdentity;
  readonly before: SchemaForeignKey;
  readonly after: SchemaForeignKey;
}

export interface AddIndexOperation extends SchemaDiffBase {
  readonly kind: "add_index";
  readonly table: SchemaTableIdentity;
  readonly index: SchemaIndex;
}

export interface DropIndexOperation extends SchemaDiffBase {
  readonly kind: "drop_index";
  readonly table: SchemaTableIdentity;
  readonly index: SchemaIndex;
}

export type SchemaDiffOperation =
  | CreateSchemaOperation
  | DropSchemaOperation
  | CreateTableOperation
  | DropTableOperation
  | RenameTableOperation
  | AddColumnOperation
  | DropColumnOperation
  | RenameColumnOperation
  | AlterColumnOperation
  | AddPrimaryKeyOperation
  | DropPrimaryKeyOperation
  | AddUniqueConstraintOperation
  | DropUniqueConstraintOperation
  | AddForeignKeyOperation
  | DropForeignKeyOperation
  | AlterForeignKeyOperation
  | AddIndexOperation
  | DropIndexOperation;

export interface SchemaDiffSummary {
  readonly schemasAdded: number;
  readonly schemasRemoved: number;
  readonly tablesAdded: number;
  readonly tablesRemoved: number;
  readonly tablesRenamed: number;
  readonly columnsAdded: number;
  readonly columnsRemoved: number;
  readonly columnsRenamed: number;
  readonly columnsChanged: number;
  readonly primaryKeysAdded: number;
  readonly primaryKeysRemoved: number;
  readonly uniquesAdded: number;
  readonly uniquesRemoved: number;
  readonly foreignKeysAdded: number;
  readonly foreignKeysRemoved: number;
  readonly foreignKeysChanged: number;
  readonly indexesAdded: number;
  readonly indexesRemoved: number;
  readonly totalOperations: number;
}

export interface SchemaDiff {
  readonly operations: readonly SchemaDiffOperation[];
  readonly summary: SchemaDiffSummary;
  readonly isEmpty: boolean;
}

/**
 * Diff direction: operations transform `from` (actual) into `to` (desired).
 * `add_column` means the column exists in `to` but not in `from`.
 */
export interface DiffSchemasInput {
  readonly from: AthenaSchemaSnapshot;
  readonly to: AthenaSchemaSnapshot;
}

export interface DiffSchemasOptions {
  /**
   * When true (default), validate both snapshots before comparing.
   */
  readonly validate?: boolean;
}
