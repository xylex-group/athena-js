/**
 * Deprecated table-oriented read-query names.
 *
 * The canonical implementation lives in `read-query.ts`; this module keeps
 * legacy public names as an explicit compatibility projection.
 */

import type {
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
import {
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
} from "./read-query.ts";

/** @deprecated Prefer {@link AthenaReadQueryMode}. */
export type AthenaTableQueryMode = AthenaReadQueryMode;
/** @deprecated Prefer {@link AthenaReadQueryFilterOperator}. */
export type AthenaTableFilterOperator = AthenaReadQueryFilterOperator;
/** @deprecated Prefer {@link AthenaReadQueryOrderDirection}. */
export type AthenaTableOrderDirection = AthenaReadQueryOrderDirection;
/** @deprecated Prefer {@link AthenaReadQueryRelationRef}. */
export type AthenaTableRelationRef = AthenaReadQueryRelationRef;
/** @deprecated Prefer {@link AthenaReadQueryColumn}. */
export type AthenaTableQueryColumn = AthenaReadQueryColumn;
/** @deprecated Prefer {@link AthenaReadQueryFilterValue}. */
export type AthenaTableFilterValue = AthenaReadQueryFilterValue;
/** @deprecated Prefer {@link AthenaReadQueryFilter}. */
export type AthenaTableFilter = AthenaReadQueryFilter;
/** @deprecated Prefer {@link AthenaReadQueryOrder}. */
export type AthenaTableOrder = AthenaReadQueryOrder;
/** @deprecated Prefer {@link AthenaReadQueryOrderByInput}. */
export type AthenaTableOrderByInput = AthenaReadQueryOrderByInput;
/** @deprecated Prefer {@link AthenaReadQueryDefinition}. */
export type AthenaTableQueryDefinition = AthenaReadQueryDefinition;
/** @deprecated Prefer {@link AthenaReadQueryFlatRow}. */
export type AthenaTableFlatRow = AthenaReadQueryFlatRow;
/** @deprecated Prefer {@link AthenaReadQueryClient}. */
export type AthenaTableQueryClient = AthenaReadQueryClient;
/** @deprecated Prefer {@link AthenaReadQueryExecutionInput}. */
export type AthenaTableQueryExecutionInput = AthenaReadQueryExecutionInput;
/** @deprecated Prefer {@link AthenaReadQueryExecutionResult}. */
export type AthenaTableQueryExecutionResult = AthenaReadQueryExecutionResult;

/** @deprecated Prefer {@link flattenAthenaReadQueryRows}. */
export const flattenAthenaRows = flattenAthenaReadQueryRows;
/** @deprecated Prefer {@link buildAthenaReadQuerySelectString}. */
export const buildAthenaTableSelectString = buildAthenaReadQuerySelectString;
/** @deprecated Prefer {@link buildAthenaReadQueryFindManySelect}. */
export const buildAthenaTableFindManySelect =
  buildAthenaReadQueryFindManySelect;
/** @deprecated Prefer {@link buildAthenaReadQueryFindManyWhere}. */
export const buildAthenaTableFindManyWhere = buildAthenaReadQueryFindManyWhere;
/** @deprecated Prefer {@link buildAthenaReadQueryFindManyOrderBy}. */
export const buildAthenaTableFindManyOrderBy =
  buildAthenaReadQueryFindManyOrderBy;
/** @deprecated Prefer {@link normalizeAthenaReadQueryOrderBy}. */
export const normalizeAthenaTableOrderBy = normalizeAthenaReadQueryOrderBy;
/** @deprecated Prefer {@link applyAthenaReadQueryFilters}. */
export const applyAthenaTableFilters = applyAthenaReadQueryFilters;
/** @deprecated Prefer {@link applyAthenaReadQuerySelectOrder}. */
export const applyAthenaTableSelectOrder = applyAthenaReadQuerySelectOrder;
/** @deprecated Prefer {@link applyAthenaReadQuerySelectLimit}. */
export const applyAthenaTableSelectLimit = applyAthenaReadQuerySelectLimit;
/** @deprecated Prefer {@link clampAthenaReadQueryTotalItems}. */
export const clampAthenaTableTotalItems = clampAthenaReadQueryTotalItems;
/** @deprecated Prefer {@link executeAthenaReadQuery}. */
export const executeAthenaTableQuery = executeAthenaReadQuery;
