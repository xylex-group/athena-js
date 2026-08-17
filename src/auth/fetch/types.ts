import type { Awaitable } from "../types/index.ts";

/**
 * Options for {@link athenaFetch}, aligned with the better-fetch call shape
 * used by Better Auth social providers (without depending on that package).
 */
export interface AthenaFetchOption {
  auth?:
    | {
        type?: "Bearer" | string;
        token: string;
      }
    | undefined;
  body?: unknown;
  headers?: Record<string, string> | Headers | undefined;
  method?: string;
  onError?:
    | ((context: { response: Response; error: unknown }) => Awaitable<void>)
    | undefined;
  onResponse?:
    | ((context: { response: Response }) => Awaitable<void>)
    | undefined;
  query?: Record<string, string | number | boolean | undefined | null>;
  redirect?: "follow" | "error" | "manual" | undefined;
  signal?: AbortSignal | undefined;
  /** better-fetch option; ignored — we always parse JSON when possible. */
  throw?: boolean;
}

export interface AthenaFetchError {
  message: string;
  status: number;
  statusText: string;
}

/**
 * Discriminated result so `if (error) return` narrows `data` to `T`.
 */
export type AthenaFetchResult<T> =
  | { data: T; error: null }
  | { data: null; error: AthenaFetchError };

/** @deprecated Alias for mechanical ports from better-fetch. */
export type BetterFetchOption = AthenaFetchOption;
