type Whitespace = " " | "\n" | "\r" | "\t";

type TrimLeft<TValue extends string> =
  TValue extends `${Whitespace}${infer TRest}` ? TrimLeft<TRest> : TValue;

type TrimRight<TValue extends string> =
  TValue extends `${infer TRest}${Whitespace}` ? TrimRight<TRest> : TValue;

type Trim<TValue extends string> = TrimLeft<TrimRight<TValue>>;

/** Known string keys of a row / model type (empty when the shape is untyped). */
export type AthenaColumnKey<Row> = Extract<keyof NonNullable<Row>, string>;

type KnownSelectColumnKey<Row> = AthenaColumnKey<Row>;

export type HasKnownSelectColumns<Row> = [KnownSelectColumnKey<Row>] extends [
  never,
]
  ? false
  : string extends KnownSelectColumnKey<Row>
    ? false
    : true;

/**
 * Prefer this over bare `string` for column parameters when row keys are known.
 * `Keys | (string & {})` keeps full string assignability while giving IDEs
 * completion for the known keys (the classic “autocomplete without sealing” pattern).
 */
export type AthenaColumnKeyWithAutocomplete<Row> =
  HasKnownSelectColumns<Row> extends true
    ? KnownSelectColumnKey<Row> | (string & {})
    : string;

/**
 * Strict column key when keys are known; otherwise `string`.
 * Used for filters / order when unknown columns should be rejected.
 */
export type AthenaResolvedColumnKey<Row> =
  HasKnownSelectColumns<Row> extends true ? KnownSelectColumnKey<Row> : string;

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
            : false;

type ValidateAliasedBase<Row, TOriginal extends string, TBase extends string> =
  HasComplexSelectTokenSyntax<Trim<TBase>> extends true
    ? TOriginal
    : Trim<TBase> extends KnownSelectColumnKey<Row>
      ? TOriginal
      : never;

type ValidateSelectToken<Row, TToken extends string> =
  Trim<TToken> extends infer TTrimmed extends string
    ? TTrimmed extends ""
      ? never
      : TTrimmed extends "*"
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
    : never;

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
        : TValue;

/**
 * Preferred element type for typed array selects.
 * Contextual typing validates each array-literal element against known keys
 * (no `as const` required) and powers IntelliSense on each slot.
 */
export type AthenaSelectArrayElement<Row> =
  HasKnownSelectColumns<Row> extends true
    ? KnownSelectColumnKey<Row> | "*"
    : string;

/**
 * IDE-friendly select input when row keys are known.
 * Suggests column names for both string and array forms while still allowing
 * free-form comma lists / expressions via `(string & {})`.
 */
export type AthenaSelectInputHints<Row> =
  | AthenaSelectArrayElement<Row>
  | readonly AthenaSelectArrayElement<Row>[]
  | (string & {});

export type AthenaSelectInput = string | string[] | readonly string[];

/**
 * Compile-time validation for `select` / `single` / `maybeSingle` when
 * row keys are known.
 *
 * - Comma-separated strings: validates each simple token (aliases / relation
 *   syntax are allowed through).
 * - Arrays: always `readonly (keyof Row | '*')[]` for element IntelliSense and
 *   checking without `as const`.
 */
export type AthenaValidatedSelectInput<Row, TValue extends AthenaSelectInput> =
  HasKnownSelectColumns<Row> extends true
    ? TValue extends readonly string[]
      ? readonly AthenaSelectArrayElement<Row>[]
      : TValue extends string
        ? ValidateSelectList<Row, TValue>
        : never
    : TValue;

/**
 * Select column parameter typing with IDE autocomplete whenever row keys are known.
 * Prefer using the client `select`/`single` APIs; this alias documents the rules:
 *
 * - **Arrays** (typed row): `readonly (keyof Row | '*')[]` — IntelliSense per element.
 * - **Strings**: validates comma-separated tokens when they are literals.
 */
export type AthenaSelectColumnsFor<Row, TValue extends AthenaSelectInput> =
  HasKnownSelectColumns<Row> extends true
    ? TValue extends readonly string[]
      ? readonly AthenaSelectArrayElement<Row>[]
      : AthenaValidatedSelectInput<Row, TValue>
    : TValue;

/**
 * Filter / order / RPC column parameter. Known model keys are closed; dynamic
 * rows retain free-form string support.
 */
export type AthenaTypecheckedColumnKey<Row> =
  HasKnownSelectColumns<Row> extends true ? KnownSelectColumnKey<Row> : string;
