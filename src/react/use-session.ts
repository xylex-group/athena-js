import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AthenaAuthCallOptions,
  AthenaAuthFetchCompatibleInput,
  AthenaAuthErrorCode,
  AthenaAuthErrorDetails,
  AthenaAuthResult,
  AthenaAuthSessionResponse,
  AthenaAuthSdkClient,
} from '../auth/types.ts'

export interface UseSessionOptions {
  enabled?: boolean
  refetchOnMount?: boolean
  fetchInput?: AthenaAuthFetchCompatibleInput
  callOptions?: AthenaAuthCallOptions
}

export interface UseSessionResult {
  data: AthenaAuthSessionResponse | null
  error: AthenaAuthResult<unknown>['errorDetails']
  isPending: boolean
  isRefetching: boolean
  refetch: () => Promise<AthenaAuthSessionResponse | null>
}

/**
 * Better Auth style session hook parity for Athena auth clients.
 */
export function useSession(
  authClient: Pick<AthenaAuthSdkClient, 'getSession'>,
  options: UseSessionOptions = {},
): UseSessionResult {
  const enabled = options.enabled ?? true
  const refetchOnMount = options.refetchOnMount ?? true

  const [data, setData] = useState<AthenaAuthSessionResponse | null>(null)
  const [error, setError] = useState<AthenaAuthResult<unknown>['errorDetails']>(null)
  const [isPending, setIsPending] = useState<boolean>(enabled)
  const [isRefetching, setIsRefetching] = useState<boolean>(false)
  const requestIdRef = useRef(0)
  const mountedRef = useRef(true)
  const dataRef = useRef<AthenaAuthSessionResponse | null>(null)

  useEffect(() => {
    dataRef.current = data
  }, [data])

  const toFallbackErrorDetails = (
    code: AthenaAuthErrorCode,
    message: string,
    status: number,
  ): AthenaAuthErrorDetails => ({
    code,
    message,
    status,
  })

  const runFetch = useCallback(async () => {
    const requestId = ++requestIdRef.current
    const hasData = dataRef.current !== null

    if (hasData) {
      setIsRefetching(true)
    } else {
      setIsPending(true)
    }

    try {
      const result = await authClient.getSession(options.fetchInput, options.callOptions)
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return null
      }

      if (result.ok) {
        setData(result.data ?? null)
        setError(null)
        return result.data ?? null
      }

      setError(
        result.errorDetails ??
          toFallbackErrorDetails(
            'UNKNOWN_ERROR',
            result.error ?? 'Failed to fetch session',
            result.status,
          ),
      )
      return null
    } catch (requestError) {
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return null
      }

      const message =
        requestError instanceof Error ? requestError.message : 'Failed to fetch session'
      setError(toFallbackErrorDetails('NETWORK_ERROR', message, 0))
      return null
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setIsPending(false)
        setIsRefetching(false)
      }
    }
  }, [authClient, options.callOptions, options.fetchInput])

  useEffect(() => {
    mountedRef.current = true
    if (enabled && refetchOnMount) {
      void runFetch()
    } else {
      setIsPending(false)
    }
    return () => {
      mountedRef.current = false
    }
  }, [enabled, refetchOnMount, runFetch])

  const refetch = useCallback(async () => {
    return await runFetch()
  }, [runFetch])

  return {
    data,
    error,
    isPending,
    isRefetching,
    refetch,
  }
}
