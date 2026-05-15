/* eslint-disable @typescript-eslint/no-explicit-any */
import type { BackendType } from '../gateway/types.ts'

type ModelKey = string
type ColumnKey = string
type AnyModelDef = ModelDef<any, any, any, ModelMetadata<any>>
type AnySchemaDef = SchemaDef<Record<ModelKey, AnyModelDef>>
type AnyDatabaseDef = DatabaseDef<Record<string, AnySchemaDef>>

export type TenantContextValue = string | number | boolean | null | undefined
export type TenantKeyMap = Record<string, string>
export type TenantContext<TMap extends TenantKeyMap> = Partial<Record<keyof TMap, TenantContextValue>>

export type ModelRelationKind =
  | 'one-to-one'
  | 'one-to-many'
  | 'many-to-one'
  | 'many-to-many'

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

export interface ModelMetadata<Row> {
  database?: string
  schema?: string
  model?: string
  tableName?: string
  primaryKey: Array<Extract<keyof Row, string>>
  nullable?: Partial<Record<Extract<keyof Row, string>, boolean>>
  relations?: Record<string, ModelRelationMetadata>
}

export interface ModelDef<
  Row,
  Insert = Partial<Row>,
  Update = Partial<Insert>,
  Meta extends ModelMetadata<Row> = ModelMetadata<Row>,
> {
  readonly meta: Meta
  readonly __types?: {
    row: Row
    insert: Insert
    update: Update
  }
}

export interface SchemaDef<Models extends Record<ModelKey, AnyModelDef>> {
  readonly models: Models
}

export interface DatabaseDef<
  Schemas extends Record<string, AnySchemaDef>,
> {
  readonly schemas: Schemas
}

export type RegistryDef<
  Databases extends Record<string, AnyDatabaseDef>
> = Databases

export type RowOf<TModel extends AnyModelDef> =
  TModel extends ModelDef<infer TRow, any, any, ModelMetadata<any>> ? TRow : never

export type InsertOf<TModel extends AnyModelDef> =
  TModel extends ModelDef<any, infer TInsert, any, ModelMetadata<any>> ? TInsert : never

export type UpdateOf<TModel extends AnyModelDef> =
  TModel extends ModelDef<any, any, infer TUpdate, ModelMetadata<any>> ? TUpdate : never

export type ModelAt<
  TRegistry extends RegistryDef<Record<string, AnyDatabaseDef>>,
  TDatabase extends keyof TRegistry & string,
  TSchema extends keyof TRegistry[TDatabase]['schemas'] & string,
  TModel extends keyof TRegistry[TDatabase]['schemas'][TSchema]['models'] & string,
> = TRegistry[TDatabase]['schemas'][TSchema]['models'][TModel]

export type IntrospectionTypeKind = 'scalar' | 'enum' | 'domain' | 'range' | 'multirange' | 'composite'

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

export interface IntrospectionTable {
  schema: string
  name: string
  columns: Record<string, IntrospectionColumn>
  primaryKey: string[]
  relations: Record<string, IntrospectionRelation>
}

export interface IntrospectionSchema {
  name: string
  tables: Record<string, IntrospectionTable>
}

export interface IntrospectionSnapshot {
  backend: BackendType
  database: string
  generatedAt: string
  schemas: Record<string, IntrospectionSchema>
}

export interface IntrospectionInspectOptions {
  schemas?: string[]
}

export interface SchemaIntrospectionProvider {
  readonly backend: BackendType
  inspect(options?: IntrospectionInspectOptions): Promise<IntrospectionSnapshot>
}
