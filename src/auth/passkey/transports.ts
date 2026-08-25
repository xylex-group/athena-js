/** Parse a stored JSON-array transports string. Empty / invalid → null. */
export function parseStoredPasskeyTransports(
  value: string | null | undefined
): string[] | null {
  if (value == null || value.trim() === "") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return null;
    }
    const listed = parsed.filter(
      (entry): entry is string => typeof entry === "string" && entry.length > 0
    );
    return listed.length > 0 ? listed : null;
  } catch {
    return null;
  }
}

/** Encode transports as a JSON-array string, or null when missing/empty. */
export function serializePasskeyTransports(
  value: readonly string[] | null | undefined
): string | null {
  if (value == null || value.length === 0) {
    return null;
  }
  return JSON.stringify([...value]);
}
