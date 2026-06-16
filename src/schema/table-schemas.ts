import { z, type ZodType, type ZodTypeAny } from 'zod'
import { toModelPayload } from './model-form.ts'
import { getColumnConfig, type AnyColumnBuilder } from './table-columns.ts'
import type { AnyModelDef, ModelColumnKind } from './types.ts'

export interface AthenaTableSchemaBundle<Row, Insert, Update> {
  readonly row: ZodType<Row>
  readonly insert: ZodType<Insert>
  readonly update: ZodType<Update>
  readonly form: ZodType<Insert>
}

function isScalarFormKind(kind: ModelColumnKind): boolean {
  return kind === 'string' || kind === 'number' || kind === 'boolean' || kind === 'enumeration'
}

function createBaseSchema(column: AnyColumnBuilder): ZodTypeAny {
  const config = getColumnConfig(column)

  switch (config.kind) {
    case 'boolean':
      return z.boolean()
    case 'number':
      return z.number()
    case 'json':
      return (config.jsonSchema ?? z.unknown()) as ZodTypeAny
    case 'enumeration':
      if (!config.enumValues || config.enumValues.length === 0) {
        return z.string()
      }
      return z.enum(config.enumValues as [string, ...string[]])
    case 'string':
    default:
      return z.string()
  }
}

function applyNullable(schema: ZodTypeAny, column: AnyColumnBuilder): ZodTypeAny {
  const config = getColumnConfig(column)
  return config.nullable ? schema.nullable() : schema
}

function applyInsertOptional(schema: ZodTypeAny, column: AnyColumnBuilder): ZodTypeAny {
  const config = getColumnConfig(column)
  return config.nullable || config.hasDefault ? schema.optional() : schema
}

function createFormFieldSchema(column: AnyColumnBuilder): ZodTypeAny {
  const config = getColumnConfig(column)
  const base = createBaseSchema(column)

  let schema: ZodTypeAny
  if (config.nullable && isScalarFormKind(config.kind)) {
    schema = z
      .union([base, z.literal('')])
      .transform(value => value === '' ? null : value)
  } else {
    schema = applyNullable(base, column)
  }

  if (config.nullable || config.hasDefault) {
    schema = schema.optional()
  }

  return schema
}

export function buildTableSchemaBundle<Row, Insert, Update>(
  model: AnyModelDef,
  columns: Record<string, AnyColumnBuilder>,
): AthenaTableSchemaBundle<Row, Insert, Update> {
  const rowShape: Record<string, ZodTypeAny> = {}
  const insertShape: Record<string, ZodTypeAny> = {}
  const updateShape: Record<string, ZodTypeAny> = {}
  const formShape: Record<string, ZodTypeAny> = {}

  for (const [columnName, column] of Object.entries(columns)) {
    const config = getColumnConfig(column)
    const base = createBaseSchema(column)

    rowShape[columnName] = applyNullable(base, column)

    if (config.isGenerated) {
      continue
    }

    insertShape[columnName] = applyInsertOptional(applyNullable(base, column), column)
    updateShape[columnName] = applyNullable(base, column).optional()
    formShape[columnName] = createFormFieldSchema(column)
  }

  const rowSchema = z.object(rowShape) as ZodType<Row>
  const insertSchema = z.object(insertShape) as ZodType<Insert>
  const updateSchema = z.object(updateShape) as ZodType<Update>
  const formSchema = z
    .object(formShape)
    .transform(value => toModelPayload(model, value as never) as Insert) as ZodType<Insert>

  return {
    row: rowSchema,
    insert: insertSchema,
    update: updateSchema,
    form: formSchema,
  }
}
