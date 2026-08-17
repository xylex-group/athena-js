/**
 * Backend-neutral mutation row-count extraction.
 *
 * Public field: AthenaResult.affectedRows
 * Transports feed this helper; fluent builders stay backend-neutral.
 */

const MUTATION_ENDPOINTS = new Set([
  "/gateway/insert",
  "/gateway/update",
  "/gateway/delete",
]);

const PRIMARY_ALIAS_KEYS = [
  "affectedRows",
  "affected_rows",
  "row_count",
  "rows_affected",
  "rowCount",
  "rows_written",
  "changes",
] as const;

const FALLBACK_COUNT_KEYS = ["count"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readKeys(
  raw: Record<string, unknown>,
  keys: readonly string[]
): number | undefined {
  for (const key of keys) {
    const direct = asFiniteNumber(raw[key]);
    if (direct !== undefined) {
      return direct;
    }
  }
  return undefined;
}

function readAlias(
  raw: unknown,
  keys: readonly string[] = PRIMARY_ALIAS_KEYS
): number | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const direct = readKeys(raw, keys);
  if (direct !== undefined) {
    return direct;
  }
  if (isRecord(raw.meta)) {
    const changes = asFiniteNumber(raw.meta.changes);
    if (changes !== undefined) {
      return changes;
    }
  }
  if (isRecord(raw.data)) {
    const nested = readAlias(raw.data, keys);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

export function isMutationGatewayEndpoint(
  endpoint: string | undefined
): boolean {
  if (!endpoint) {
    return false;
  }
  return MUTATION_ENDPOINTS.has(endpoint);
}

/**
 * Resolve affected-row metadata for a mutation transport response.
 *
 * - `undefined` — not a mutation (e.g. fetch / select). Callers must omit the field.
 * - `null` — mutation, but no honest count is available. Never fabricate 0.
 * - `number` — known affected-row count from the backend.
 */
export function resolveMutationAffectedRows(input: {
  count?: number | null;
  endpoint?: string;
  operation?: string;
  raw?: unknown;
}): number | null | undefined {
  const operation = input.operation?.toLowerCase();
  const isMutationOperation =
    operation === "insert" ||
    operation === "update" ||
    operation === "delete" ||
    operation === "upsert";
  const isMutation =
    isMutationOperation || isMutationGatewayEndpoint(input.endpoint);

  if (!isMutation) {
    return undefined;
  }

  const fromPrimary = readAlias(input.raw, PRIMARY_ALIAS_KEYS);
  if (fromPrimary !== undefined) {
    return fromPrimary;
  }

  const fromCount = asFiniteNumber(input.count);
  if (fromCount !== undefined) {
    return fromCount;
  }

  const fromRawCount = readAlias(input.raw, FALLBACK_COUNT_KEYS);
  if (fromRawCount !== undefined) {
    return fromRawCount;
  }

  return null;
}
