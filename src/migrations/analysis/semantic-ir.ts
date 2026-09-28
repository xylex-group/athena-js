import type { SchemaObjectRef, SqlSourceLocation } from "./ast.ts";

export type DependencyConfidence =
  | "certain"
  | "probable"
  | "dynamic"
  | "unknown";

export type DependencyCategory =
  | "CREATES"
  | "ALTERS"
  | "DROPS"
  | "READS"
  | "WRITES"
  | "REFERENCES"
  | "INVOKES"
  | "RETURNS"
  | "CASTS_TO"
  | "REQUIRES_SCHEMA"
  | "REQUIRES_TABLE"
  | "REQUIRES_COLUMN"
  | "REQUIRES_TYPE"
  | "REQUIRES_FUNCTION"
  | "REQUIRES_EXTENSION"
  | "REQUIRES_SEQUENCE";

export type NameResolution =
  | "exact"
  | "search_path"
  | "cte"
  | "alias"
  | "temporary"
  | "catalog_builtin"
  | "unverified";

export type ExpectedDependencySource =
  | "baseline"
  | "migration"
  | "embedded"
  | "unknown";

export interface SemanticDependency {
  category: DependencyCategory;
  confidence: DependencyConfidence;
  expectedSource?: ExpectedDependencySource;
  explicitlyQualified?: boolean;
  location?: SqlSourceLocation;
  object: SchemaObjectRef;
  owner?: SchemaObjectRef;
  resolution?: NameResolution;
  snippet?: string;
  statementIndex?: number;
}

export interface SchemaMutation {
  after?: SchemaObjectRef;
  before?: SchemaObjectRef;
  kind: string;
  object: SchemaObjectRef;
}

export interface MigrationEffects {
  creates: SchemaObjectRef[];
  drops: SchemaObjectRef[];
  modifies: SchemaMutation[];
}

export type StatementKind =
  | "create_schema"
  | "create_table"
  | "create_table_as"
  | "alter_table"
  | "drop_table"
  | "create_index"
  | "drop_index"
  | "create_type"
  | "alter_type"
  | "drop_type"
  | "create_view"
  | "create_materialized_view"
  | "create_function"
  | "alter_function"
  | "drop_function"
  | "create_procedure"
  | "create_trigger"
  | "create_policy"
  | "alter_policy"
  | "drop_policy"
  | "grant"
  | "revoke"
  | "comment"
  | "create_extension"
  | "create_sequence"
  | "other";

export interface SemanticStatement {
  dependencies: SemanticDependency[];
  effects: MigrationEffects;
  kind: StatementKind;
  location: SqlSourceLocation;
  object?: SchemaObjectRef;
}

export interface MigrationAnalysis {
  checksum: string;
  declaredRequires?: SchemaObjectRef[];
  dependencies: SemanticDependency[];
  effects: MigrationEffects;
  filename: string;
  name: string;
  parserId: string;
  statements: SemanticStatement[];
  version: number;
  warnings: string[];
}
