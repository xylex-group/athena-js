import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
import {
  type AthenaQueryClient,
  createAthenaQueryClient,
} from "./query-client.ts";
import type { AthenaQueryClientConfig } from "./types.ts";

const AthenaQueryClientContext = createContext<AthenaQueryClient | null>(null);

export interface AthenaQueryClientProviderProps {
  children: ReactNode;
  client?: AthenaQueryClient;
  config?: AthenaQueryClientConfig;
}

export function AthenaQueryClientProvider(
  props: AthenaQueryClientProviderProps
) {
  const memoizedClient = useMemo(() => {
    if (props.client) {
      return props.client;
    }
    return createAthenaQueryClient(props.config);
  }, [props.client, props.config]);

  return createElement(
    AthenaQueryClientContext.Provider,
    { value: memoizedClient },
    props.children
  );
}

export function useAthenaQueryClient(): AthenaQueryClient {
  const client = useContext(AthenaQueryClientContext);
  if (!client) {
    throw new Error(
      "No AthenaQueryClient found. Wrap your component tree with AthenaQueryClientProvider."
    );
  }
  return client;
}

export { AthenaQueryClientContext };
