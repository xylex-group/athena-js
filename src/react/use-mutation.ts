import { useCallback, useMemo, useRef } from 'react'
import { useSyncExternalStore } from 'use-sync-external-store/shim'
import type {
  UseMutationOptions,
  UseMutationResult,
} from './types.ts'
import { useAthenaQueryClient } from './provider.ts'

export function useMutation<TVariables, TMutationFnData, TData = TMutationFnData>(
  options: UseMutationOptions<TVariables, TMutationFnData, TData>,
): UseMutationResult<TVariables, TData> {
  const client = useAthenaQueryClient()

  const mutationKeyRef = useRef(options.mutationKey)
  mutationKeyRef.current = options.mutationKey

  const mutationFnRef = useRef(options.mutationFn)
  mutationFnRef.current = options.mutationFn

  const selectRef = useRef(options.select)
  selectRef.current = options.select

  const retryRef = useRef(options.retry)
  retryRef.current = options.retry

  const retryDelayRef = useRef(options.retryDelay)
  retryDelayRef.current = options.retryDelay

  const onMutateRef = useRef(options.onMutate)
  onMutateRef.current = options.onMutate

  const onSuccessRef = useRef(options.onSuccess)
  onSuccessRef.current = options.onSuccess

  const onErrorRef = useRef(options.onError)
  onErrorRef.current = options.onError

  const onSettledRef = useRef(options.onSettled)
  onSettledRef.current = options.onSettled

  const mutationKeyToken = useMemo(
    () => client.getMutationKeyToken(options.mutationKey),
    [client, options.mutationKey],
  )

  const subscribe = useCallback(
    (listener: () => void) => client.subscribeMutation(mutationKeyToken, listener),
    [client, mutationKeyToken],
  )

  const getSnapshot = useCallback(
    () => client.getMutationState<TVariables, TData>(mutationKeyToken),
    [client, mutationKeyToken],
  )

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const mutateAsync = useCallback(
    async (variables: TVariables): Promise<TData> => {
      await onMutateRef.current?.(variables)

      const result = await client.executeMutation<TVariables, TMutationFnData, TData>({
        mutationKey: mutationKeyRef.current,
        mutationKeyToken,
        variables,
        mutationFn: currentVariables => mutationFnRef.current(currentVariables),
        select: selectRef.current,
        retry:
          retryRef.current ??
          client.defaultMutationOptions.retry ??
          0,
        retryDelay:
          retryDelayRef.current ??
          client.defaultMutationOptions.retryDelay,
      })

      if (result.error) {
        onErrorRef.current?.(result.error, variables)
        onSettledRef.current?.(result.data, result.error, variables)
        throw result.error
      }

      const data = result.data as TData
      onSuccessRef.current?.(data, variables)
      onSettledRef.current?.(data, null, variables)
      return data
    },
    [client, mutationKeyToken],
  )

  const mutate = useCallback(
    (variables: TVariables) => {
      void mutateAsync(variables).catch(() => undefined)
    },
    [mutateAsync],
  )

  const reset = useCallback(() => {
    client.resetMutation(mutationKeyRef.current)
  }, [client])

  return {
    mutate,
    mutateAsync,
    data: snapshot.data,
    error: snapshot.error,
    isIdle: snapshot.status === 'idle',
    isLoading: snapshot.status === 'loading',
    isSuccess: snapshot.status === 'success',
    isError: snapshot.status === 'error',
    status: snapshot.status,
    reset,
    lastResponse: snapshot.lastResponse,
    lastVariables: snapshot.lastVariables,
    lastRequest: snapshot.lastRequest,
  }
}
