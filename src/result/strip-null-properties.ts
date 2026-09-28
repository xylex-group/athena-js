export function stripNullPropertiesFromRows(
  rows: unknown[],
  keepNullKeys?: ReadonlySet<string>
): unknown[] {
  return rows.map((row) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      return row;
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      if (value !== null || keepNullKeys?.has(key)) {
        out[key] = value;
      }
    }
    return out;
  });
}

export function maybeStripNullRows(
  rows: unknown[],
  strip: boolean,
  keepNullKeys?: ReadonlySet<string>
): unknown[] {
  return strip ? stripNullPropertiesFromRows(rows, keepNullKeys) : rows;
}

/** Relation output keys that stay on the row when `stripNulls` would drop SQL null (to-one / First `T | null`). */
export function keepNullKeysFromFindManySelect(
  payload: unknown
): ReadonlySet<string> | undefined {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    return;
  }
  const select = (payload as { select?: unknown }).select;
  if (select == null || typeof select !== "object" || Array.isArray(select)) {
    return;
  }
  const keys = new Set<string>();
  for (const [rawKey, rawValue] of Object.entries(
    select as Record<string, unknown>
  )) {
    if (
      rawValue == null ||
      typeof rawValue !== "object" ||
      Array.isArray(rawValue) ||
      !("select" in rawValue)
    ) {
      continue;
    }
    const aliasValue = (rawValue as Record<string, unknown>).as;
    const alias = typeof aliasValue === "string" ? aliasValue.trim() : "";
    keys.add(alias || rawKey);
  }
  return keys.size > 0 ? keys : undefined;
}
