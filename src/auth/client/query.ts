import type { AthenaAuthEndpointPath, AthenaAuthQueryValue } from "../types.ts";

export function appendQueryParam(
  searchParams: URLSearchParams,
  key: string,
  value: AthenaAuthQueryValue
): void {
  if (value === undefined || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => {
      searchParams.append(key, String(item));
    });
    return;
  }
  searchParams.append(key, String(value));
}

export function buildRequestUrl(
  baseUrl: string,
  endpoint: AthenaAuthEndpointPath,
  query?: Record<string, AthenaAuthQueryValue>
): string {
  const url = `${baseUrl}${endpoint}`;
  if (!query || Object.keys(query).length === 0) {
    return url;
  }
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    appendQueryParam(searchParams, key, value);
  }
  const queryText = searchParams.toString();
  return queryText ? `${url}?${queryText}` : url;
}

export function extractQueryFromPayload(
  payload: unknown
): Record<string, AthenaAuthQueryValue> | undefined {
  const query = (
    payload as { query?: Record<string, AthenaAuthQueryValue> } | undefined
  )?.query;
  if (!query || typeof query !== "object") {
    return;
  }
  return query;
}
