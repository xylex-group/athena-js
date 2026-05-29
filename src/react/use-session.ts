import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AthenaAuthCallOptions,
  AthenaAuthErrorCode,
  AthenaAuthErrorDetails,
  AthenaAuthFetchCompatibleInput,
  AthenaAuthResult,
  AthenaAuthSessionResponse,
} from '../auth/types.ts'

export interface UseSessionOptions {
  enabled?: boolean
  refetchOnMount?: boolean
  fetchInput?: AthenaAuthFetchCompatibleInput
  callOptions?: AthenaAuthCallOptions
}

export interface UseSessionResult<
  TSessionData extends AthenaAuthSessionResponse = AthenaAuthSessionResponse,
> {
  data: TSessionData | null
  error: AthenaAuthErrorDetails | null
  isPending: boolean
  isRefetching: boolean
  refetch: () => Promise<TSessionData | null>
}

type SessionGetter<TSessionData extends AthenaAuthSessionResponse> = (
  input?: AthenaAuthFetchCompatibleInput,
  options?: AthenaAuthCallOptions,
) => Promise<AthenaAuthResult<TSessionData>>

type UseSessionAuthClient<
  TSessionData extends AthenaAuthSessionResponse = AthenaAuthSessionResponse,
> =
  | { getSession: SessionGetter<TSessionData> }
  | { auth: { getSession: SessionGetter<TSessionData> } }

type InferSessionData<TClient> =
  TClient extends { getSession: (...args: unknown[]) => Promise<AthenaAuthResult<infer TSessionData>> }
    ? TSessionData extends AthenaAuthSessionResponse
      ? TSessionData
      : AthenaAuthSessionResponse
    : TClient extends {
        auth: { getSession: (...args: unknown[]) => Promise<AthenaAuthResult<infer TSessionData>> }
      }
      ? TSessionData extends AthenaAuthSessionResponse
        ? TSessionData
        : AthenaAuthSessionResponse
      : AthenaAuthSessionResponse

function resolveGetSession<TSessionData extends AthenaAuthSessionResponse>(
  authClient: UseSessionAuthClient<TSessionData>,
): SessionGetter<TSessionData> {
  if ('getSession' in authClient && typeof authClient.getSession === 'function') {
    return authClient.getSession
  }

  if (
    'auth' in authClient &&
    authClient.auth &&
    typeof authClient.auth.getSession === 'function'
  ) {
    return authClient.auth.getSession
  }

  throw new Error('useSession requires an auth-capable client (createClient(...).auth or createAuthClient(...))')
}

/**
 * Better Auth style session hook parity for Athena auth clients.
 */
export function useSession<TClient extends UseSessionAuthClient>(
  authClient: TClient,
  options: UseSessionOptions = {},
): UseSessionResult<InferSessionData<TClient>> {
  type SessionData = InferSessionData<TClient>
  const enabled = options.enabled ?? true
  const refetchOnMount = options.refetchOnMount ?? true

  const [data, setData] = useState<SessionData | null>(null)
  const [error, setError] = useState<AthenaAuthErrorDetails | null>(null)
  const [isPending, setIsPending] = useState<boolean>(enabled)
  const [isRefetching, setIsRefetching] = useState<boolean>(false)
  const requestIdRef = useRef(0)
  const mountedRef = useRef(true)
  const dataRef = useRef<SessionData | null>(null)
  const getSession = resolveGetSession<SessionData>(
    authClient as UseSessionAuthClient<SessionData>,
  )

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
      const result = await getSession(options.fetchInput, options.callOptions)
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return null
      }

      if (result.ok) {
        setData((result.data ?? null) as SessionData | null)
        setError(null)
        return (result.data ?? null) as SessionData | null
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
  }, [getSession, options.callOptions, options.fetchInput])

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
