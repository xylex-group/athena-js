import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import { useSyncExternalStore } from 'use-sync-external-store/shim'
import type {
  AthenaQueryResult,
  AthenaQueryState,
  UseQueryOptions,
  UseQueryResult,
} from './types.ts'
import { useAthenaQueryClient } from './provider.ts'

type BrowserEventName = 'focus' | 'online'

type BrowserTarget = {
  addEventListener: (event: BrowserEventName, listener: () => void) => void
  removeEventListener: (event: BrowserEventName, listener: () => void) => void
}

function getBrowserTarget(): BrowserTarget | null {
  const maybeGlobal = globalThis as unknown as {
    addEventListener?: unknown
    removeEventListener?: unknown
    window?: unknown
  }

  const hasListeners = (value: unknown): value is BrowserTarget =>
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as BrowserTarget).addEventListener === 'function' &&
    typeof (value as BrowserTarget).removeEventListener === 'function'

  if (hasListeners(maybeGlobal.window)) {
    return maybeGlobal.window
  }

  if (hasListeners(maybeGlobal)) {
    return maybeGlobal
  }

  return null
}

export function useQuery<TQueryFnData, TData = TQueryFnData>(
  options: UseQueryOptions<TQueryFnData, TData>,
): UseQueryResult<TData> {
  const client = useAthenaQueryClient()

  const queryKeyRef = useRef(options.queryKey)
  queryKeyRef.current = options.queryKey

  const queryFnRef = useRef(options.queryFn)
  queryFnRef.current = options.queryFn

  const selectRef = useRef(options.select)
  selectRef.current = options.select

  const onSuccessRef = useRef(options.onSuccess)
  onSuccessRef.current = options.onSuccess

  const onErrorRef = useRef(options.onError)
  onErrorRef.current = options.onError

  const onSettledRef = useRef(options.onSettled)
  onSettledRef.current = options.onSettled

  const enabledRef = useRef(options.enabled ?? true)
  enabledRef.current = options.enabled ?? true

  const retryRef = useRef(options.retry)
  retryRef.current = options.retry

  const retryDelayRef = useRef(options.retryDelay)
  retryDelayRef.current = options.retryDelay

  const initialDataRef = useRef(options.initialData)
  initialDataRef.current = options.initialData

  const refetchOnMountRef = useRef(options.refetchOnMount)
  refetchOnMountRef.current = options.refetchOnMount

  const refetchOnWindowFocusRef = useRef(options.refetchOnWindowFocus)
  refetchOnWindowFocusRef.current = options.refetchOnWindowFocus

  const refetchOnReconnectRef = useRef(options.refetchOnReconnect)
  refetchOnReconnectRef.current = options.refetchOnReconnect

  const queryKeyToken = useMemo(
    () => client.getQueryKeyToken(options.queryKey),
    [client, options.queryKey],
  )

  const subscribe = useCallback(
    (listener: () => void) => client.subscribeQuery(queryKeyToken, listener),
    [client, queryKeyToken],
  )

  const getSnapshot = useCallback(
    () => client.getQueryState<TData>(queryKeyToken),
    [client, queryKeyToken],
  )

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const effectiveSnapshot = useMemo<AthenaQueryState<TData>>(() => {
    if (
      snapshot.status === 'idle' &&
      snapshot.data === undefined &&
      initialDataRef.current !== undefined
    ) {
      return {
        ...snapshot,
        status: 'success',
        data: initialDataRef.current,
        error: null,
      }
    }
    return snapshot
  }, [snapshot])

  const runQuery = useCallback(
    async (force = false): Promise<AthenaQueryResult<TData>> => {
      const result = await client.executeQuery<TQueryFnData, TData>({
        queryKey: queryKeyRef.current,
        queryKeyToken,
        queryFn: () => queryFnRef.current(),
        select: selectRef.current,
        retry:
          retryRef.current ??
          client.defaultQueryOptions.retry ??
          0,
        retryDelay:
          retryDelayRef.current ??
          client.defaultQueryOptions.retryDelay,
        dedupe: true,
        force,
      })

      if (result.error) {
        onErrorRef.current?.(result.error)
        onSettledRef.current?.(result.data, result.error)
        return result
      }

      onSuccessRef.current?.(result.data as TData)
      onSettledRef.current?.(result.data, null)
      return result
    },
    [client, queryKeyToken],
  )

  const lastAutoKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabledRef.current) {
      lastAutoKeyRef.current = queryKeyToken
      return
    }

    const isKeyChange = lastAutoKeyRef.current !== queryKeyToken
    const refetchOnMount =
      refetchOnMountRef.current ?? client.defaultQueryOptions.refetchOnMount ?? true
    const state = client.getQueryState(queryKeyToken)
    const shouldFetch = isKeyChange || state.status === 'idle' || refetchOnMount

    lastAutoKeyRef.current = queryKeyToken

    if (shouldFetch) {
      void runQuery(isKeyChange)
    }
  }, [client, queryKeyToken, runQuery])

  useEffect(() => {
    const browser = getBrowserTarget()
    if (!browser || !enabledRef.current) {
      return undefined
    }

    const refetchOnWindowFocus =
      refetchOnWindowFocusRef.current ??
      client.defaultQueryOptions.refetchOnWindowFocus ??
      false

    if (!refetchOnWindowFocus) {
      return undefined
    }

    const onFocus = () => {
      if (!enabledRef.current) return
      void runQuery(true)
    }

    browser.addEventListener('focus', onFocus)
    return () => {
      browser.removeEventListener('focus', onFocus)
    }
  }, [client, runQuery])

  useEffect(() => {
    const browser = getBrowserTarget()
    if (!browser || !enabledRef.current) {
      return undefined
    }

    const refetchOnReconnect =
      refetchOnReconnectRef.current ??
      client.defaultQueryOptions.refetchOnReconnect ??
      false

    if (!refetchOnReconnect) {
      return undefined
    }

    const onReconnect = () => {
      if (!enabledRef.current) return
      void runQuery(true)
    }

    browser.addEventListener('online', onReconnect)
    return () => {
      browser.removeEventListener('online', onReconnect)
    }
  }, [client, runQuery])

  const refetch = useCallback(() => runQuery(true), [runQuery])

  const reset = useCallback(() => {
    client.resetQuery(queryKeyRef.current)
  }, [client])

  return {
    data: effectiveSnapshot.data,
    error: effectiveSnapshot.error,
    isLoading:
      effectiveSnapshot.status === 'loading' && effectiveSnapshot.data === undefined,
    isFetching: effectiveSnapshot.isFetching,
    isSuccess: effectiveSnapshot.status === 'success',
    isError: effectiveSnapshot.status === 'error',
    status: effectiveSnapshot.status,
    refetch,
    reset,
    lastResponse: effectiveSnapshot.lastResponse,
    lastRequest: effectiveSnapshot.lastRequest,
  }
}
