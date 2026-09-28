import { type ZodType, type ZodTypeAny, z } from "zod";
import { toModelPayload } from "./model-form.ts";
import { type AnyColumnBuilder, getColumnConfig } from "./table-columns.ts";
import type { AnyModelDef, ModelColumnKind } from "./types.ts";

const POSTGRES_INT8_MIN = BigInt("-9223372036854775808");
const POSTGRES_INT8_MAX = BigInt("9223372036854775807");

function createBigintSchema(): ZodTypeAny {
  return z
    .string()
    .refine((value) => {
      if (!/^[+-]?\d+$/.test(value)) {
        return false;
      }
      const parsed = BigInt(value);
      return parsed >= POSTGRES_INT8_MIN && parsed <= POSTGRES_INT8_MAX;
    });
}

export interface AthenaTableSchemaBundle<Row, Insert, Update> {
  readonly form: ZodType<Insert>;
  readonly insert: ZodType<Insert>;
  readonly row: ZodType<Row>;
  readonly update: ZodType<Update>;
}

function isScalarFormKind(kind: ModelColumnKind): boolean {
  return (
    kind === "string" ||
    kind === "number" ||
    kind === "smallint" ||
    kind === "integer" ||
    kind === "bigint" ||
    kind === "decimal" ||
    kind === "boolean" ||
    kind === "enumeration"
  );
}

function createBaseSchema(column: AnyColumnBuilder): ZodTypeAny {
  const config = getColumnConfig(column);

  switch (config.kind) {
    case "boolean":
      return z.boolean();
    case "number":
      return z.number();
    case "smallint":
      return z.number().int().min(-32768).max(32767);
    case "integer":
      return z.number().int().min(-2147483648).max(2147483647);
    case "bigint":
      return createBigintSchema();
    case "decimal":
      // Precision-safe runtime representation (matches PostgreSQL NUMERIC wire).
      return z.string();
    case "json":
      return (config.jsonSchema ?? z.unknown()) as ZodTypeAny;
    case "enumeration":
      if (!config.enumValues || config.enumValues.length === 0) {
        return z.string();
      }
      return z.enum(config.enumValues as [string, ...string[]]);
    default:
      return z.string();
  }
}

function applyNullable(
  schema: ZodTypeAny,
  column: AnyColumnBuilder
): ZodTypeAny {
  const config = getColumnConfig(column);
  return config.nullable ? schema.nullable() : schema;
}

function applyInsertOptional(
  schema: ZodTypeAny,
  column: AnyColumnBuilder
): ZodTypeAny {
  const config = getColumnConfig(column);
  return config.nullable || config.hasDefault ? schema.optional() : schema;
}

function createFormFieldSchema(column: AnyColumnBuilder): ZodTypeAny {
  const config = getColumnConfig(column);
  const base = createBaseSchema(column);

  let schema: ZodTypeAny;
  if (config.nullable && isScalarFormKind(config.kind)) {
    schema = z
      .union([base, z.literal("")])
      .transform((value) => (value === "" ? null : value));
  } else {
    schema = applyNullable(base, column);
  }

  if (config.nullable || config.hasDefault) {
    schema = schema.optional();
  }

  return schema;
}

export function buildTableSchemaBundle<Row, Insert, Update>(
  model: AnyModelDef,
  columns: Record<string, AnyColumnBuilder>
): AthenaTableSchemaBundle<Row, Insert, Update> {
  const rowShape: Record<string, ZodTypeAny> = {};
  const insertShape: Record<string, ZodTypeAny> = {};
  const updateShape: Record<string, ZodTypeAny> = {};
  const formShape: Record<string, ZodTypeAny> = {};

  for (const [columnName, column] of Object.entries(columns)) {
    const config = getColumnConfig(column);
    const base = createBaseSchema(column);

    rowShape[columnName] = applyNullable(base, column);

    if (config.identity === "always") {
      // Keep ALWAYS columns visible to Zod so explicit values fail instead of
      // being silently stripped.
      insertShape[columnName] = z.never().optional();
      updateShape[columnName] = z.never().optional();
      continue;
    }
    if (config.isGenerated) {
      continue;
    }

    insertShape[columnName] = applyInsertOptional(
      applyNullable(base, column),
      column
    );
    updateShape[columnName] = applyNullable(base, column).optional();
    formShape[columnName] = createFormFieldSchema(column);
  }

  const rowSchema = z.object(rowShape) as ZodType<Row>;
  const insertSchema = z.object(insertShape) as ZodType<Insert>;
  const updateSchema = z.object(updateShape) as ZodType<Update>;
  const formSchema = z
    .object(formShape)
    .transform(
      (value) => toModelPayload(model, value as never) as Insert
    ) as ZodType<Insert>;

  return {
    form: formSchema,
    insert: insertSchema,
    row: rowSchema,
    update: updateSchema,
  };
}
