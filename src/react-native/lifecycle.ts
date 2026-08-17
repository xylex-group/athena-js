import type { AthenaLifecycleAdapter } from "./types.ts";

/** No-op lifecycle adapter (default). Apps wrap AppState. */
export function createNoopLifecycleAdapter(): AthenaLifecycleAdapter {
  return {
    subscribe() {
      return () => {
        /* unsubscribe no-op */
      };
    },
  };
}

export type { AthenaLifecycleAdapter };