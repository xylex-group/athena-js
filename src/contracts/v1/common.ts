/**
 * Shared v1 contract primitives: JSON values and pagination page shapes.
 *
 * Policy: docs/adr/0021-layered-contract-policy.md
 */

/** JSON scalar values after successful decode. */
export type JsonPrimitive = string | number | boolean | null;

/** Any JSON value (object, array, or primitive). Prefer over `unknown` once decoded. */
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

/** JSON object map. Use for metadata and extension bags. */
export interface JsonObject {
  [key: string]: JsonValue;
}

/**
 * Cursor-first paginated result. Prefer for new list APIs.
 * Cursor encoding is endpoint-specific; keep opaque at the public boundary.
 */
export interface Page<T, TCursor = string> {
  hasMore: boolean;
  items: T[];
  nextCursor: TCursor | null;
}

/** Sequence/seek pagination (e.g. chat or event logs ordered by seq). */
export interface SequencePage<T> {
  hasMore: boolean;
  items: T[];
  nextBeforeSeq: number | null;
}

/**
 * Offset pagination for legacy and compatibility surfaces.
 * Prefer {@link Page} for new endpoints.
 */
export interface OffsetPage<T> {
  hasMore: boolean;
  items: T[];
  limit: number;
  offset: number;
  total?: number;
}

/** Aliases matching existing gateway JSON naming (compatibility). */
export type AthenaJsonPrimitive = JsonPrimitive;
export type AthenaJsonValue = JsonValue;
export type AthenaJsonObject = JsonObject;
export type AthenaJsonArray = JsonValue[];
