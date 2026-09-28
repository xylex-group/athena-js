import { useCallback, useRef } from "react";
import type { AthenaQueryClient } from "../query-client.ts";
import type { AthenaQueryResult, UseQueryOptions } from "../types.ts";
import { useLatestRef } from "./use-latest-ref.ts";

export function useQueryExecutor<TQueryFnData, TData>(input: {
  client: AthenaQueryClient;
  options: UseQueryOptions<TQueryFnData, TData>;
  queryKeyToken: string;
}) {
  const { client, options, queryKeyToken } = input;
  const queryKeyRef = useLatestRef(options.queryKey);
  const queryFnRef = useLatestRef(options.queryFn);
  const selectRef = useLatestRef(options.select);
  const retryRef = useLatestRef(options.retry);
  const retryDelayRef = useLatestRef(options.retryDelay);
  const onSuccessRef = useLatestRef(options.onSuccess);
  const onErrorRef = useLatestRef(options.onError);
  const onSettledRef = useLatestRef(options.onSettled);
  const cacheModeRef = useLatestRef(options.cacheMode);
  const descriptorRef = useLatestRef(options.descriptor);
  const modelRef = useLatestRef(options.model);
  const activeQueryKeyTokenRef = useRef(queryKeyToken);
  activeQueryKeyTokenRef.current = queryKeyToken;

  const runQuery = useCallback(
    async (force = false): Promise<AthenaQueryResult<TData>> => {
      const result = await client.executeQuery<TQueryFnData, TData>({
        cacheMode: cacheModeRef.current,
        dedupe: true,
        descriptor: descriptorRef.current,
        force,
        model: modelRef.current,
        queryFn: () => queryFnRef.current(),
        queryKey: queryKeyRef.current,
        queryKeyToken,
        retry: retryRef.current ?? client.defaultQueryOptions.retry ?? 0,
        retryDelay:
          retryDelayRef.current ?? client.defaultQueryOptions.retryDelay,
        select: selectRef.current,
      });

      const internalResult = result as AthenaQueryResult<TData> & {
        __applied?: boolean;
      };
      if (
        activeQueryKeyTokenRef.current !== queryKeyToken ||
        internalResult.__applied === false
      ) {
        return result;
      }

      if (result.error) {
        onErrorRef.current?.(result.error);
        onSettledRef.current?.(result.data, result.error);
        return result;
      }

      onSuccessRef.current?.(result.data as TData);
      onSettledRef.current?.(result.data, null);
      return result;
    },
    [client, queryKeyToken]
  );

  return { runQuery };
}
