import type { BackendType } from '../gateway/types.ts'

type ModelKey = string
type ColumnKey = string

/**
 * Supported column helper families for table-builder definitions.
 */
export type ModelColumnKind = 'boolean' | 'number' | 'string' | 'json' | 'enumeration'

/**
 * Optional per-column metadata carried by model contracts.
 */
export interface ModelColumnMetadata {
  kind: ModelColumnKind
  columnName?: string
  nullable?: boolean
  hasDefault?: boolean
  isGenerated?: boolean
  enumValues?: readonly string[]
}

/**
 * Runtime values that can safely be serialized into tenant-scoped headers.
 */
export type TenantContextValue = string | number | boolean | null | undefined

/**
 * Compile-time map of tenant context keys to outbound header names.
 */
export type TenantKeyMap = Record<string, string>

/**
 * Partial tenant context keyed by `TenantKeyMap`.
 */
export type TenantContext<TMap extends TenantKeyMap> = Partial<Record<keyof TMap, TenantContextValue>>

/**
 * Supported relationship cardinalities for model metadata and introspection snapshots.
 */
export type ModelRelationKind =
  | 'one-to-one'
  | 'one-to-many'
  | 'many-to-one'
  | 'many-to-many'

/**
 * Base metadata shape shared by typed model definitions and introspection snapshots.
 * This type is intentionally row-agnostic so it can be used for generic registries.
 */
export interface ModelMetadataBase {
  database?: string
  schema?: string
  model?: string
  tableName?: string
  primaryKey: string[]
  nullable?: Partial<Record<string, boolean>>
  columns?: Partial<Record<string, ModelColumnMetadata>>
  relations?: Record<string, ModelRelationMetadata>
}

/**
 * Strongly-typed model metadata linked to a row shape.
 */
export type ModelMetadata<Row> = Omit<ModelMetadataBase, 'primaryKey' | 'nullable'> & {
  primaryKey: Array<Extract<keyof Row, string>>
  nullable?: Partial<Record<Extract<keyof Row, string>, boolean>>
  columns?: Partial<Record<Extract<keyof Row, string>, ModelColumnMetadata>>
}

/**
 * Relation metadata for model contracts and introspection snapshots.
 */
export interface ModelRelationMetadata {
  kind: ModelRelationKind
  sourceColumns: ColumnKey[]
  targetSchema: string
  targetModel: ModelKey
  targetColumns: ColumnKey[]
  targetDatabase?: string
  through?: {
    schema: string
    model: string
    sourceColumns: ColumnKey[]
    targetColumns: ColumnKey[]
  }
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
  readonly meta: Meta
  readonly __types?: {
    row: Row
    insert: Insert
    update: Update
  }
}

/**
 * Row-agnostic model definition used as a generic constraint.
 */
export type AnyModelDef = ModelDef<unknown, unknown, unknown, ModelMetadataBase>

/**
 * Public model/table value that carries Athena target metadata plus row/write typings.
 * This can be passed directly to `client.from(...)` for opt-in target inference.
 */
export type AthenaModelTarget<
  Row = unknown,
  Insert = unknown,
  Update = unknown,
> = ModelDef<Row, Insert, Update, ModelMetadataBase>

/**
 * Schema-level model registry.
 */
export interface SchemaDef<Models extends Record<ModelKey, AnyModelDef>> {
  readonly models: Models
}

/**
 * Database-level schema registry.
 */
export interface DatabaseDef<
  Schemas extends Record<string, SchemaDef<Record<ModelKey, AnyModelDef>>>,
> {
  readonly schemas: Schemas
}

/**
 * Top-level registry keyed by logical database names.
 */
export type RegistryDef<
  Databases extends Record<string, DatabaseDef<Record<string, SchemaDef<Record<ModelKey, AnyModelDef>>>>>,
> = Databases

/**
 * Extracts row type from a model definition.
 */
export type RowOf<TModel extends AnyModelDef> =
  TModel extends ModelDef<infer TRow, unknown, unknown, ModelMetadataBase> ? TRow : never

/**
 * Extracts insert type from a model definition.
 */
export type InsertOf<TModel extends AnyModelDef> =
  TModel extends ModelDef<unknown, infer TInsert, unknown, ModelMetadataBase> ? TInsert : never

/**
 * Extracts update type from a model definition.
 */
export type UpdateOf<TModel extends AnyModelDef> =
  TModel extends ModelDef<unknown, unknown, infer TUpdate, ModelMetadataBase> ? TUpdate : never

/**
 * Resolves a model definition from a registry path.
 */
export type ModelAt<
  TRegistry extends RegistryDef<Record<string, DatabaseDef<Record<string, SchemaDef<Record<ModelKey, AnyModelDef>>>>>>,
  TDatabase extends keyof TRegistry & string,
  TSchema extends keyof TRegistry[TDatabase]['schemas'] & string,
  TModel extends keyof TRegistry[TDatabase]['schemas'][TSchema]['models'] & string,
> = TRegistry[TDatabase]['schemas'][TSchema]['models'][TModel]

/**
 * Introspection-level column type families.
 */
export type IntrospectionTypeKind = 'scalar' | 'enum' | 'domain' | 'range' | 'multirange' | 'composite'

/**
 * Introspected column metadata.
 */
export interface IntrospectionColumn {
  name: string
  dataType: string
  udtName: string
  typeKind: IntrospectionTypeKind
  isNullable: boolean
  isPrimaryKey: boolean
  hasDefault: boolean
  isGenerated: boolean
  arrayDimensions: number
  enumValues?: string[]
}

/**
 * Introspected relationship metadata.
 */
export interface IntrospectionRelation {
  name: string
  kind: ModelRelationKind
  sourceColumns: string[]
  targetSchema: string
  targetModel: string
  targetColumns: string[]
  targetDatabase?: string
  through?: {
    schema: string
    model: string
    sourceColumns: string[]
    targetColumns: string[]
  }
}

/**
 * Introspected table metadata.
 */
export interface IntrospectionTable {
  schema: string
  name: string
  columns: Record<string, IntrospectionColumn>
  primaryKey: string[]
  relations: Record<string, IntrospectionRelation>
}

/**
 * Introspected schema metadata.
 */
export interface IntrospectionSchema {
  name: string
  tables: Record<string, IntrospectionTable>
}

/**
 * Normalized output of a schema introspection pass.
 */
export interface IntrospectionSnapshot {
  backend: BackendType
  database: string
  generatedAt: string
  schemas: Record<string, IntrospectionSchema>
}

/**
 * Options accepted by introspection providers.
 */
export interface IntrospectionInspectOptions {
  schemas?: string[]
}

/**
 * Provider contract implemented by backend-specific introspection adapters.
 */
export interface SchemaIntrospectionProvider {
  readonly backend: BackendType
  inspect(options?: IntrospectionInspectOptions): Promise<IntrospectionSnapshot>
}
