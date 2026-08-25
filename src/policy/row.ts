import {
	normalizeAthenaResourceRef,
	type AthenaResourceRef,
} from "../schema/resource.ts";
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

export function resourceFromModel(model: AnyModelDef): AthenaResourceRef {
  const tableName = model.meta.tableName;
  const fallbackTable = model.meta.model ?? "unknown";
  let table = tableName ?? fallbackTable;
  let schema = model.meta.schema;

  if (tableName?.includes(".")) {
    const parts = tableName.split(".");
    const last = parts.at(-1);
    table = last && last.length > 0 ? last : fallbackTable;
    if (!schema) {
      const first = parts[0];
      if (first && first.length > 0) {
        schema = first;
      }
    }
  }

  return normalizeAthenaResourceRef({
    ...(model.meta.database ? { database: model.meta.database } : {}),
    ...(schema ? { schema } : {}),
    table,
  });
}
