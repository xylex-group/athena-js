import { useCallback, useMemo } from "react";
import {
  projectQuerySnapshot,
  toUseQueryResult,
} from "./internal/query-result.ts";
import { useBrowserRefetch } from "./internal/use-browser-refetch.ts";
import { useLatestRef } from "./internal/use-latest-ref.ts";
import { useQueryAutoFetch } from "./internal/use-query-auto-fetch.ts";
import { useQueryExecutor } from "./internal/use-query-executor.ts";
import { useQuerySubscription } from "./internal/use-query-subscription.ts";
import { useAthenaQueryClient } from "./provider.ts";
import type { UseQueryOptions, UseQueryResult } from "./types.ts";

export function useQuery<TQueryFnData, TData = TQueryFnData>(
  options: UseQueryOptions<TQueryFnData, TData>
): UseQueryResult<TData> {
  const client = useAthenaQueryClient();
  const enabled = options.enabled ?? true;
  const initialDataRef = useLatestRef(options.initialData);
  const queryKeyToken = useMemo(
    () => client.getQueryKeyToken(options.queryKey),
    [client, options.queryKey]
  );
  const queryKeyRef = useLatestRef(options.queryKey);
  const { snapshot } = useQuerySubscription<TData>(client, queryKeyToken);
  const { runQuery } = useQueryExecutor({
    client,
    options,
    queryKeyToken,
  });

  useQueryAutoFetch({
    client,
    enabled,
    queryKeyToken,
    refetchOnMount: options.refetchOnMount,
    runQuery,
  });
  useBrowserRefetch("focus", {
    client,
    enabled,
    option: options.refetchOnWindowFocus,
    runQuery,
  });
  useBrowserRefetch("online", {
    client,
    enabled,
    option: options.refetchOnReconnect,
    runQuery,
  });

  const refetch = useCallback(() => runQuery(true), [runQuery]);
  const reset = useCallback(() => {
    client.resetQuery(queryKeyRef.current);
  }, [client, queryKeyRef]);

  const effectiveSnapshot = useMemo(
    () => projectQuerySnapshot(snapshot, initialDataRef.current),
    [snapshot]
  );

  return toUseQueryResult(effectiveSnapshot, { refetch, reset });
}
