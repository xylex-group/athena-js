import type { AthenaRuntimeLimits } from "./types.ts";

export const DEFAULT_ATHENA_RUNTIME_LIMITS = {
  maxBodyBytes: 1_048_576,
  maxInItems: 100,
  maxInsertRows: 100,
  maxPageSize: 200,
} as const;

export interface ResolvedAthenaRuntimeLimits extends AthenaRuntimeLimits {
  maxBodyBytes: number;
  maxInItems: number;
  maxInsertRows: number;
  maxPageSize: number;
}

export function resolveAthenaRuntimeLimits(
  input?: AthenaRuntimeLimits
): ResolvedAthenaRuntimeLimits {
  return {
    maxBodyBytes: input?.maxBodyBytes ?? DEFAULT_ATHENA_RUNTIME_LIMITS.maxBodyBytes,
    maxInItems: input?.maxInItems ?? DEFAULT_ATHENA_RUNTIME_LIMITS.maxInItems,
    maxInsertRows:
      input?.maxInsertRows ?? DEFAULT_ATHENA_RUNTIME_LIMITS.maxInsertRows,
    maxPageSize: input?.maxPageSize ?? DEFAULT_ATHENA_RUNTIME_LIMITS.maxPageSize,
    ...(input?.maxNestedDepth != null
      ? { maxNestedDepth: input.maxNestedDepth }
      : {}),
    ...(input?.maxQueryComplexity != null
      ? { maxQueryComplexity: input.maxQueryComplexity }
      : {}),
    ...(input?.maxRelations != null ? { maxRelations: input.maxRelations } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function countInItems(value: unknown, max = 0): number {
  if (Array.isArray(value)) {
    return value.reduce((acc, item) => countInItems(item, acc), max);
  }
  if (!isRecord(value)) {
    return max;
  }
  let next = max;
  if (value.operator === "in") {
    const items = value.value ?? value.eq_value;
    if (Array.isArray(items)) {
      next = Math.max(next, items.length);
    }
  }
  for (const child of Object.values(value)) {
    next = countInItems(child, next);
  }
  return next;
}

function insertRowCount(payload: unknown): number {
  if (!isRecord(payload)) {
    return 0;
  }
  const body = payload.insert_body;
  if (Array.isArray(body)) {
    return body.length;
  }
  if (body && typeof body === "object") {
    return 1;
  }
  return 0;
}

function requestedPageSize(payload: unknown): number {
  if (!isRecord(payload)) {
    return 0;
  }
  const limit =
    typeof payload.limit === "number" && Number.isFinite(payload.limit)
      ? payload.limit
      : 0;
  const pageSize =
    typeof payload.page_size === "number" && Number.isFinite(payload.page_size)
      ? payload.page_size
      : 0;
  return Math.max(limit, pageSize, 0);
}

export function hasMutationPredicate(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }
  if (typeof payload.resource_id === "string" && payload.resource_id.trim()) {
    return true;
  }
  if (Array.isArray(payload.conditions) && payload.conditions.length > 0) {
    return true;
  }
  if (isRecord(payload.where) && Object.keys(payload.where).length > 0) {
    return true;
  }
  return false;
}

export type AthenaLimitViolation =
  | { kind: "body"; limit: number }
  | { kind: "insert"; count: number; limit: number }
  | { kind: "in"; count: number; limit: number }
  | { kind: "page"; count: number; limit: number };

export function inspectPayloadLimits(
  payload: unknown,
  limits: ResolvedAthenaRuntimeLimits
): AthenaLimitViolation | undefined {
  const inserts = insertRowCount(payload);
  if (inserts > limits.maxInsertRows) {
    return { count: inserts, kind: "insert", limit: limits.maxInsertRows };
  }
  const inItems = countInItems(payload);
  if (inItems > limits.maxInItems) {
    return { count: inItems, kind: "in", limit: limits.maxInItems };
  }
  const page = requestedPageSize(payload);
  if (page > limits.maxPageSize) {
    return { count: page, kind: "page", limit: limits.maxPageSize };
  }
  return undefined;
}
