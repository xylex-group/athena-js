import type { ZodType } from "zod";
import type { NativeTypeDescriptor } from "./ir/type.ts";
import type {
  ModelColumnDefault,
  ModelColumnDefaultInput,
  ModelColumnGenerationStrategy,
  ModelColumnIdentity,
  ModelColumnKind,
} from "./types.ts";

export const COLUMN_CONFIG = Symbol("athena.column.config");

export interface ColumnRuntimeConfig<
  TValue,
  TNullable extends boolean = false,
  THasDefault extends boolean = false,
  TGenerated extends boolean = false,
  TColumnName extends string | undefined = undefined,
  TKind extends ModelColumnKind = ModelColumnKind,
  TIdentity extends ModelColumnIdentity | undefined = undefined,
> {
  readonly __value?: TValue;
  readonly columnName?: TColumnName;
  readonly default?: ModelColumnDefault;
  readonly enumValues?: readonly string[];
  readonly generationStrategy: ModelColumnGenerationStrategy;
  readonly hasDefault: THasDefault;
  readonly identity?: TIdentity;
  readonly isGenerated: TGenerated;
  readonly jsonSchema?: ZodType<TValue>;
  readonly kind: TKind;
  readonly nativeType?: NativeTypeDescriptor;
  readonly nullable: TNullable;
  /** Exact-numeric precision (decimal/numeric columns). */
  readonly precision?: number;
  /** Exact-numeric scale (decimal/numeric columns). */
  readonly scale?: number;
}

interface ColumnBuilderMethods<
  TValue,
  TNullable extends boolean = false,
  THasDefault extends boolean = false,
  TGenerated extends boolean = false,
  TColumnName extends string | undefined = undefined,
  TKind extends ModelColumnKind = ModelColumnKind,
  TIdentity extends ModelColumnIdentity | undefined = undefined,
  TIdentityEnabled extends boolean = false,
> {
  nativeType: (
    descriptor: NativeTypeDescriptor
  ) => BuilderFor<
    TValue,
    TNullable,
    THasDefault,
    TGenerated,
    TColumnName,
    TKind,
    TIdentity,
    TIdentityEnabled
  >;
  defaulted: (
    value?: ModelColumnDefaultInput
  ) => BuilderFor<
    TValue,
    TNullable,
    true,
    TGenerated,
    TColumnName,
    TKind,
    TIdentity,
    TIdentityEnabled
  >;
  from: <TNextColumnName extends string>(
    columnName: TNextColumnName
  ) => BuilderFor<
    TValue,
    TNullable,
    THasDefault,
    TGenerated,
    TNextColumnName,
    TKind,
    TIdentity,
    TIdentityEnabled
  >;
  generated: () => BuilderFor<
    TValue,
    TNullable,
    THasDefault,
    true,
    TColumnName,
    TKind,
    undefined,
    false
  >;
  /**
   * Configure PostgreSQL identity semantics. The `number()` form is a
   * deprecated compatibility bridge; new code should use integer builders.
   */
  readonly identity: TIdentityEnabled extends true
    ? TNullable extends true
      ? never
      : TGenerated extends true
      ? never
      : TIdentity extends ModelColumnIdentity
        ? never
        : <TMode extends ModelColumnIdentity = "by-default">(
            mode?: TMode
          ) => AthenaIdentityColumnBuilder<
            TValue,
            false,
            true,
            false,
            TColumnName,
            TKind,
            TMode
          >
    : never;
  optional: () => BuilderFor<
    TValue,
    true,
    THasDefault,
    TGenerated,
    TColumnName,
    TKind,
    TIdentity,
    TIdentityEnabled
  >;
  precision: TKind extends "decimal"
    ? (
        value: number
      ) => BuilderFor<
        TValue,
        TNullable,
        THasDefault,
        TGenerated,
        TColumnName,
        TKind,
        TIdentity,
        TIdentityEnabled
      >
    : never;
  scale: TKind extends "decimal"
    ? (
        value: number
      ) => BuilderFor<
        TValue,
        TNullable,
        THasDefault,
        TGenerated,
        TColumnName,
        TKind,
        TIdentity,
        TIdentityEnabled
      >
    : never;
  readonly [COLUMN_CONFIG]: ColumnRuntimeConfig<
    TValue,
    TNullable,
    THasDefault,
    TGenerated,
    TColumnName,
    TKind,
    TIdentity
  >;
}

type BuilderFor<
  TValue,
  TNullable extends boolean,
  THasDefault extends boolean,
  TGenerated extends boolean,
  TColumnName extends string | undefined,
  TKind extends ModelColumnKind,
  TIdentity extends ModelColumnIdentity | undefined,
  TIdentityEnabled extends boolean,
> = TIdentityEnabled extends true
  ? AthenaIdentityColumnBuilder<
      TValue,
      TNullable,
      THasDefault,
      TGenerated,
      TColumnName,
      TKind,
      TIdentity
    >
  : AthenaColumnBuilder<
      TValue,
      TNullable,
      THasDefault,
      TGenerated,
      TColumnName,
      TKind,
      TIdentity
    >;

export interface AthenaColumnBuilder<
  TValue,
  TNullable extends boolean = false,
  THasDefault extends boolean = false,
  TGenerated extends boolean = false,
  TColumnName extends string | undefined = undefined,
  TKind extends ModelColumnKind = ModelColumnKind,
  TIdentity extends ModelColumnIdentity | undefined = undefined,
  TIdentityEnabled extends boolean = false,
> extends ColumnBuilderMethods<
    TValue,
    TNullable,
    THasDefault,
    TGenerated,
    TColumnName,
    TKind,
    TIdentity,
    TIdentityEnabled
  > {
  readonly __athenaColumnBuilder?: never;
}

export type AthenaIdentityColumnBuilder<
  TValue,
  TNullable extends boolean = false,
  THasDefault extends boolean = false,
  TGenerated extends boolean = false,
  TColumnName extends string | undefined = undefined,
  TKind extends ModelColumnKind = ModelColumnKind,
  TIdentity extends ModelColumnIdentity | undefined = undefined,
> = (TIdentity extends ModelColumnIdentity
  ? Omit<
      ColumnBuilderMethods<
        TValue,
        TNullable,
        THasDefault,
        TGenerated,
        TColumnName,
        TKind,
        TIdentity,
        true
      >,
      "generated" | "optional" | "identity"
    >
  : ColumnBuilderMethods<
      TValue,
      TNullable,
      THasDefault,
      TGenerated,
      TColumnName,
      TKind,
      TIdentity,
      true
    >) &
  object;

export type AnyColumnBuilder =
  | AthenaColumnBuilder<
      unknown,
      boolean,
      boolean,
      boolean,
      string | undefined,
      ModelColumnKind,
      ModelColumnIdentity | undefined
    >
  | AthenaIdentityColumnBuilder<
      unknown,
      boolean,
      boolean,
      boolean,
      string | undefined,
      ModelColumnKind,
      ModelColumnIdentity | undefined
    >;

export interface DecimalColumnOptions {
  precision?: number;
  scale?: number;
}

function assertNonNegativeInt(label: string, value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `${label} must be a non-negative integer (received ${value})`
    );
  }
  return value;
}

function createColumnBuilder<
  TValue,
  TNullable extends boolean,
  THasDefault extends boolean,
  TGenerated extends boolean,
  TColumnName extends string | undefined,
  TKind extends ModelColumnKind,
  TIdentity extends ModelColumnIdentity | undefined,
>(
  config: ColumnRuntimeConfig<
    TValue,
    TNullable,
    THasDefault,
    TGenerated,
    TColumnName,
    TKind,
    TIdentity
  >,
  identityEnabled = false
): AnyColumnBuilder {
  const builder = {
    [COLUMN_CONFIG]: config,
    nativeType(descriptor: NativeTypeDescriptor) {
      return createColumnBuilder(
        {
          ...config,
          nativeType: descriptor,
        },
        identityEnabled
      );
    },
    defaulted(value?: ModelColumnDefaultInput) {
      if (value === null && !config.nullable) {
        throw new Error(
          "Literal null defaults require nullable columns; non-nullable columns cannot use a literal null default"
        );
      }
      return createColumnBuilder(
        {
          ...config,
          ...(value === undefined
            ? { default: { kind: "unknown" as const } }
            : isSqlDefault(value)
              ? { default: { kind: "sql" as const, ...value } }
              : { default: { kind: "literal" as const, value } }),
          hasDefault: true,
        },
        identityEnabled
      );
    },
    from<TNextColumnName extends string>(columnName: TNextColumnName) {
      return createColumnBuilder(
        {
          ...config,
          columnName,
        },
        identityEnabled
      );
    },
    generated() {
      if (config.identity !== undefined) {
        throw new Error("Identity columns cannot also be generated");
      }
      return createColumnBuilder(
        {
          ...config,
          generationStrategy: { kind: "generated-always" },
          identity: undefined,
          isGenerated: true,
        },
        false
      );
    },
    optional() {
      if (config.identity !== undefined) {
        throw new Error("Identity columns cannot be optional");
      }
      return createColumnBuilder(
        {
          ...config,
          nullable: true,
        },
        identityEnabled
      );
    },
  };

  if (identityEnabled && config.identity === undefined && !config.isGenerated) {
    Object.assign(builder, {
      identity<TMode extends ModelColumnIdentity = "by-default">(
        mode = "by-default" as TMode
      ) {
        if (config.identity !== undefined) {
          throw new Error("Identity columns can only be configured once");
        }
        if (config.nullable) {
          throw new Error("Identity columns cannot be nullable");
        }
        if (config.isGenerated) {
          throw new Error(
            "Generated columns cannot transition to identity columns"
          );
        }
        return createColumnBuilder(
          {
            ...config,
            generationStrategy: { kind: "identity", mode },
            hasDefault: true,
            identity: mode,
            isGenerated: false,
            nullable: false,
          },
          identityEnabled
        );
      },
    });
  }

  if (config.kind === "decimal") {
    Object.assign(builder, {
      precision(value: number) {
        return createColumnBuilder(
          {
            ...config,
            precision: assertNonNegativeInt("precision", value),
          },
          identityEnabled
        );
      },
      scale(value: number) {
        return createColumnBuilder(
          {
            ...config,
            scale: assertNonNegativeInt("scale", value),
          },
          identityEnabled
        );
      },
    });
  }

  if (!identityEnabled) {
    return builder as AthenaColumnBuilder<
      TValue,
      TNullable,
      THasDefault,
      TGenerated,
      TColumnName,
      TKind,
      TIdentity
    >;
  }

  return builder as unknown as AthenaIdentityColumnBuilder<
    TValue,
    TNullable,
    THasDefault,
    TGenerated,
    TColumnName,
    TKind,
    TIdentity
  >;
}

function isSqlDefault(
  value: ModelColumnDefaultInput
): value is Exclude<ModelColumnDefaultInput, string | number | boolean | null> {
  return (
    typeof value === "object" &&
    value !== null &&
    "dialect" in value &&
    "expression" in value
  );
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
    generationStrategy: { kind: "none" },
    hasDefault: false,
    isGenerated: false,
    kind: "string",
    nullable: false,
  }) as AthenaColumnBuilder<string, false, false, false, undefined, "string">;
}

export type AthenaLegacyNumberColumnBuilder = Omit<
  AthenaColumnBuilder<
    number,
    false,
    false,
    false,
    undefined,
    "number",
    undefined,
    true
  >,
  "identity"
> & {
  /** @deprecated Prefer an integer builder for new identity columns. */
  readonly identity: <TMode extends ModelColumnIdentity = "by-default">(
    mode?: TMode
  ) => AthenaIdentityColumnBuilder<
    number,
    false,
    true,
    false,
    undefined,
    "number",
    TMode
  >;
};

/**
 * Create a legacy JavaScript-number column builder.
 *
 * Its `.identity()` member is retained as a deprecated PostgreSQL `BIGINT`
 * identity compatibility bridge; new identity columns should use an integer
 * builder.
 */
export function number(): AthenaLegacyNumberColumnBuilder {
  return createColumnBuilder(
    {
      generationStrategy: { kind: "none" },
      hasDefault: false,
      isGenerated: false,
      kind: "number",
      nullable: false,
    },
    true
  ) as AthenaLegacyNumberColumnBuilder;
}

export function smallint(): AthenaIdentityColumnBuilder<
  number,
  false,
  false,
  false,
  undefined,
  "smallint"
> {
  return createColumnBuilder(
    {
      generationStrategy: { kind: "none" },
      hasDefault: false,
      isGenerated: false,
      kind: "smallint",
      nullable: false,
    },
    true
  ) as AthenaIdentityColumnBuilder<
    number,
    false,
    false,
    false,
    undefined,
    "smallint"
  >;
}

export function integer(): AthenaIdentityColumnBuilder<
  number,
  false,
  false,
  false,
  undefined,
  "integer"
> {
  return createColumnBuilder(
    {
      generationStrategy: { kind: "none" },
      hasDefault: false,
      isGenerated: false,
      kind: "integer",
      nullable: false,
    },
    true
  ) as AthenaIdentityColumnBuilder<
    number,
    false,
    false,
    false,
    undefined,
    "integer"
  >;
}

export function bigint(): AthenaIdentityColumnBuilder<
  string,
  false,
  false,
  false,
  undefined,
  "bigint"
> {
  return createColumnBuilder(
    {
      generationStrategy: { kind: "none" },
      hasDefault: false,
      isGenerated: false,
      kind: "bigint",
      nullable: false,
    },
    true
  ) as AthenaIdentityColumnBuilder<
    string,
    false,
    false,
    false,
    undefined,
    "bigint"
  >;
}

/**
 * Exact decimal / numeric column.
 *
 * Row values are `string` by default so PostgreSQL NUMERIC/DECIMAL precision is
 * preserved at the JS boundary. Use `.precision(n)` / `.scale(n)` (or options)
 * to retain catalog metadata for validation, forms, and schema diffing.
 */
export function decimal(
  options: DecimalColumnOptions = {}
): AthenaColumnBuilder<string, false, false, false, undefined, "decimal"> {
  return createColumnBuilder({
    generationStrategy: { kind: "none" },
    hasDefault: false,
    isGenerated: false,
    kind: "decimal",
    nullable: false,
    ...(options.precision === undefined
      ? {}
      : { precision: assertNonNegativeInt("precision", options.precision) }),
    ...(options.scale === undefined
      ? {}
      : { scale: assertNonNegativeInt("scale", options.scale) }),
  }) as AthenaColumnBuilder<string, false, false, false, undefined, "decimal">;
}

/** Alias of {@link decimal} for PostgreSQL `NUMERIC` naming. */
export const numeric = decimal;

export function boolean(): AthenaColumnBuilder<
  boolean,
  false,
  false,
  false,
  undefined,
  "boolean"
> {
  return createColumnBuilder({
    generationStrategy: { kind: "none" },
    hasDefault: false,
    isGenerated: false,
    kind: "boolean",
    nullable: false,
  }) as AthenaColumnBuilder<boolean, false, false, false, undefined, "boolean">;
}

export function json<TValue = unknown>(
  schema?: ZodType<TValue>
): AthenaColumnBuilder<TValue, false, false, false, undefined, "json"> {
  return createColumnBuilder({
    generationStrategy: { kind: "none" },
    hasDefault: false,
    isGenerated: false,
    jsonSchema: schema,
    kind: "json",
    nullable: false,
  }) as AthenaColumnBuilder<TValue, false, false, false, undefined, "json">;
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
    generationStrategy: { kind: "none" },
    enumValues: values,
    hasDefault: false,
    isGenerated: false,
    kind: "enumeration",
    nullable: false,
  }) as AthenaColumnBuilder<
    TValues[number],
    false,
    false,
    false,
    undefined,
    "enumeration"
  >;
}
