import type { AthenaLinkingAdapter } from "./types.ts";

/** No-op linking adapter (default). Apps wrap Expo/RN Linking. */
export function createNoopLinkingAdapter(): AthenaLinkingAdapter {
  return {
    async getInitialUrl() {
      return null;
    },
    async openUrl() {
      /* intentionally empty */
    },
  };
}

export type { AthenaLinkingAdapter };
