import type { AnyModelDef, InsertOf, RowOf, UpdateOf } from './types.ts'

type ModelValueRecord = Record<string, unknown>

export type ModelFormNullishMode = 'empty-string' | 'undefined' | 'null'

type NullishValueByMode = {
  'empty-string': ''
  undefined: undefined
  null: null
}

type MapNullableToFormValue<TField, TMode extends ModelFormNullishMode> =
  null extends TField
    ? Exclude<TField, null> | NullishValueByMode[TMode]
    : TField

/**
 * Form value shape derived from a model insert payload.
 * Nullable fields are remapped to the selected nullish representation.
 */
export type ModelFormValues<
  TModel extends AnyModelDef,
  TMode extends ModelFormNullishMode = 'empty-string',
> = {
  [K in keyof InsertOf<TModel>]: MapNullableToFormValue<InsertOf<TModel>[K], TMode>
}

/**
 * Alias for deriving form value types from any model contract.
 */
export type FormValuesOf<
  TModel extends AnyModelDef,
  TMode extends ModelFormNullishMode = 'empty-string',
> = ModelFormValues<TModel, TMode>

/**
 * Default value shape for form initialization.
 */
export type ModelFormDefaults<
  TModel extends AnyModelDef,
  TMode extends ModelFormNullishMode = 'empty-string',
> = Partial<ModelFormValues<TModel, TMode>>

export interface ToModelFormDefaultsOptions<TMode extends ModelFormNullishMode = 'empty-string'> {
  /**
   * Controls how nullable model values are represented in form defaults.
   * - `empty-string` (default): `null -> ""`
   * - `undefined`: `null -> undefined`
   * - `null`: keeps `null`
   */
  nullishMode?: TMode
}

export interface ToModelPayloadOptions {
  /**
   * Converts `""` into `null` for nullable model fields.
   * Defaults to `true`.
   */
  emptyStringAsNull?: boolean
  /**
   * Omits `undefined` keys from the outgoing payload.
   * Defaults to `true`.
   */
  stripUndefined?: boolean
}

function resolveNullishValue(mode: ModelFormNullishMode): '' | undefined | null {
  if (mode === 'undefined') return undefined
  if (mode === 'null') return null
  return ''
}

function isRecord(value: unknown): value is ModelValueRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNullableColumn(model: AnyModelDef, key: string): boolean {
  const nullable = model.meta.nullable as Partial<Record<string, boolean>> | undefined
  return nullable?.[key] === true
}

/**
 * Normalizes model data into form-safe defaults using model nullability metadata.
 */
export function toModelFormDefaults<
  TModel extends AnyModelDef,
  TMode extends ModelFormNullishMode = 'empty-string',
>(
  model: TModel,
  values?: Partial<RowOf<TModel>> | Partial<InsertOf<TModel>> | null,
  options?: ToModelFormDefaultsOptions<TMode>,
): ModelFormDefaults<TModel, TMode> {
  const source = values as ModelValueRecord | null | undefined
  if (!isRecord(source)) {
    return {} as ModelFormDefaults<TModel, TMode>
  }

  const mode = options?.nullishMode ?? ('empty-string' as TMode)
  const nullishValue = resolveNullishValue(mode)
  const result: ModelValueRecord = {}

  for (const [key, value] of Object.entries(source)) {
    if (value === null && isNullableColumn(model, key)) {
      result[key] = nullishValue
      continue
    }
    result[key] = value
  }

  return result as ModelFormDefaults<TModel, TMode>
}

/**
 * Normalizes form values back into model-compatible insert/update payloads.
 */
export function toModelPayload<TModel extends AnyModelDef>(
  model: TModel,
  formValues: Partial<ModelFormValues<TModel, 'empty-string' | 'undefined' | 'null'>>,
  options?: ToModelPayloadOptions,
): Partial<InsertOf<TModel>> {
  const emptyStringAsNull = options?.emptyStringAsNull ?? true
  const stripUndefined = options?.stripUndefined ?? true
  const result: ModelValueRecord = {}

  for (const [key, rawValue] of Object.entries(formValues as ModelValueRecord)) {
    if (rawValue === undefined && stripUndefined) {
      continue
    }

    if (emptyStringAsNull && rawValue === '' && isNullableColumn(model, key)) {
      result[key] = null
      continue
    }

    result[key] = rawValue
  }

  return result as Partial<InsertOf<TModel>>
}

/**
 * Runtime form adapter bound to a model contract.
 */
export interface ModelFormAdapter<TModel extends AnyModelDef> {
  model: TModel
  toDefaults<TMode extends ModelFormNullishMode = 'empty-string'>(
    values?: Partial<RowOf<TModel>> | Partial<InsertOf<TModel>> | null,
    options?: ToModelFormDefaultsOptions<TMode>,
  ): ModelFormDefaults<TModel, TMode>
  toInsert(
    values: Partial<ModelFormValues<TModel, 'empty-string' | 'undefined' | 'null'>>,
    options?: ToModelPayloadOptions,
  ): Partial<InsertOf<TModel>>
  toUpdate(
    values: Partial<ModelFormValues<TModel, 'empty-string' | 'undefined' | 'null'>>,
    options?: ToModelPayloadOptions,
  ): Partial<UpdateOf<TModel>>
}

/**
 * Creates a small model-aware adapter for form defaults and payload normalization.
 */
export function createModelFormAdapter<TModel extends AnyModelDef>(model: TModel): ModelFormAdapter<TModel> {
  return {
    model,
    toDefaults(values, options) {
      return toModelFormDefaults(model, values, options)
    },
    toInsert(values, options) {
      return toModelPayload(model, values, options) as Partial<InsertOf<TModel>>
    },
    toUpdate(values, options) {
      return toModelPayload(model, values, options) as Partial<UpdateOf<TModel>>
    },
  }
}
