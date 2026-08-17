import type { BackendType } from "../gateway/types.ts";

type ModelKey = string;
type ColumnKey = string;

/**
 * Supported column helper families for table-builder definitions.
 */
export type ModelColumnKind =
  | "boolean"
  | "number"
  | "string"
  | "json"
  | "enumeration";

/**
 * Optional per-column metadata carried by model contracts.
 */
export interface ModelColumnMetadata {
  columnName?: string;
  enumValues?: readonly string[];
  hasDefault?: boolean;
  isGenerated?: boolean;
  kind: ModelColumnKind;
  nullable?: boolean;
}

/**
 * Runtime values that can safely be serialized into tenant-scoped headers.
 */
export type TenantContextValue = string | number | boolean | null | undefined;

/**
 * Compile-time map of tenant context keys to outbound header names.
 */
export type TenantKeyMap = Record<string, string>;

/**
 * Partial tenant context keyed by `TenantKeyMap`.
 */
export type TenantContext<TMap extends TenantKeyMap> = Partial<
  Record<keyof TMap, TenantContextValue>
>;

/**
 * Supported relationship cardinalities for model metadata and introspection snapshots.
 */
export type ModelRelationKind =
  | "one-to-one"
  | "one-to-many"
  | "many-to-one"
  | "many-to-many";

/**
 * Base metadata shape shared by typed model definitions and introspection snapshots.
 * This type is intentionally row-agnostic so it can be used for generic registries.
 */
export interface ModelMetadataBase {
  columns?: Partial<Record<string, ModelColumnMetadata>>;
  database?: string;
  model?: string;
  nullable?: Partial<Record<string, boolean>>;
  primaryKey: string[];
  relations?: Record<string, ModelRelationMetadata>;
  schema?: string;
  tableName?: string;
}

/**
 * Strongly-typed model metadata linked to a row shape.
 */
export type ModelMetadata<Row> = Omit<
  ModelMetadataBase,
  "primaryKey" | "nullable"
> & {
  primaryKey: Extract<keyof Row, string>[];
  nullable?: Partial<Record<Extract<keyof Row, string>, boolean>>;
  columns?: Partial<Record<Extract<keyof Row, string>, ModelColumnMetadata>>;
};

/**
 * Relation metadata for model contracts and introspection snapshots.
 */
export interface ModelRelationMetadata {
  kind: ModelRelationKind;
  sourceColumns: ColumnKey[];
  targetColumns: ColumnKey[];
  targetDatabase?: string;
  targetModel: ModelKey;
  targetSchema: string;
  through?: {
    schema: string;
    model: string;
    sourceColumns: ColumnKey[];
    targetColumns: ColumnKey[];
  };
}

/**
 * Core model definition contract used by typed registries.
 */
export interface ModelDef<
  Row,
  Insert = Partial<Row>,
  Update = Partial<Insert>,
  Meta extends ModelMetadataBase = ModelMetadata<Row>,
> {
  readonly __types?: {
    row: Row;
    insert: Insert;
    update: Update;
  };
  readonly meta: Meta;
}

/**
 * Row-agnostic model definition used as a generic constraint.
 */
export type AnyModelDef = ModelDef<
  unknown,
  unknown,
  unknown,
  ModelMetadataBase
>;

/**
 * Public model/table value that carries Athena target metadata plus row/write typings.
 * This can be passed directly to `client.from(...)` for opt-in target inference.
 */
export type AthenaModelTarget<
  Row = unknown,
  Insert = unknown,
  Update = unknown,
> = ModelDef<Row, Insert, Update, ModelMetadataBase>;

type StripSchemaPrefix<TValue extends string> =
  TValue extends `${string}.${infer TTable}` ? TTable : TValue;
type MetaString<TModel, TKey extends keyof ModelMetadataBase> = Extract<
  TModel extends { meta: infer TMeta }
    ? TMeta extends Record<string, unknown>
      ? TMeta[TKey]
      : never
    : never,
  string
>;
type QualifiedNameFromMeta<TModel> =
  MetaString<TModel, "tableName"> extends infer TTableName extends string
    ? TTableName extends `${string}.${string}`
      ? TTableName
      : MetaString<TModel, "schema"> extends infer TSchema extends string
        ? `${TSchema}.${TTableName}`
        : TTableName
    : MetaString<TModel, "schema"> extends infer TSchema extends string
      ? MetaString<TModel, "model"> extends infer TModelName extends string
        ? `${TSchema}.${TModelName}`
        : never
      : MetaString<TModel, "model">;
type BareNameFromMeta<TModel> =
  MetaString<TModel, "tableName"> extends infer TTableName extends string
    ? StripSchemaPrefix<TTableName>
    : MetaString<TModel, "model">;

export type AthenaClientModelMap = Record<string, AnyModelDef>;
export type AthenaClientSchemaModels = SchemaDef<AthenaClientModelMap>;
export type AthenaClientDatabaseModels = DatabaseDef<
  Record<string, AthenaClientSchemaModels>
>;
export type AthenaClientRegistryModels = RegistryDef<
  Record<string, AthenaClientDatabaseModels>
>;

/**
 * Additive model/registry input accepted by `createClient({ models, ... })` for
 * typed `from("table")` inference.
 */
export type AthenaClientModelsInput =
  | AthenaClientModelMap
  | AthenaClientSchemaModels
  | AthenaClientDatabaseModels
  | AthenaClientRegistryModels;

export type AthenaClientModelUnion<TModels> = [TModels] extends [AnyModelDef]
  ? TModels
  : [TModels] extends [{ models: infer TModelsMap }]
    ? AthenaClientModelUnion<TModelsMap>
    : [TModels] extends [{ schemas: infer TSchemas }]
      ? AthenaClientModelUnion<TSchemas>
      : [TModels] extends [Record<string, infer TValue>]
        ? AthenaClientModelUnion<TValue>
        : never;

export type AthenaClientModelQualifiedTableName<TModel> = TModel extends {
  qualifiedName: infer TQualifiedName extends string;
}
  ? TQualifiedName
  : QualifiedNameFromMeta<TModel>;

export type AthenaClientModelBareTableName<TModel> = TModel extends {
  tableName: infer TTableName extends string;
}
  ? TTableName
  : TModel extends { qualifiedName: infer TQualifiedName extends string }
    ? StripSchemaPrefix<TQualifiedName>
    : BareNameFromMeta<TModel>;

type AthenaClientExplicitMatchNames<TModel extends AnyModelDef> =
  | AthenaClientModelQualifiedTableName<TModel>
  | AthenaClientModelBareTableName<TModel>;
type AthenaClientDefaultMatchNames<
  TModel extends AnyModelDef,
  TKey extends string,
> =
  MetaString<TModel, "schema"> extends infer TSchema extends string
    ? `${TSchema}.${TKey}` | TKey
    : TKey;
type AthenaClientMatchNames<TModel extends AnyModelDef, TKey extends string> = [
  AthenaClientExplicitMatchNames<TModel>,
] extends [never]
  ? AthenaClientDefaultMatchNames<TModel, TKey>
  : AthenaClientExplicitMatchNames<TModel>;

export type AthenaClientTableName<TModels> = [TModels] extends [
  { models: infer TModelsMap },
]
  ? AthenaClientTableName<TModelsMap>
  : [TModels] extends [{ schemas: infer TSchemas }]
    ? {
        [TKey in keyof TSchemas & string]: AthenaClientTableName<
          TSchemas[TKey]
        >;
      }[keyof TSchemas & string]
    : [TModels] extends [Record<string, unknown>]
      ? {
          [TKey in keyof TModels & string]: TModels[TKey] extends AnyModelDef
            ? AthenaClientMatchNames<TModels[TKey], TKey>
            : AthenaClientTableName<TModels[TKey]>;
        }[keyof TModels & string]
      : never;

export type AthenaClientModelForTableName<
  TModels,
  TTableName extends string,
> = [TModels] extends [{ models: infer TModelsMap }]
  ? AthenaClientModelForTableName<TModelsMap, TTableName>
  : [TModels] extends [{ schemas: infer TSchemas }]
    ? {
        [TKey in keyof TSchemas & string]: AthenaClientModelForTableName<
          TSchemas[TKey],
          TTableName
        >;
      }[keyof TSchemas & string]
    : [TModels] extends [Record<string, unknown>]
      ? {
          [TKey in keyof TModels & string]: TModels[TKey] extends AnyModelDef
            ? TTableName extends AthenaClientMatchNames<TModels[TKey], TKey>
              ? TModels[TKey]
              : never
            : AthenaClientModelForTableName<TModels[TKey], TTableName>;
        }[keyof TModels & string]
      : never;

/**
 * Schema-level model registry.
 */
export interface SchemaDef<Models extends Record<ModelKey, AnyModelDef>> {
  readonly models: Models;
}

/**
 * Database-level schema registry.
 */
export interface DatabaseDef<
  Schemas extends Record<string, SchemaDef<Record<ModelKey, AnyModelDef>>>,
> {
  readonly schemas: Schemas;
}

/**
 * Top-level registry keyed by logical database names.
 */
export type RegistryDef<
  Databases extends Record<
    string,
    DatabaseDef<Record<string, SchemaDef<Record<ModelKey, AnyModelDef>>>>
  >,
> = Databases;

/**
 * Extracts row type from a model definition.
 */
export type RowOf<TModel extends AnyModelDef> =
  TModel extends ModelDef<infer TRow, unknown, unknown, ModelMetadataBase>
    ? TRow
    : never;

/**
 * Extracts insert type from a model definition.
 */
export type InsertOf<TModel extends AnyModelDef> =
  TModel extends ModelDef<unknown, infer TInsert, unknown, ModelMetadataBase>
    ? TInsert
    : never;

/**
 * Extracts update type from a model definition.
 */
export type UpdateOf<TModel extends AnyModelDef> =
  TModel extends ModelDef<unknown, unknown, infer TUpdate, ModelMetadataBase>
    ? TUpdate
    : never;

/**
 * Resolves a model definition from a registry path.
 */
export type ModelAt<
  TRegistry extends RegistryDef<
    Record<
      string,
      DatabaseDef<Record<string, SchemaDef<Record<ModelKey, AnyModelDef>>>>
    >
  >,
  TDatabase extends keyof TRegistry & string,
  TSchema extends keyof TRegistry[TDatabase]["schemas"] & string,
  TModel extends keyof TRegistry[TDatabase]["schemas"][TSchema]["models"] &
    string,
> = TRegistry[TDatabase]["schemas"][TSchema]["models"][TModel];

/**
 * Introspection-level column type families.
 */
export type IntrospectionTypeKind =
  | "scalar"
  | "enum"
  | "domain"
  | "range"
  | "multirange"
  | "composite";

/**
 * Introspected column metadata.
 */
export interface IntrospectionColumn {
  arrayDimensions: number;
  dataType: string;
  /**
   * Postgres default expression when catalog provides it (`pg_get_expr`).
   * Optional for backward-compatible snapshots that only set `hasDefault`.
   */
  defaultExpression?: string | null;
  enumValues?: string[];
  hasDefault: boolean;
  isGenerated: boolean;
  isNullable: boolean;
  isPrimaryKey: boolean;
  name: string;
  typeKind: IntrospectionTypeKind;
  udtName: string;
}

/**
 * Introspected relationship metadata.
 */
export interface IntrospectionRelation {
  kind: ModelRelationKind;
  name: string;
  /**
   * Postgres FK ON DELETE action when known (`a`/`r`/`c`/`n`/`d` or long form).
   * Optional — absent means unknown / default NO ACTION for schema-diff adapters.
   */
  onDelete?: string | null;
  /**
   * Postgres FK ON UPDATE action when known.
   */
  onUpdate?: string | null;
  sourceColumns: string[];
  targetColumns: string[];
  targetDatabase?: string;
  targetModel: string;
  targetSchema: string;
  through?: {
    schema: string;
    model: string;
    sourceColumns: string[];
    targetColumns: string[];
  };
}

/**
 * Introspected table metadata.
 */
/**
 * Optional unique constraint metadata from extended catalog introspection.
 */
export interface IntrospectionUniqueConstraint {
  columns: string[];
  name: string;
}

/**
 * Optional index metadata from extended catalog introspection.
 * Column order is significant; expression indexes may be omitted by the catalog query.
 */
export interface IntrospectionIndex {
  /**
   * Per-column sort direction parallel to `columns`.
   * When omitted or shorter than `columns`, missing entries default to `asc`.
   */
  columnDirections?: Array<"asc" | "desc">;
  columns: string[];
  method?: string | null;
  name: string;
  predicate?: string | null;
  unique: boolean;
}

export interface IntrospectionTable {
  columns: Record<string, IntrospectionColumn>;
  /** Present when unique-constraint catalog rows were assembled. */
  indexes?: IntrospectionIndex[];
  name: string;
  primaryKey: string[];
  relations: Record<string, IntrospectionRelation>;
  schema: string;
  /** Present when unique-constraint catalog rows were assembled. */
  uniqueConstraints?: IntrospectionUniqueConstraint[];
}

/**
 * Introspected schema metadata.
 */
export interface IntrospectionSchema {
  name: string;
  tables: Record<string, IntrospectionTable>;
}

/**
 * Normalized output of a schema introspection pass.
 */
export interface IntrospectionSnapshot {
  backend: BackendType;
  database: string;
  generatedAt: string;
  schemas: Record<string, IntrospectionSchema>;
}

/**
 * Options accepted by introspection providers.
 */
export interface IntrospectionInspectOptions {
  schemas?: string[];
}

/**
 * Provider contract implemented by backend-specific introspection adapters.
 */
export interface SchemaIntrospectionProvider {
  readonly backend: BackendType;
  inspect: (
    options?: IntrospectionInspectOptions
  ) => Promise<IntrospectionSnapshot>;
}
