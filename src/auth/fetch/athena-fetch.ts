import { applyFetchQuery, normalizeFetchBody } from "./body.ts";
import type { AthenaFetchOption, AthenaFetchResult } from "./types.ts";

/**
 * Fetch JSON (or text) and return a better-fetch-like `{ data, error }` result.
 *
 * Used by social-provider token and userinfo calls. Does **not** use
 * `@better-fetch/fetch`.
 */
export async function athenaFetch<T = unknown>(
  url: string,
  options: AthenaFetchOption = {}
): Promise<AthenaFetchResult<T>> {
  const headers = new Headers(options.headers);
  if (options.auth?.token) {
    const type = options.auth.type ?? "Bearer";
    headers.set("authorization", `${type} ${options.auth.token}`);
  }

  const target = applyFetchQuery(url, options.query);
  const body = normalizeFetchBody(options.body);

  if (
    body !== null &&
    typeof body === "string" &&
    !headers.has("content-type") &&
    body.startsWith("{")
  ) {
    headers.set("content-type", "application/json");
  }

  try {
    const response = await fetch(target, {
      body: body ?? undefined,
      headers,
      method: options.method ?? "GET",
      redirect: options.redirect ?? "follow",
      signal: options.signal,
    });

    await options.onResponse?.({ response });

    if (!response.ok) {
      let message = response.statusText || `HTTP ${response.status}`;
      try {
        const errBody = (await response.clone().json()) as {
          message?: string;
          error?: string;
          error_description?: string;
        };
        message =
          errBody.message ||
          errBody.error_description ||
          errBody.error ||
          message;
      } catch {
        try {
          message = (await response.clone().text()) || message;
        } catch {
          // ignore parse failures
        }
      }
      const error = {
        message,
        status: response.status,
        statusText: response.statusText,
      };
      await options.onError?.({ error, response });
      return { data: null, error };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (
      contentType.includes("application/json") ||
      contentType.includes("+json")
    ) {
      const data = (await response.json()) as T;
      return { data, error: null };
    }

    const text = await response.text();
    if (!text) {
      return { data: {} as T, error: null };
    }
    try {
      return { data: JSON.parse(text) as T, error: null };
    } catch {
      return { data: text as unknown as T, error: null };
    }
  } catch (cause) {
    const error = {
      message: cause instanceof Error ? cause.message : String(cause),
      status: 0,
      statusText: "NetworkError",
    };
    // Fetch Response status must be in 200–599; do not use status 0 (throws RangeError).
    // Use 502 as a stable stand-in for transport failures so onError hooks stay safe.
    await options.onError?.({
      error: cause,
      response: new Response(null, {
        status: 502,
        statusText: "Network Error",
      }),
    });
    return { data: null, error };
  }
}

/** Alias kept so mechanical renames from better-fetch stay readable. */
export const betterFetch = athenaFetch;
