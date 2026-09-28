import { useCallback, useMemo } from "react";
import { useSyncExternalStore } from "use-sync-external-store/shim";
import { useLatestRef } from "./internal/use-latest-ref.ts";
import { useAthenaQueryClient } from "./provider.ts";
import type { UseMutationOptions, UseMutationResult } from "./types.ts";

export function useMutation<
  TVariables,
  TMutationFnData,
  TData = TMutationFnData,
>(
  options: UseMutationOptions<TVariables, TMutationFnData, TData>
): UseMutationResult<TVariables, TData> {
  const client = useAthenaQueryClient();
  const mutationKeyRef = useLatestRef(options.mutationKey);
  const mutationFnRef = useLatestRef(options.mutationFn);
  const selectRef = useLatestRef(options.select);
  const retryRef = useLatestRef(options.retry);
  const retryDelayRef = useLatestRef(options.retryDelay);
  const onMutateRef = useLatestRef(options.onMutate);
  const onSuccessRef = useLatestRef(options.onSuccess);
  const onErrorRef = useLatestRef(options.onError);
  const onSettledRef = useLatestRef(options.onSettled);

  const mutationKeyToken = useMemo(
    () => client.getMutationKeyToken(options.mutationKey),
    [client, options.mutationKey]
  );

  const subscribe = useCallback(
    (listener: () => void) =>
      client.subscribeMutation(mutationKeyToken, listener),
    [client, mutationKeyToken]
  );

  const getSnapshot = useCallback(
    () => client.getMutationState<TVariables, TData>(mutationKeyToken),
    [client, mutationKeyToken]
  );

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const mutateAsync = useCallback(
    async (variables: TVariables): Promise<TData> => {
      const rollback = await onMutateRef.current?.(variables);

      const result = await client.executeMutation<
        TVariables,
        TMutationFnData,
        TData
      >({
        mutationFn: (currentVariables) =>
          mutationFnRef.current(currentVariables),
        mutationKey: mutationKeyRef.current,
        mutationKeyToken,
        retry: retryRef.current ?? client.defaultMutationOptions.retry ?? 0,
        retryDelay:
          retryDelayRef.current ?? client.defaultMutationOptions.retryDelay,
        select: selectRef.current,
        variables,
      });

      if (result.error) {
        await rollback?.();
        onErrorRef.current?.(result.error, variables);
        onSettledRef.current?.(result.data, result.error, variables);
        throw result.error;
      }

      const data = result.data as TData;
      onSuccessRef.current?.(data, variables);
      onSettledRef.current?.(data, null, variables);
      return data;
    },
    [client, mutationKeyToken]
  );

  const mutate = useCallback(
    (variables: TVariables) => {
      void mutateAsync(variables).catch(() => undefined);
    },
    [mutateAsync]
  );

  const reset = useCallback(() => {
    client.resetMutation(mutationKeyRef.current);
  }, [client, mutationKeyRef]);

  return {
    data: snapshot.data,
    error: snapshot.error,
    isError: snapshot.status === "error",
    isIdle: snapshot.status === "idle",
    isLoading: snapshot.status === "loading",
    isSuccess: snapshot.status === "success",
    lastRequest: snapshot.lastRequest,
    lastResponse: snapshot.lastResponse,
    lastVariables: snapshot.lastVariables,
    mutate,
    mutateAsync,
    reset,
    status: snapshot.status,
  };
}
