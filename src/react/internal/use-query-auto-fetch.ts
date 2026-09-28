import { useEffect, useRef } from "react";
import type { AthenaQueryClient } from "../query-client.ts";
import type { AthenaQueryResult } from "../types.ts";

export function useQueryAutoFetch(input: {
  client: AthenaQueryClient;
  enabled: boolean;
  queryKeyToken: string;
  refetchOnMount: boolean | undefined;
  runQuery: (force?: boolean) => Promise<AthenaQueryResult<unknown>>;
}) {
  const { client, enabled, queryKeyToken, refetchOnMount, runQuery } = input;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const refetchOnMountRef = useRef(refetchOnMount);
  refetchOnMountRef.current = refetchOnMount;
  const lastAutoKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const shouldRefetchOnMount =
      refetchOnMountRef.current ??
      client.defaultQueryOptions.refetchOnMount ??
      true;

    const isFirstRenderForKey = lastAutoKeyRef.current !== queryKeyToken;
    lastAutoKeyRef.current = queryKeyToken;

    if (!enabledRef.current) {
      return;
    }

    const state = client.getQueryState(queryKeyToken);
    const shouldFetch =
      state.status === "idle" || (isFirstRenderForKey && shouldRefetchOnMount);

    if (shouldFetch) {
      void runQuery(false);
    }
  }, [client, queryKeyToken, runQuery]);
}
