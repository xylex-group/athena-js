import { useMemo } from 'react'
import type {
  AthenaAuthErrorDetails,
  AthenaAuthFetchCompatibleInput,
  AthenaAuthResult,
  AthenaAuthSessionResponse,
  AthenaAuthCallOptions,
} from '../auth/types.ts'
import type {
  AthenaClientSessionLike,
  AthenaClientSessionOptions,
} from '../client.ts'
import {
  useSession,
  type UseSessionOptions,
  type UseSessionResult,
} from './use-session.ts'

type SessionGetter<TSessionData extends AthenaAuthSessionResponse> = (
  input?: AthenaAuthFetchCompatibleInput,
  options?: AthenaAuthCallOptions,
) => Promise<AthenaAuthResult<TSessionData>>

type AthenaSessionScopedClient<
  TSessionData extends AthenaAuthSessionResponse = AthenaAuthSessionResponse,
> = {
  auth: {
    getSession: SessionGetter<TSessionData>
  }
  withSession(
    session?: AthenaClientSessionLike | null,
    options?: AthenaClientSessionOptions,
  ): unknown
}

type InferSessionData<TClient> =
  TClient extends {
    auth: {
      getSession: (
        ...args: unknown[]
      ) => Promise<AthenaAuthResult<infer TSessionData>>
    }
  }
    ? TSessionData extends AthenaAuthSessionResponse
      ? TSessionData
      : AthenaAuthSessionResponse
    : AthenaAuthSessionResponse

type InferScopedClient<TClient> = TClient extends {
  withSession(
    session?: AthenaClientSessionLike | null,
    options?: AthenaClientSessionOptions,
  ): infer TScopedClient
}
  ? TScopedClient
  : TClient

export type UseAthenaSessionClientOptions = UseSessionOptions

export interface UseAthenaSessionClientResult<
  TClient,
> {
  client: InferScopedClient<TClient>
  session: UseSessionResult<InferSessionData<TClient>>['data']
  userId: string | null
  organizationId: string | null
  error: AthenaAuthErrorDetails | null
  isPending: boolean
  isRefetching: boolean
  refetch: UseSessionResult<InferSessionData<TClient>>['refetch']
}

export function useAthenaSessionClient<
  TClient extends AthenaSessionScopedClient,
>(
  baseClient: TClient,
  options: UseAthenaSessionClientOptions = {},
): UseAthenaSessionClientResult<TClient> {
  const sessionState = useSession(baseClient, options)
  const scopedClient = useMemo(
    () =>
      (sessionState.data
        ? baseClient.withSession(sessionState.data)
        : baseClient) as InferScopedClient<TClient>,
    [baseClient, sessionState.data],
  )
  const session =
    sessionState.data as UseAthenaSessionClientResult<TClient>['session']
  const refetch =
    sessionState.refetch as UseAthenaSessionClientResult<TClient>['refetch']

  return {
    client: scopedClient,
    session,
    userId: sessionState.data?.user.id ?? null,
    organizationId:
      sessionState.data?.session.activeOrganizationId ?? null,
    error: sessionState.error,
    isPending: sessionState.isPending,
    isRefetching: sessionState.isRefetching,
    refetch,
  } as UseAthenaSessionClientResult<TClient>
}
