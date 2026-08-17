import type { AnyModelDef, ModelColumnMetadata } from "../schema/types.ts";
import { columnOperand, type PolicyOperandNode } from "./expr-builders.ts";

export type PolicyRowProxy<TModel> = TModel extends {
  __types?: { row: infer TRow };
}
  ? { readonly [K in Extract<keyof TRow, string>]: PolicyOperandNode }
  : Record<string, PolicyOperandNode>;

function physicalName(
  logical: string,
  columns: Partial<Record<string, ModelColumnMetadata>> | undefined
): string | undefined {
  const meta = columns?.[logical];
  return meta?.columnName;
}

/**
 * Build a static row proxy from AthenaModels metadata (no Proxy required).
 */
export function buildRowProxy<TModel extends AnyModelDef>(
  model: TModel
): PolicyRowProxy<TModel> {
  const columns = model.meta.columns ?? {};
  const keys = new Set<string>([
    ...Object.keys(columns),
    ...Object.keys(model.meta.nullable ?? {}),
    ...(model.meta.primaryKey ?? []),
  ]);

  // Prefer explicit column metadata keys; fall back to primaryKey/nullable.
  const row: Record<string, PolicyOperandNode> = {};
  for (const logical of keys) {
    row[logical] = columnOperand({
      logical,
      physical: physicalName(logical, columns),
    });
  }

  return row as PolicyRowProxy<TModel>;
}

export function resourceFromModel(model: AnyModelDef): {
  database?: string;
  schema?: string;
  table: string;
} {
  const table =
    model.meta.tableName?.includes(".")
      ? model.meta.tableName.split(".").pop()!
      : (model.meta.tableName ?? model.meta.model ?? "unknown");

  let schema = model.meta.schema;
  if (!schema && model.meta.tableName?.includes(".")) {
    schema = model.meta.tableName.split(".")[0];
  }

  return {
    database: model.meta.database,
    schema,
    table,
  };
}
