/**
 * EXAMPLE: Session-scoped Athena client for React.
 *
 * When a session is present, `client` is `baseClient.withContext({ userId,
 * organizationId, sessionToken, bearerToken })` so queries inherit identity.
 * When signed out, `client` is the base client (no silent empty context).
 *
 * ```tsx
 * const { client, isPending, userId } = useAthenaSessionClient(athena)
 * const rows = await client.from('notes').eq('user_id', userId).select()
 * ```
 */

import type { AthenaRequestContext } from "@xylex-group/athena";
import {
  type UseAthenaSessionClientOptions,
  type UseAthenaSessionClientResult,
  useAthenaSessionClient,
} from "@xylex-group/athena/react";
import type { ReactElement } from "react";

/** Minimal shape required by the hook (createClient result). */
export interface ExampleSessionScopedBaseClient {
  auth: {
    getSession: NonNullable<
      Parameters<typeof useAthenaSessionClient>[0]["auth"]["getSession"]
    >;
  };
  withContext: (context: AthenaRequestContext) => unknown;
}

export interface SessionScopedClientPanelProps<
  TClient extends ExampleSessionScopedBaseClient,
> {
  baseClient: TClient;
  children?: (
    state: UseAthenaSessionClientResult<TClient>
  ) => ReactElement | null;
  options?: UseAthenaSessionClientOptions;
}

export function SessionScopedClientPanel<
  TClient extends ExampleSessionScopedBaseClient,
>(props: SessionScopedClientPanelProps<TClient>): ReactElement | null {
  const state = useAthenaSessionClient(
    props.baseClient as Parameters<typeof useAthenaSessionClient>[0],
    props.options
  ) as UseAthenaSessionClientResult<TClient>;

  if (props.children) {
    return props.children(state);
  }

  if (state.isPending) {
    return <p data-testid="scoped-pending">Resolving session client…</p>;
  }

  if (state.error) {
    return (
      <p data-testid="scoped-error" role="alert">
        {state.error.message}
      </p>
    );
  }

  return (
    <div data-testid="scoped-ready">
      <p data-testid="scoped-user-id">{state.userId ?? "anonymous"}</p>
      <p data-testid="scoped-org-id">{state.organizationId ?? "—"}</p>
      <p data-testid="scoped-has-session">{state.session ? "yes" : "no"}</p>
    </div>
  );
}

export function useExampleAthenaSessionClient<
  TClient extends ExampleSessionScopedBaseClient,
>(
  baseClient: TClient,
  options?: UseAthenaSessionClientOptions
): UseAthenaSessionClientResult<TClient> {
  return useAthenaSessionClient(
    baseClient as Parameters<typeof useAthenaSessionClient>[0],
    options
  ) as UseAthenaSessionClientResult<TClient>;
}
