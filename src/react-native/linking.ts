import type { AthenaLinkingAdapter } from "./types.ts";

/** No-op linking adapter (default). Apps wrap Expo/RN Linking. */
export function createNoopLinkingAdapter(): AthenaLinkingAdapter {
  return {
    async openUrl() {
      /* intentionally empty */
    },
    async getInitialUrl() {
      return null;
    },
  };
}

export type { AthenaLinkingAdapter };