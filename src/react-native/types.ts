/**
 * React Native platform adapter contracts for @xylex-group/athena/react-native.
 * Implementations live in the app (SecureStore, MMKV, Linking, AppState) — not in core.
 */

export type AthenaLifecycleState = "active" | "background" | "inactive";

/** Secure token persistence — Expo SecureStore / MMKV / Keychain adapters implement this. */
export interface AthenaTokenStore {
  getAccessToken(): Promise<string | null>;
  setAccessToken(token: string | null): Promise<void>;
  getSessionToken(): Promise<string | null>;
  setSessionToken(token: string | null): Promise<void>;
}

export interface AthenaLinkingAdapter {
  openUrl(url: string): Promise<void>;
  getInitialUrl(): Promise<string | null>;
}

export interface AthenaLifecycleAdapter {
  subscribe(
    listener: (state: AthenaLifecycleState) => void,
  ): () => void;
}

export interface AthenaUploadAdapter {
  /**
   * Optional upload implementation for URI/blob bodies when XHR progress is unavailable.
   * Core storage remains the default; this is reserved for app-level injection.
   */
  put?(
    url: string,
    body: unknown,
    init?: {
      headers?: Record<string, string>;
      onProgress?: (loaded: number, total?: number) => void;
      signal?: AbortSignal;
    },
  ): Promise<Response>;
}

export type AthenaReactNativeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;