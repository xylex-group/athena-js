import { useMemo } from "react";
import {
  type AthenaReadQueryClient,
  type AthenaReadQueryDefinition,
  type AthenaReadQueryExecutionResult,
  type AthenaReadQueryFlatRow,
  executeAthenaReadQuery,
} from "../query/read-query.ts";
import type { AthenaQueryError, QueryKey, QueryStatus } from "./types.ts";
import { useQuery } from "./use-query.ts";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;

export interface UseAthenaReadQueryOptions {
  /**
   * v3 Athena client (`createClient(...)` or a `withContext` / session-scoped view).
   * Required for fetches when `enabled` is true.
   */
  client?: AthenaReadQueryClient | null;
  enabled?: boolean;
  /** 1-based page (default 1). */
  page?: number;
  /** Page size (default 10). */
  pageSize?: number;
  /** Portable definition (expression columns + aliases). */
  query: AthenaReadQueryDefinition;
  /** Full cache key; when set, overrides the default key composition. */
  queryKey?: QueryKey;
  /** Prepended to the default key when `queryKey` is omitted. */
  queryKeyPrefix?: QueryKey;
  refetchOnMount?: boolean;
  refetchOnReconnect?: boolean;
  refetchOnWindowFocus?: boolean;
  retry?: number | false;
}

export interface UseAthenaReadQueryResult {
  data: AthenaReadQueryExecutionResult | undefined;
  debugAst: AthenaReadQueryExecutionResult["debugAst"];
  error: AthenaQueryError | null;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
  isSuccess: boolean;
  page: number;
  pageSize: number;
  refetch: () => Promise<unknown>;
  reset: () => void;
  rows: AthenaReadQueryFlatRow[];
  status: QueryStatus;
  totalItems: number;
}

function isReadQueryRunnable(query: AthenaReadQueryDefinition): boolean {
  return (
    query.table.trim().length > 0 &&
    query.columns.length > 0 &&
    query.countColumn.trim().length > 0
  );
}

/**
 * Athena-native React hook for {@link AthenaReadQueryDefinition} page reads.
 *
 * Uses `@xylex-group/athena/react` `useQuery` + `AthenaQueryClient` (not TanStack).
 * Does **not** construct clients, open a data proxy, or manage table UI pagination.
 *
 * For HeroUI tables / TanStack / `dataProxy`, use auth-ui `useAthenaQuery` instead.
 *
 * @example
 * ```tsx
 * const athena = createClient({ url, key })
 * // under AthenaQueryClientProvider
 * const { rows, totalItems, isLoading } = useAthenaReadQuery({
 *   client: athena,
 *   page: 1,
 *   pageSize: 20,
 *   query: {
 *     table: 'orders',
 *     countColumn: 'id',
 *     columns: [{ column: 'id', key: 'id' }],
 *   },
 * })
 * ```
 */
export function useAthenaReadQuery({
  client,
  query,
  page = DEFAULT_PAGE,
  pageSize = DEFAULT_PAGE_SIZE,
  enabled = true,
  queryKey,
  queryKeyPrefix,
  refetchOnMount,
  refetchOnWindowFocus,
  refetchOnReconnect,
  retry,
}: UseAthenaReadQueryOptions): UseAthenaReadQueryResult {
  const resolvedPage = page > 0 ? Math.trunc(page) : DEFAULT_PAGE;
  const resolvedPageSize =
    pageSize > 0 ? Math.trunc(pageSize) : DEFAULT_PAGE_SIZE;

  const queryEnabled = enabled && !!client && isReadQueryRunnable(query);

  const defaultQueryKey = useMemo(
    () =>
      [
        "athena",
        "read-query",
        query.mode ?? "findMany",
        query.table,
        query.schema,
        query.columns,
        query.filters,
        query.limit,
        query.orderBy,
        query.rowKey,
        query.countColumn,
        resolvedPage,
        resolvedPageSize,
      ] as const,
    [
      query.columns,
      query.countColumn,
      query.filters,
      query.limit,
      query.mode,
      query.orderBy,
      query.rowKey,
      query.schema,
      query.table,
      resolvedPage,
      resolvedPageSize,
    ]
  );

  const resolvedQueryKey = useMemo((): QueryKey => {
    if (queryKey !== undefined) {
      return queryKey;
    }
    if (queryKeyPrefix !== undefined) {
      const prefix = Array.isArray(queryKeyPrefix)
        ? queryKeyPrefix
        : [queryKeyPrefix];
      return [...prefix, ...defaultQueryKey];
    }
    return defaultQueryKey;
  }, [defaultQueryKey, queryKey, queryKeyPrefix]);

  const result = useQuery<AthenaReadQueryExecutionResult>({
    enabled: queryEnabled,
    queryFn: async () => {
      if (!client) {
        throw new Error("Athena client is required to run the read query.");
      }
      return executeAthenaReadQuery({
        client,
        page: resolvedPage,
        pageSize: resolvedPageSize,
        query,
      });
    },
    queryKey: resolvedQueryKey,
    refetchOnMount,
    refetchOnReconnect,
    refetchOnWindowFocus,
    retry,
  });

  return {
    data: result.data,
    debugAst: result.data?.debugAst,
    error: result.error,
    isError: result.isError,
    isFetching: result.isFetching,
    isLoading: result.isLoading,
    isSuccess: result.isSuccess,
    page: resolvedPage,
    pageSize: resolvedPageSize,
    refetch: result.refetch,
    reset: result.reset,
    rows: result.data?.rows ?? [],
    status: result.status,
    totalItems: result.data?.totalItems ?? 0,
  };
}
