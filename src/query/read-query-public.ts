/**
 * Public read-query projection shared by the root and browser barrels.
 *
 * Canonical names and deprecated table names intentionally remain separate
 * inside this projection so runtime entrypoints converge without widening the
 * implementation module.
 */

export type {
  AthenaReadQueryClient,
  AthenaReadQueryColumn,
  AthenaReadQueryDefinition,
  AthenaReadQueryExecutionInput,
  AthenaReadQueryExecutionResult,
  AthenaReadQueryFilter,
  AthenaReadQueryFilterOperator,
  AthenaReadQueryFilterValue,
  AthenaReadQueryFlatRow,
  AthenaReadQueryMode,
  AthenaReadQueryOrder,
  AthenaReadQueryOrderByInput,
  AthenaReadQueryOrderDirection,
  AthenaReadQueryRelationRef,
} from "./read-query.ts";
export {
  applyAthenaReadQueryFilters,
  applyAthenaReadQuerySelectLimit,
  applyAthenaReadQuerySelectOrder,
  buildAthenaReadQueryFindManyOrderBy,
  buildAthenaReadQueryFindManySelect,
  buildAthenaReadQueryFindManyWhere,
  buildAthenaReadQuerySelectString,
  clampAthenaReadQueryTotalItems,
  executeAthenaReadQuery,
  flattenAthenaReadQueryRows,
  normalizeAthenaReadQueryOrderBy,
  resolveAthenaReadQueryPageFetch,
} from "./read-query.ts";
export type {
  AthenaTableFilter,
  AthenaTableFilterOperator,
  AthenaTableFilterValue,
  AthenaTableFlatRow,
  AthenaTableOrder,
  AthenaTableOrderByInput,
  AthenaTableOrderDirection,
  AthenaTableQueryClient,
  AthenaTableQueryColumn,
  AthenaTableQueryDefinition,
  AthenaTableQueryExecutionInput,
  AthenaTableQueryExecutionResult,
  AthenaTableQueryMode,
  AthenaTableRelationRef,
} from "./read-query-compat.ts";
export {
  applyAthenaTableFilters,
  applyAthenaTableSelectLimit,
  applyAthenaTableSelectOrder,
  buildAthenaTableFindManyOrderBy,
  buildAthenaTableFindManySelect,
  buildAthenaTableFindManyWhere,
  buildAthenaTableSelectString,
  clampAthenaTableTotalItems,
  executeAthenaTableQuery,
  flattenAthenaRows,
  normalizeAthenaTableOrderBy,
} from "./read-query-compat.ts";
