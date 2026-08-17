import { useMemo } from "react";
import type { AthenaSessionData } from "../auth/session-data.ts";
import type {
  AthenaAuthCallOptions,
  AthenaAuthErrorDetails,
  AthenaAuthFetchCompatibleInput,
  AthenaAuthResult,
  AthenaAuthSessionResponse,
} from "../auth/types.ts";
import type { AthenaRequestContext } from "../v3-client.ts";
import {
  type UseSessionOptions,
  type UseSessionResult,
  useSession,
} from "./use-session.ts";

type SessionGetter = (
  input?: AthenaAuthFetchCompatibleInput,
  options?: AthenaAuthCallOptions
) => Promise<AthenaAuthResult<AthenaAuthSessionResponse>>;

interface AthenaContextScopedClient {
  auth: {
    getSession: SessionGetter;
  };
  withContext: (context: AthenaRequestContext) => unknown;
}

type InferScopedClient<TClient> = TClient extends {
  withContext: (context: AthenaRequestContext) => infer TScopedClient;
}
  ? TScopedClient
  : TClient;

export type UseAthenaSessionClientOptions = UseSessionOptions;

export interface UseAthenaSessionClientResult<TClient> {
  client: InferScopedClient<TClient>;
  error: AthenaAuthErrorDetails | null;
  isPending: boolean;
  isRefetching: boolean;
  organizationId: string | null;
  refetch: UseSessionResult["refetch"];
  session: AthenaSessionData | null;
  userId: string | null;
}

export function useAthenaSessionClient<
  TClient extends AthenaContextScopedClient,
>(
  baseClient: TClient,
  options: UseAthenaSessionClientOptions = {}
): UseAthenaSessionClientResult<TClient> {
  const sessionState = useSession(baseClient, options);
  const scopedClient = useMemo(
    () =>
      (sessionState.data
        ? baseClient.withContext({
            bearerToken: sessionState.data.session.token,
            organizationId: sessionState.data.organization.activeId,
            sessionToken: sessionState.data.session.token,
            userId: sessionState.data.user.id,
          })
        : baseClient) as InferScopedClient<TClient>,
    [baseClient, sessionState.data]
  );

  return {
    client: scopedClient,
    error: sessionState.error,
    isPending: sessionState.isPending,
    isRefetching: sessionState.isRefetching,
    organizationId: sessionState.organizationId,
    refetch: sessionState.refetch,
    session: sessionState.data,
    userId: sessionState.data?.user.id ?? null,
  };
}
