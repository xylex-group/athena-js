import type {
  AthenaSelectInput,
} from "../../select-column-types.ts";

import type { TableBuilderState } from "../../query/contracts.ts";

export type {
  ConditionCastHints,
  TableBuilderState,
} from "../../query/contracts.ts";

export function cloneTableBuilderState(
  state: TableBuilderState
): TableBuilderState {
  return {
    cacheContext: state.cacheContext,
    conditions: state.conditions.map((condition) => ({ ...condition })),
    currentPage: state.currentPage,
    limit: state.limit,
    model: state.model,
    offset: state.offset,
    order: state.order ? { ...state.order } : undefined,
    pageSize: state.pageSize,
    relations: state.relations?.map((relation) => ({
      ...relation,
      columns: relation.columns ? [...relation.columns] : undefined,
      sourceColumns: relation.sourceColumns
        ? [...relation.sourceColumns]
        : undefined,
      targetColumns: relation.targetColumns
        ? [...relation.targetColumns]
        : undefined,
    })),
    totalPages: state.totalPages,
  };
}

export function collectChangedFields(values: unknown): string[] {
  if (Array.isArray(values)) {
    const keys = new Set<string>();
    for (const value of values) {
      if (value && typeof value === "object") {
        for (const key of Object.keys(value)) {
          keys.add(key);
        }
      }
    }
    return [...keys];
  }
  return values && typeof values === "object"
    ? Object.keys(values)
    : [];
}

export function normalizeSelectColumnsInput(
  columns?: AthenaSelectInput
): string | string[] | undefined {
  if (columns === undefined) {
    return;
  }
  return typeof columns === "string" ? columns : [...columns];
}
