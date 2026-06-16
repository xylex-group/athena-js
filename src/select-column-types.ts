type Whitespace = ' ' | '\n' | '\r' | '\t'

type TrimLeft<TValue extends string> = TValue extends `${Whitespace}${infer TRest}`
  ? TrimLeft<TRest>
  : TValue

type TrimRight<TValue extends string> = TValue extends `${infer TRest}${Whitespace}`
  ? TrimRight<TRest>
  : TValue

type Trim<TValue extends string> = TrimLeft<TrimRight<TValue>>

type KnownSelectColumnKey<Row> = Extract<keyof NonNullable<Row>, string>

type HasKnownSelectColumns<Row> = [KnownSelectColumnKey<Row>] extends [never]
  ? false
  : string extends KnownSelectColumnKey<Row>
    ? false
    : true

type HasComplexSelectTokenSyntax<TValue extends string> =
  TValue extends `${string}(${string}`
    ? true
    : TValue extends `${string})${string}`
      ? true
      : TValue extends `${string}.${string}`
        ? true
        : TValue extends `${string}"${string}`
          ? true
          : TValue extends `${string}'${string}`
            ? true
            : false

type ValidateAliasedBase<Row, TOriginal extends string, TBase extends string> =
  HasComplexSelectTokenSyntax<Trim<TBase>> extends true
    ? TOriginal
    : Trim<TBase> extends KnownSelectColumnKey<Row>
      ? TOriginal
      : never

type ValidateSelectToken<Row, TToken extends string> =
  Trim<TToken> extends infer TTrimmed extends string
    ? TTrimmed extends ''
      ? never
      : TTrimmed extends '*'
        ? TTrimmed
        : TTrimmed extends `${string}:${infer TBase}`
          ? ValidateAliasedBase<Row, TTrimmed, TBase>
          : TTrimmed extends `${infer TBase} as ${string}`
            ? ValidateAliasedBase<Row, TTrimmed, TBase>
            : TTrimmed extends `${infer TBase} AS ${string}`
              ? ValidateAliasedBase<Row, TTrimmed, TBase>
              : HasComplexSelectTokenSyntax<TTrimmed> extends true
                ? TTrimmed
                : TTrimmed extends KnownSelectColumnKey<Row>
                  ? TTrimmed
                  : never
    : never

type ValidateSelectList<Row, TValue extends string> = string extends TValue
  ? TValue
  : HasComplexSelectTokenSyntax<TValue> extends true
    ? TValue
    : TValue extends `${infer THead},${infer TTail}`
      ? ValidateSelectToken<Row, THead> extends never
        ? never
        : ValidateSelectList<Row, TTail> extends never
          ? never
          : TValue
      : ValidateSelectToken<Row, TValue> extends never
        ? never
        : TValue

type ValidateSelectArray<Row, TValue extends readonly string[]> = string extends TValue[number]
  ? TValue
  : TValue extends readonly [
      infer THead extends string,
      ...infer TTail extends readonly string[],
    ]
    ? ValidateSelectToken<Row, THead> extends never
      ? never
      : ValidateSelectArray<Row, TTail> extends never
        ? never
        : TValue
    : TValue

export type AthenaSelectInput = string | string[] | readonly string[]

export type AthenaValidatedSelectInput<Row, TValue extends AthenaSelectInput> =
  HasKnownSelectColumns<Row> extends true
    ? TValue extends string
      ? ValidateSelectList<Row, TValue>
      : TValue extends readonly string[]
        ? ValidateSelectArray<Row, TValue>
        : never
    : TValue

export type AthenaTypecheckedColumnKey<Row, TEnabled extends boolean> = TEnabled extends true
  ? HasKnownSelectColumns<Row> extends true
    ? KnownSelectColumnKey<Row>
    : string
  : string
