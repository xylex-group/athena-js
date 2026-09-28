import { useCallback } from "react";
import { useSyncExternalStore } from "use-sync-external-store/shim";
import type { AthenaQueryClient } from "../query-client.ts";

export function useQuerySubscription<TData>(
  client: AthenaQueryClient,
  queryKeyToken: string
) {
  const subscribe = useCallback(
    (listener: () => void) => client.subscribeQuery(queryKeyToken, listener),
    [client, queryKeyToken]
  );

  const getSnapshot = useCallback(
    () => client.getQueryState<TData>(queryKeyToken),
    [client, queryKeyToken]
  );

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { snapshot };
}
