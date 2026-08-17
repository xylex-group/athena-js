/**
 * Shared HTTP response JSON heuristics used by gateway, storage, auth, and chat.
 */

export interface ParsedHttpResponseBody {
  parsed: unknown;
  parseFailed: boolean;
}

/**
 * Parse a response body as JSON when content-type or body shape suggests JSON.
 * Non-JSON text is returned as a string with `parseFailed: false`.
 * Empty body → `parsed: null`.
 */
export function parseHttpResponseBody(
  rawText: string,
  contentType: string | null
): ParsedHttpResponseBody {
  if (!rawText) {
    return { parsed: null, parseFailed: false };
  }

  const contentTypeSuggestsJson =
    contentType?.toLowerCase().includes("application/json") ?? false;
  const looksJson =
    contentTypeSuggestsJson ||
    rawText.startsWith("{") ||
    rawText.startsWith("[");

  if (!looksJson) {
    return { parsed: rawText, parseFailed: false };
  }

  try {
    return { parsed: JSON.parse(rawText) as unknown, parseFailed: false };
  } catch {
    return { parsed: rawText, parseFailed: true };
  }
}
