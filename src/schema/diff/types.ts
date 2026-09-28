/**
 * v1 schema snapshot DTO and structured schema-diff results.
 *
 * Canonical structure is AthenaSchemaIr (`src/schema/ir/`). These types remain
 * as a compatibility projection (`ATHENA_SCHEMA_SNAPSHOT_VERSION = 1`).
 * Diff compares IR (v1 snapshots are lifted at the boundary).
 */

import type { SchemaColumnGenerationStrategy } from "../ir/column.ts";
import type { AthenaSchemaIr } from "../ir/document.ts";
import type { PostgresIntervalQualifier } from "../ir/type.ts";

export type { SchemaColumnGenerationStrategy } from "../ir/column.ts";

/** Snapshot IR version. Bump only on breaking shape changes. */
export const ATHENA_SCHEMA_SNAPSHOT_VERSION = 1 as const;

/** Schema-qualified table identity (never table-name alone). */
export interface SchemaTableIdentity {
  /** Database axis when the IR is multi-database. */
  readonly database?: string;
  readonly name: string;
  readonly schema: string;
}

/** Canonical column type after normalization. */
export interface SchemaColumnType {
  /** Array dimensions (`0` = scalar). */
  readonly arrayDimensions: number;
  /** Enum labels when type is a managed enum. */
  readonly enumValues?: readonly string[] | null;
  /** PostgreSQL interval field qualifier when the native type is qualified. */
  readonly intervalQualifier?: PostgresIntervalQualifier;
  /** Character length for `varchar`/`char` when known. */
  readonly length?: number | null;
  /**
   * Normalized base type name (e.g. `integer`, `bigint`, `text`, `varchar`).
   * Postgres aliases are folded in {@link normalizeSchemaSnapshot}.
   */
  readonly name: string;
  /** Numeric precision when known. */
  readonly precision?: number | null;
  /** Numeric scale when known. */
  readonly scale?: number | null;
}

/** Canonical column definition. */
export interface SchemaColumn {
  /**
   * Normalized default expression, or `null` when absent.
   * Prefer `null` over `undefined` for stable serialization.
   */
  readonly default: string | null;
  readonly isGenerated: boolean;
  readonly name: string;
  readonly nullable: boolean;
  readonly type: SchemaColumnType;
}

export interface SchemaPrimaryKey {
  readonly columns: readonly string[];
  /** Physical name when known; structural identity is `columns` order. */
  readonly name?: string | null;
}

export interface SchemaUniqueConstraint {
  readonly columns: readonly string[];
  readonly name?: string | null;
}

export type SchemaReferentialAction =
  | "no_action"
  | "restrict"
  | "cascade"
  | "set_null"
  | "set_default";

export interface SchemaForeignKey {
  readonly columns: readonly string[];
  readonly name?: string | null;
  readonly onDelete: SchemaReferentialAction;
  readonly onUpdate: SchemaReferentialAction;
  readonly target: SchemaTableIdentity;
  readonly targetColumns: readonly string[];
}

export interface SchemaIndexColumn {
  /** `asc` | `desc`; default treated as `asc` after normalize. */
  readonly direction?: "asc" | "desc" | null;
  readonly name: string;
}

export interface SchemaIndex {
  readonly columns: readonly SchemaIndexColumn[];
  /** Index method (`btree`, …) when known. */
  readonly method?: string | null;
  readonly name?: string | null;
  /** Partial index predicate when modeled; otherwise null. */
  readonly predicate?: string | null;
  readonly unique: boolean;
}

export interface SchemaTable {
  readonly columns: readonly SchemaColumn[];
  readonly database?: string;
  readonly foreignKeys: readonly SchemaForeignKey[];
  readonly indexes: readonly SchemaIndex[];
  readonly name: string;
  readonly primaryKey: SchemaPrimaryKey | null;
  readonly schema: string;
  readonly uniqueConstraints: readonly SchemaUniqueConstraint[];
}

export interface SchemaNamespace {
  /** Database axis when the IR is multi-database; omitted for single-db v1. */
  readonly database?: string;
  readonly name: string;
  readonly tables: readonly SchemaTable[];
}

/**
 * Canonical schema snapshot for Athena-managed surfaces.
 * Unmodeled DB objects (views, functions, triggers, extensions, RLS) are out of scope.
 */
export interface AthenaSchemaSnapshot {
  /** Optional backend hint (`postgresql`, `d1`, …). */
  readonly backend?: string | null;
  readonly schemas: readonly SchemaNamespace[];
  readonly version: typeof ATHENA_SCHEMA_SNAPSHOT_VERSION;
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
  /** Database axis when the IR is multi-database. */
  readonly database?: string;
  readonly kind: "create_schema";
  readonly schema: string;
}

export interface DropSchemaOperation extends SchemaDiffBase {
  /** Database axis when the IR is multi-database. */
  readonly database?: string;
  readonly kind: "drop_schema";
  readonly schema: string;
}

export interface CreateTableOperation extends SchemaDiffBase {
  readonly kind: "create_table";
  readonly table: SchemaTable;
}

export interface DropTableOperation extends SchemaDiffBase {
  readonly kind: "drop_table";
  /** Full prior definition when known (for later analysis). */
  readonly previous?: SchemaTable | null;
  readonly table: SchemaTableIdentity;
}

export interface RenameTableOperation extends SchemaDiffBase {
  readonly from: SchemaTableIdentity;
  readonly kind: "rename_table";
  readonly to: SchemaTableIdentity;
}

export interface AddColumnOperation extends SchemaDiffBase {
  readonly column: SchemaColumn;
  readonly kind: "add_column";
  readonly table: SchemaTableIdentity;
}

export interface DropColumnOperation extends SchemaDiffBase {
  readonly column: SchemaColumn;
  readonly kind: "drop_column";
  readonly table: SchemaTableIdentity;
}

export interface RenameColumnOperation extends SchemaDiffBase {
  readonly from: string;
  readonly kind: "rename_column";
  readonly table: SchemaTableIdentity;
  readonly to: string;
}

export interface SchemaColumnChange<T> {
  readonly from: T;
  readonly to: T;
}

export interface SchemaColumnChanges {
  readonly default?: SchemaColumnChange<string | null>;
  readonly generationStrategy?: SchemaColumnChange<SchemaColumnGenerationStrategy>;
  readonly isGenerated?: SchemaColumnChange<boolean>;
  readonly nullable?: SchemaColumnChange<boolean>;
  readonly type?: SchemaColumnChange<SchemaColumnType>;
}

/**
 * Consolidated column alter: one operation per column with explicit before/after deltas.
 * Multiple property changes on the same column stay a single operation (planning-safe).
 */
export interface AlterColumnOperation extends SchemaDiffBase {
  readonly after: SchemaColumn;
  readonly before: SchemaColumn;
  readonly changes: SchemaColumnChanges;
  readonly column: string;
  readonly kind: "alter_column";
  readonly table: SchemaTableIdentity;
}

export interface AddPrimaryKeyOperation extends SchemaDiffBase {
  readonly kind: "add_primary_key";
  readonly primaryKey: SchemaPrimaryKey;
  readonly table: SchemaTableIdentity;
}

export interface DropPrimaryKeyOperation extends SchemaDiffBase {
  readonly kind: "drop_primary_key";
  readonly primaryKey: SchemaPrimaryKey;
  readonly table: SchemaTableIdentity;
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
  readonly foreignKey: SchemaForeignKey;
  readonly kind: "add_foreign_key";
  readonly table: SchemaTableIdentity;
}

export interface DropForeignKeyOperation extends SchemaDiffBase {
  readonly foreignKey: SchemaForeignKey;
  readonly kind: "drop_foreign_key";
  readonly table: SchemaTableIdentity;
}

export interface AlterForeignKeyOperation extends SchemaDiffBase {
  readonly after: SchemaForeignKey;
  readonly before: SchemaForeignKey;
  readonly kind: "alter_foreign_key";
  readonly table: SchemaTableIdentity;
}

export interface AddIndexOperation extends SchemaDiffBase {
  readonly index: SchemaIndex;
  readonly kind: "add_index";
  readonly table: SchemaTableIdentity;
}

export interface DropIndexOperation extends SchemaDiffBase {
  readonly index: SchemaIndex;
  readonly kind: "drop_index";
  readonly table: SchemaTableIdentity;
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
  readonly columnsAdded: number;
  readonly columnsChanged: number;
  readonly columnsRemoved: number;
  readonly columnsRenamed: number;
  readonly foreignKeysAdded: number;
  readonly foreignKeysChanged: number;
  readonly foreignKeysRemoved: number;
  readonly indexesAdded: number;
  readonly indexesRemoved: number;
  readonly primaryKeysAdded: number;
  readonly primaryKeysRemoved: number;
  readonly schemasAdded: number;
  readonly schemasRemoved: number;
  readonly tablesAdded: number;
  readonly tablesRemoved: number;
  readonly tablesRenamed: number;
  readonly totalOperations: number;
  readonly uniquesAdded: number;
  readonly uniquesRemoved: number;
}

export interface SchemaDiff {
  readonly isEmpty: boolean;
  readonly operations: readonly SchemaDiffOperation[];
  readonly summary: SchemaDiffSummary;
}

/**
 * Diff direction: operations transform `from` (actual) into `to` (desired).
 * `add_column` means the column exists in `to` but not in `from`.
 */
export interface DiffSchemasInput {
  readonly from: AthenaSchemaSnapshot | AthenaSchemaIr;
  readonly to: AthenaSchemaSnapshot | AthenaSchemaIr;
}

export interface DiffSchemasOptions {
  /**
   * When true (default), validate both snapshots before comparing.
   */
  readonly validate?: boolean;
}
