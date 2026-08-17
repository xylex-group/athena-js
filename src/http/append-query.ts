/**
 * Shared query-string builder for path + optional object of primitives.
 */

export interface AppendHttpQueryOptions {
  /**
   * When true, skip empty-string values (admin/backup style).
   * Default: only skip null/undefined.
   */
  skipEmptyString?: boolean;
}

/**
 * Append `query` object as `?k=v` on `path`. Omits null/undefined (and empty
 * strings when `skipEmptyString` is set).
 */
export function appendHttpQuery(
  path: string,
  query?: object,
  options?: AppendHttpQueryOptions
): string {
  if (!query) {
    return path;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (options?.skipEmptyString && value === "") {
      continue;
    }
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}
