import type { AthenaModelTarget } from "../schema/types.ts";

export type AthenaModelViewFieldFormat =
  | "text"
  | "datetime"
  | "number"
  | "boolean"
  | "json";

export interface AthenaModelViewField {
  editable?: boolean;
  format?: AthenaModelViewFieldFormat;
  label?: string;
  readonly?: boolean;
  searchable?: boolean;
}

export interface AthenaModelViewDefinition<
  TModel extends AthenaModelTarget = AthenaModelTarget,
> {
  defaultOrder?: { column: string; direction?: "asc" | "desc" };
  defaultProjection?: readonly string[];
  fields?: Record<string, AthenaModelViewField>;
  label: string;
  model: TModel;
  pluralLabel?: string;
  title?: (row: Record<string, unknown>) => string;
}

export type AthenaModelView<
  TModel extends AthenaModelTarget = AthenaModelTarget,
> = Readonly<AthenaModelViewDefinition<TModel>>;

/**
 * Presentation metadata for an AthenaModel. The JS SDK owns the definition;
 * Auth UI / tables / forms consume it. This is not a second query language.
 */
export function defineModelView<TModel extends AthenaModelTarget>(
  model: TModel,
  definition: Omit<AthenaModelViewDefinition<TModel>, "model">
): AthenaModelView<TModel> {
  return Object.freeze({
    ...definition,
    defaultProjection: definition.defaultProjection
      ? Object.freeze([...definition.defaultProjection])
      : undefined,
    fields: definition.fields
      ? Object.freeze({ ...definition.fields })
      : undefined,
    model,
  });
}
