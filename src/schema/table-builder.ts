import { defineModel } from './definitions.ts'
import type { ModelFormValues, ModelFormNullishMode } from './model-form.ts'
import { buildTableSchemaBundle, type AthenaTableSchemaBundle } from './table-schemas.ts'
import {
  COLUMN_CONFIG,
  getColumnConfig,
  isColumnBuilder,
  type AnyColumnBuilder,
  type AthenaColumnBuilder,
} from './table-columns.ts'
import type { AnyModelDef, ModelColumnMetadata, ModelDef, ModelMetadata } from './types.ts'

type Simplify<T> = { [K in keyof T]: T[K] } & {}
type ExtractColumnConfig<TColumn extends AnyColumnBuilder> = TColumn[typeof COLUMN_CONFIG]
type ColumnValue<TColumn extends AnyColumnBuilder> =
  ExtractColumnConfig<TColumn> extends { __value?: infer TValue } ? TValue : never
type ColumnNullable<TColumn extends AnyColumnBuilder> =
  ExtractColumnConfig<TColumn> extends { nullable: infer TNullable extends boolean } ? TNullable : never
type ColumnHasDefault<TColumn extends AnyColumnBuilder> =
  ExtractColumnConfig<TColumn> extends { hasDefault: infer THasDefault extends boolean } ? THasDefault : never
type ColumnGenerated<TColumn extends AnyColumnBuilder> =
  ExtractColumnConfig<TColumn> extends { isGenerated: infer TGenerated extends boolean } ? TGenerated : never

type RowFieldType<TColumn extends AnyColumnBuilder> =
  ColumnNullable<TColumn> extends true ? ColumnValue<TColumn> | null : ColumnValue<TColumn>

type WritableColumnKeys<TColumns extends Record<string, AnyColumnBuilder>> = Extract<{
  [K in keyof TColumns]-?: ColumnGenerated<TColumns[K]> extends true ? never : K
}[keyof TColumns], string>

type InsertRequiredKeys<TColumns extends Record<string, AnyColumnBuilder>> = Extract<{
  [K in keyof TColumns]-?: ColumnGenerated<TColumns[K]> extends true
    ? never
    : ColumnHasDefault<TColumns[K]> extends true
      ? never
      : ColumnNullable<TColumns[K]> extends true
        ? never
        : K
}[keyof TColumns], string>

type InsertOptionalKeys<TColumns extends Record<string, AnyColumnBuilder>> = Exclude<
  WritableColumnKeys<TColumns>,
  InsertRequiredKeys<TColumns>
>

type ExtractMappedSchemaName<TMappedName extends string | undefined> =
  TMappedName extends `${infer TSchema}.${string}` ? TSchema : undefined

type ExtractMappedTableName<TMappedName extends string | undefined> =
  TMappedName extends `${string}.${infer TTable}`
    ? TTable
    : TMappedName extends string
      ? TMappedName
      : undefined

type ResolvedSchemaName<
  TSchemaName extends string | undefined,
  TMappedName extends string | undefined,
> = TSchemaName extends string ? TSchemaName : ExtractMappedSchemaName<TMappedName>

type ResolvedTableName<
  TName extends string,
  TMappedName extends string | undefined,
> = ExtractMappedTableName<TMappedName> extends string ? ExtractMappedTableName<TMappedName> : TName

type QualifiedTableName<
  TName extends string,
  TMappedName extends string | undefined,
  TSchemaName extends string | undefined,
> = ResolvedSchemaName<TSchemaName, TMappedName> extends infer TResolvedSchema extends string | undefined
  ? TResolvedSchema extends string
    ? `${TResolvedSchema}.${ResolvedTableName<TName, TMappedName>}`
    : ResolvedTableName<TName, TMappedName>
  : never

export type RowFromColumns<TColumns extends Record<string, AnyColumnBuilder>> = Simplify<{
  [K in keyof TColumns]: RowFieldType<TColumns[K]>
}>

export type InsertFromColumns<TColumns extends Record<string, AnyColumnBuilder>> = Simplify<
  {
    [K in InsertRequiredKeys<TColumns>]: ColumnValue<TColumns[K]>
  } & {
    [K in InsertOptionalKeys<TColumns>]?: RowFieldType<TColumns[K]>
  }
>

export type UpdateFromColumns<TColumns extends Record<string, AnyColumnBuilder>> = Simplify<{
  [K in WritableColumnKeys<TColumns>]?: RowFieldType<TColumns[K]>
}>

export type FormValuesFromColumns<
  TColumns extends Record<string, AnyColumnBuilder>,
  TMode extends ModelFormNullishMode = 'empty-string',
> = ModelFormValues<
  AthenaTableDef<TColumns>,
  TMode
>

export interface AthenaTableDef<
  TColumns extends Record<string, AnyColumnBuilder>,
  TName extends string = string,
  TMappedName extends string | undefined = undefined,
  TSchemaName extends string | undefined = undefined,
> extends ModelDef<
    RowFromColumns<TColumns>,
    InsertFromColumns<TColumns>,
    UpdateFromColumns<TColumns>,
    ModelMetadata<RowFromColumns<TColumns>>
  > {
  readonly kind: 'table'
  readonly name: TName
  readonly mappedName: TMappedName
  readonly schemaName: ResolvedSchemaName<TSchemaName, TMappedName>
  readonly tableName: ResolvedTableName<TName, TMappedName>
  readonly qualifiedName: QualifiedTableName<TName, TMappedName, TSchemaName>
  readonly columns: Readonly<TColumns>
  readonly schemas: AthenaTableSchemaBundle<
    RowFromColumns<TColumns>,
    InsertFromColumns<TColumns>,
    UpdateFromColumns<TColumns>
  >
}

interface AthenaTableBuilder<
  TName extends string,
  TMappedName extends string | undefined = undefined,
  TSchemaName extends string | undefined = undefined,
> {
  readonly name: TName
  readonly mappedName: TMappedName
  readonly schemaName: TSchemaName
  from<TNextMappedName extends string>(
    tableName: TNextMappedName,
  ): AthenaTableBuilder<TName, TNextMappedName, TSchemaName>
  schema<TNextSchemaName extends string>(
    schemaName: TNextSchemaName,
  ): AthenaTableBuilder<TName, TMappedName, TNextSchemaName>
  columns<TColumns extends Record<string, AnyColumnBuilder>>(
    columns: TColumns,
  ): AthenaTableColumnsBuilder<TName, TMappedName, TSchemaName, TColumns>
}

interface AthenaTableColumnsBuilder<
  TName extends string,
  TMappedName extends string | undefined,
  TSchemaName extends string | undefined,
  TColumns extends Record<string, AnyColumnBuilder>,
> {
  readonly name: TName
  readonly mappedName: TMappedName
  readonly schemaName: TSchemaName
  readonly columns: Readonly<TColumns>
  from<TNextMappedName extends string>(
    tableName: TNextMappedName,
  ): AthenaTableColumnsBuilder<TName, TNextMappedName, TSchemaName, TColumns>
  schema<TNextSchemaName extends string>(
    schemaName: TNextSchemaName,
  ): AthenaTableColumnsBuilder<TName, TMappedName, TNextSchemaName, TColumns>
  primaryKey(): AthenaTableDef<TColumns, TName, TMappedName, TSchemaName>
  primaryKey<
    TPrimaryKey extends readonly [
      Extract<keyof TColumns, string>,
      ...Array<Extract<keyof TColumns, string>>,
    ],
  >(...keys: TPrimaryKey): AthenaTableDef<TColumns, TName, TMappedName, TSchemaName>
}

function assertColumnRecord(columns: Record<string, AnyColumnBuilder>): void {
  for (const [columnName, column] of Object.entries(columns)) {
    if (!isColumnBuilder(column)) {
      throw new Error(`Invalid column definition for "${columnName}"`)
    }
  }
}

function normalizeMappedNameInput(mappedName: string): string {
  const normalized = mappedName.trim()
  if (!normalized) {
    throw new Error('table.from() requires a non-empty table name')
  }
  return normalized
}

function normalizeSchemaNameInput(schemaName: string): string {
  const normalized = schemaName.trim()
  if (!normalized) {
    throw new Error('table.schema() requires a non-empty schema name')
  }
  if (normalized.includes('.')) {
    throw new Error(
      'table.schema() expects a schema name without dots. Use .schema("schema").from("table") or .from("schema.table").',
    )
  }
  return normalized
}

function resolveTableTarget(logicalName: string, mappedName?: string, explicitSchemaName?: string): {
  schema?: string
  model: string
  qualifiedName: string
} {
  const physicalName = (mappedName ?? logicalName).trim()
  if (!physicalName) {
    throw new Error('table() requires a non-empty name')
  }

  const firstDot = physicalName.indexOf('.')
  const lastDot = physicalName.lastIndexOf('.')
  if (firstDot > 0 && firstDot === lastDot) {
    const inlineSchema = physicalName.slice(0, firstDot).trim()
    const inlineModel = physicalName.slice(firstDot + 1).trim()
    if (!inlineSchema || !inlineModel) {
      throw new Error('table.from() schema-qualified names must look like "schema.table"')
    }
    if (explicitSchemaName && explicitSchemaName !== inlineSchema) {
      throw new Error(
        `table schema "${explicitSchemaName}" conflicts with mapped table "${physicalName}"`,
      )
    }

    return {
      schema: explicitSchemaName ?? inlineSchema,
      model: inlineModel,
      qualifiedName: `${explicitSchemaName ?? inlineSchema}.${inlineModel}`,
    }
  }

  if (explicitSchemaName) {
    return {
      schema: explicitSchemaName,
      model: physicalName,
      qualifiedName: `${explicitSchemaName}.${physicalName}`,
    }
  }

  return {
    model: physicalName,
    qualifiedName: physicalName,
  }
}

function toColumnMetadata(column: AnyColumnBuilder): ModelColumnMetadata {
  const config = getColumnConfig(column)
  return {
    kind: config.kind,
    columnName: config.columnName,
    nullable: config.nullable,
    hasDefault: config.hasDefault,
    isGenerated: config.isGenerated,
    enumValues: config.enumValues,
  }
}

function buildNullableMap(columns: Record<string, AnyColumnBuilder>): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(columns).map(([columnName, column]) => [columnName, getColumnConfig(column).nullable]),
  )
}

function buildColumnMetadataMap(columns: Record<string, AnyColumnBuilder>): Record<string, ModelColumnMetadata> {
  return Object.fromEntries(
    Object.entries(columns).map(([columnName, column]) => [columnName, toColumnMetadata(column)]),
  )
}

function finalizeTable<
  TName extends string,
  TMappedName extends string | undefined,
  TSchemaName extends string | undefined,
  TColumns extends Record<string, AnyColumnBuilder>,
>(
  name: TName,
  mappedName: TMappedName,
  schemaName: TSchemaName,
  columns: TColumns,
  primaryKey: ReadonlyArray<Extract<keyof TColumns, string>>,
): AthenaTableDef<TColumns, TName, TMappedName, TSchemaName> {
  const target = resolveTableTarget(name, mappedName, schemaName)
  const model = defineModel<
    RowFromColumns<TColumns>,
    InsertFromColumns<TColumns>,
    UpdateFromColumns<TColumns>
  >({
    meta: {
      schema: target.schema,
      model: target.model,
      primaryKey: [...primaryKey],
      nullable: buildNullableMap(columns),
      columns: buildColumnMetadataMap(columns),
    },
  })

  const schemas = buildTableSchemaBundle<
    RowFromColumns<TColumns>,
    InsertFromColumns<TColumns>,
    UpdateFromColumns<TColumns>
  >(model as AnyModelDef, columns)

  return Object.assign(model, {
    kind: 'table' as const,
    name,
    mappedName,
    schemaName: target.schema,
    tableName: target.model,
    qualifiedName: target.qualifiedName,
    columns,
    schemas,
  }) as AthenaTableDef<TColumns, TName, TMappedName, TSchemaName>
}

function createColumnsBuilder<
  TName extends string,
  TMappedName extends string | undefined,
  TSchemaName extends string | undefined,
  TColumns extends Record<string, AnyColumnBuilder>,
>(
  name: TName,
  mappedName: TMappedName,
  schemaName: TSchemaName,
  columns: TColumns,
): AthenaTableColumnsBuilder<TName, TMappedName, TSchemaName, TColumns> {
  assertColumnRecord(columns)

  return {
    name,
    mappedName,
    schemaName,
    columns,
    from<TNextMappedName extends string>(tableName: TNextMappedName) {
      const normalizedTableName = normalizeMappedNameInput(tableName)
      resolveTableTarget(name, normalizedTableName, schemaName)
      return createColumnsBuilder(name, normalizedTableName as TNextMappedName, schemaName, columns)
    },
    schema<TNextSchemaName extends string>(nextSchemaName: TNextSchemaName) {
      const normalizedSchemaName = normalizeSchemaNameInput(nextSchemaName)
      resolveTableTarget(name, mappedName, normalizedSchemaName)
      return createColumnsBuilder(name, mappedName, normalizedSchemaName as TNextSchemaName, columns)
    },
    primaryKey(...keys: Array<Extract<keyof TColumns, string>>) {
      return finalizeTable(name, mappedName, schemaName, columns, keys)
    },
  }
}

function createTableBuilder<
  TName extends string,
  TMappedName extends string | undefined,
  TSchemaName extends string | undefined,
>(
  name: TName,
  mappedName: TMappedName,
  schemaName: TSchemaName,
): AthenaTableBuilder<TName, TMappedName, TSchemaName> {
  return {
    name,
    mappedName,
    schemaName,
    from<TNextMappedName extends string>(tableName: TNextMappedName) {
      const normalizedTableName = normalizeMappedNameInput(tableName)
      resolveTableTarget(name, normalizedTableName, schemaName)
      return createTableBuilder(name, normalizedTableName as TNextMappedName, schemaName)
    },
    schema<TNextSchemaName extends string>(nextSchemaName: TNextSchemaName) {
      const normalizedSchemaName = normalizeSchemaNameInput(nextSchemaName)
      resolveTableTarget(name, mappedName, normalizedSchemaName)
      return createTableBuilder(name, mappedName, normalizedSchemaName as TNextSchemaName)
    },
    columns<TColumns extends Record<string, AnyColumnBuilder>>(columns: TColumns) {
      return createColumnsBuilder(name, mappedName, schemaName, columns)
    },
  }
}

export function table<TName extends string>(name: TName): AthenaTableBuilder<TName, undefined> {
  if (!name.trim()) {
    throw new Error('table() requires a non-empty name')
  }

  return createTableBuilder(name, undefined, undefined)
}

export type { AthenaColumnBuilder }
