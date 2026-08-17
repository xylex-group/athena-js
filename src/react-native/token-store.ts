import type { AthenaTokenStore } from "./types.ts";

/** In-memory token store for tests and non-persistent sessions. */
export function createMemoryTokenStore(
  initial?: {
    accessToken?: string | null;
    sessionToken?: string | null;
  },
): AthenaTokenStore {
  let accessToken = initial?.accessToken ?? null;
  let sessionToken = initial?.sessionToken ?? null;
  return {
    async getAccessToken() {
      return accessToken;
    },
    async setAccessToken(token) {
      accessToken = token;
    },
    async getSessionToken() {
      return sessionToken;
    },
    async setSessionToken(token) {
      sessionToken = token;
    },
  };
}

export type { AthenaTokenStore };