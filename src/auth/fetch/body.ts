import type { AthenaFetchOption } from "./types.ts";

/**
 * Normalize request bodies for `fetch` (string, form data, or JSON objects).
 */
export function normalizeFetchBody(
  body: AthenaFetchOption["body"]
): string | URLSearchParams | FormData | Blob | null | undefined {
  if (body === null) {
    return body as null | undefined;
  }
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body;
  }
  if (body instanceof FormData) {
    return body;
  }
  if (body instanceof Blob) {
    return body;
  }
  if (typeof body === "object") {
    return JSON.stringify(body);
  }
  return String(body);
}

/**
 * Append query params to a URL string.
 */
export function applyFetchQuery(
  url: string,
  query?: AthenaFetchOption["query"]
): string {
  if (!query) {
    return url;
  }
  const u = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    u.searchParams.set(key, String(value));
  }
  return u.toString();
}
