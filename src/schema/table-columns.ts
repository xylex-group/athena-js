import type { ZodType } from "zod";
import type { ModelColumnKind } from "./types.ts";

export const COLUMN_CONFIG = Symbol("athena.column.config");

export interface ColumnRuntimeConfig<
  TValue,
  TNullable extends boolean = false,
  THasDefault extends boolean = false,
  TGenerated extends boolean = false,
  TColumnName extends string | undefined = undefined,
  TKind extends ModelColumnKind = ModelColumnKind,
> {
  readonly __value?: TValue;
  readonly columnName?: TColumnName;
  readonly enumValues?: readonly string[];
  readonly hasDefault: THasDefault;
  readonly isGenerated: TGenerated;
  readonly jsonSchema?: ZodType<TValue>;
  readonly kind: TKind;
  readonly nullable: TNullable;
}

export interface AthenaColumnBuilder<
  TValue,
  TNullable extends boolean = false,
  THasDefault extends boolean = false,
  TGenerated extends boolean = false,
  TColumnName extends string | undefined = undefined,
  TKind extends ModelColumnKind = ModelColumnKind,
> {
  defaulted: () => AthenaColumnBuilder<
    TValue,
    TNullable,
    true,
    TGenerated,
    TColumnName,
    TKind
  >;
  from: <TNextColumnName extends string>(
    columnName: TNextColumnName
  ) => AthenaColumnBuilder<
    TValue,
    TNullable,
    THasDefault,
    TGenerated,
    TNextColumnName,
    TKind
  >;
  generated: () => AthenaColumnBuilder<
    TValue,
    TNullable,
    THasDefault,
    true,
    TColumnName,
    TKind
  >;
  optional: () => AthenaColumnBuilder<
    TValue,
    true,
    THasDefault,
    TGenerated,
    TColumnName,
    TKind
  >;
  readonly [COLUMN_CONFIG]: ColumnRuntimeConfig<
    TValue,
    TNullable,
    THasDefault,
    TGenerated,
    TColumnName,
    TKind
  >;
}

export type AnyColumnBuilder = AthenaColumnBuilder<
  unknown,
  boolean,
  boolean,
  boolean,
  string | undefined,
  ModelColumnKind
>;

function createColumnBuilder<
  TValue,
  TNullable extends boolean,
  THasDefault extends boolean,
  TGenerated extends boolean,
  TColumnName extends string | undefined,
  TKind extends ModelColumnKind,
>(
  config: ColumnRuntimeConfig<
    TValue,
    TNullable,
    THasDefault,
    TGenerated,
    TColumnName,
    TKind
  >
): AthenaColumnBuilder<
  TValue,
  TNullable,
  THasDefault,
  TGenerated,
  TColumnName,
  TKind
> {
  return {
    [COLUMN_CONFIG]: config,
    defaulted() {
      return createColumnBuilder({
        ...config,
        hasDefault: true,
      });
    },
    from<TNextColumnName extends string>(columnName: TNextColumnName) {
      return createColumnBuilder({
        ...config,
        columnName,
      });
    },
    generated() {
      return createColumnBuilder({
        ...config,
        isGenerated: true,
      });
    },
    optional() {
      return createColumnBuilder({
        ...config,
        nullable: true,
      });
    },
  };
}

export function isColumnBuilder(value: unknown): value is AnyColumnBuilder {
  return value !== null && typeof value === "object" && COLUMN_CONFIG in value;
}

export function getColumnConfig<TColumn extends AnyColumnBuilder>(
  column: TColumn
): TColumn[typeof COLUMN_CONFIG] {
  return column[COLUMN_CONFIG];
}

export function string(): AthenaColumnBuilder<
  string,
  false,
  false,
  false,
  undefined,
  "string"
> {
  return createColumnBuilder({
    hasDefault: false,
    isGenerated: false,
    kind: "string",
    nullable: false,
  });
}

export function number(): AthenaColumnBuilder<
  number,
  false,
  false,
  false,
  undefined,
  "number"
> {
  return createColumnBuilder({
    hasDefault: false,
    isGenerated: false,
    kind: "number",
    nullable: false,
  });
}

export function boolean(): AthenaColumnBuilder<
  boolean,
  false,
  false,
  false,
  undefined,
  "boolean"
> {
  return createColumnBuilder({
    hasDefault: false,
    isGenerated: false,
    kind: "boolean",
    nullable: false,
  });
}

export function json<TValue = unknown>(
  schema?: ZodType<TValue>
): AthenaColumnBuilder<TValue, false, false, false, undefined, "json"> {
  return createColumnBuilder({
    hasDefault: false,
    isGenerated: false,
    jsonSchema: schema,
    kind: "json",
    nullable: false,
  });
}

export function enumeration<
  const TValues extends readonly [string, ...string[]],
>(
  values: TValues
): AthenaColumnBuilder<
  TValues[number],
  false,
  false,
  false,
  undefined,
  "enumeration"
> {
  if (values.length === 0) {
    throw new Error("enumeration() requires at least one value");
  }

  return createColumnBuilder({
    enumValues: values,
    hasDefault: false,
    isGenerated: false,
    kind: "enumeration",
    nullable: false,
  });
}
