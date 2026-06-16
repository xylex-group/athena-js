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
> extends ModelDef<
    RowFromColumns<TColumns>,
    InsertFromColumns<TColumns>,
    UpdateFromColumns<TColumns>,
    ModelMetadata<RowFromColumns<TColumns>>
  > {
  readonly kind: 'table'
  readonly name: string
  readonly columns: Readonly<TColumns>
  readonly schemas: AthenaTableSchemaBundle<
    RowFromColumns<TColumns>,
    InsertFromColumns<TColumns>,
    UpdateFromColumns<TColumns>
  >
}

interface AthenaTableBuilder<TName extends string, TMappedName extends string | undefined = undefined> {
  readonly name: TName
  readonly mappedName: TMappedName
  from<TNextMappedName extends string>(
    tableName: TNextMappedName,
  ): AthenaTableBuilder<TName, TNextMappedName>
  columns<TColumns extends Record<string, AnyColumnBuilder>>(
    columns: TColumns,
  ): AthenaTableColumnsBuilder<TName, TMappedName, TColumns>
}

interface AthenaTableColumnsBuilder<
  TName extends string,
  TMappedName extends string | undefined,
  TColumns extends Record<string, AnyColumnBuilder>,
> {
  readonly name: TName
  readonly mappedName: TMappedName
  readonly columns: Readonly<TColumns>
  from<TNextMappedName extends string>(
    tableName: TNextMappedName,
  ): AthenaTableColumnsBuilder<TName, TNextMappedName, TColumns>
  primaryKey<
    TPrimaryKey extends readonly [
      Extract<keyof TColumns, string>,
      ...Array<Extract<keyof TColumns, string>>,
    ],
  >(...keys: TPrimaryKey): AthenaTableDef<TColumns>
}

function assertColumnRecord(columns: Record<string, AnyColumnBuilder>): void {
  for (const [columnName, column] of Object.entries(columns)) {
    if (!isColumnBuilder(column)) {
      throw new Error(`Invalid column definition for "${columnName}"`)
    }
  }
}

function resolveTableTarget(logicalName: string, mappedName?: string): {
  schema?: string
  model: string
} {
  const physicalName = (mappedName ?? logicalName).trim()
  if (!physicalName) {
    throw new Error('table() requires a non-empty name')
  }

  const firstDot = physicalName.indexOf('.')
  const lastDot = physicalName.lastIndexOf('.')
  if (firstDot > 0 && firstDot === lastDot) {
    return {
      schema: physicalName.slice(0, firstDot),
      model: physicalName.slice(firstDot + 1),
    }
  }

  return {
    model: physicalName,
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
  TColumns extends Record<string, AnyColumnBuilder>,
>(
  name: TName,
  mappedName: TMappedName,
  columns: TColumns,
  primaryKey: readonly [Extract<keyof TColumns, string>, ...Array<Extract<keyof TColumns, string>>],
): AthenaTableDef<TColumns> {
  const target = resolveTableTarget(name, mappedName)
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
    columns,
    schemas,
  })
}

function createColumnsBuilder<
  TName extends string,
  TMappedName extends string | undefined,
  TColumns extends Record<string, AnyColumnBuilder>,
>(
  name: TName,
  mappedName: TMappedName,
  columns: TColumns,
): AthenaTableColumnsBuilder<TName, TMappedName, TColumns> {
  assertColumnRecord(columns)

  return {
    name,
    mappedName,
    columns,
    from<TNextMappedName extends string>(tableName: TNextMappedName) {
      return createColumnsBuilder(name, tableName, columns)
    },
    primaryKey(...keys) {
      return finalizeTable(name, mappedName, columns, keys)
    },
  }
}

function createTableBuilder<TName extends string, TMappedName extends string | undefined>(
  name: TName,
  mappedName: TMappedName,
): AthenaTableBuilder<TName, TMappedName> {
  return {
    name,
    mappedName,
    from<TNextMappedName extends string>(tableName: TNextMappedName) {
      return createTableBuilder(name, tableName)
    },
    columns<TColumns extends Record<string, AnyColumnBuilder>>(columns: TColumns) {
      return createColumnsBuilder(name, mappedName, columns)
    },
  }
}

export function table<TName extends string>(name: TName): AthenaTableBuilder<TName, undefined> {
  if (!name.trim()) {
    throw new Error('table() requires a non-empty name')
  }

  return createTableBuilder(name, undefined)
}

export type { AthenaColumnBuilder }
