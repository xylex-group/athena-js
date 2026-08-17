/**
 * Named pagination mappers (limit-plus-one and offset packaging).
 * Mirrors crates/athena-core helpers without inventing wire fields.
 */

import type { OffsetPage, Page, SequencePage } from "../contracts/v1/common.ts";
import {
  type LimitPolicy,
  PaginationLimitPolicy,
  type PaginationLimitPolicyName,
} from "../contracts/v1/pagination.ts";

function resolveLimitPolicy(
  policy: PaginationLimitPolicyName | LimitPolicy
): LimitPolicy {
  if (typeof policy === "string") {
    return PaginationLimitPolicy[policy];
  }
  return policy;
}

/**
 * Clamp a requested limit using an endpoint-named or caller-supplied policy.
 *
 * Prefer endpoint keys (e.g. `AUTH_LIST_USERS`, `CHAT_LIST_MESSAGES`) or an
 * inline `{ defaultLimit, maxLimit, minLimit? }` aligned to the real server surface.
 */
export function clampPaginationLimit(
  requested: number | undefined,
  policy: PaginationLimitPolicyName | LimitPolicy = "DEFAULT"
): number {
  const resolved = resolveLimitPolicy(policy);
  // Default only for omitted/non-finite input; clamp finite values to [min, max].
  // minLimit is endpoint-specific (0 for AUTH_LIST_USERS; 1 for chat/default).
  const minLimit =
    typeof resolved.minLimit === "number" && Number.isFinite(resolved.minLimit)
      ? Math.trunc(resolved.minLimit)
      : 1;
  const raw =
    typeof requested === "number" && Number.isFinite(requested)
      ? Math.trunc(requested)
      : resolved.defaultLimit;
  return Math.min(Math.max(raw, minLimit), resolved.maxLimit);
}

/**
 * Build a cursor {@link Page} from a limit-plus-one fetch.
 *
 * When the source returns `limit + 1` items, the extra row proves `hasMore`
 * and is dropped from `items`. `nextCursor` is derived from the last kept item.
 */
export function mapLimitPlusOneToPage<T, TCursor = string>(
  rows: readonly T[],
  limit: number,
  getCursor: (item: T) => TCursor
): Page<T, TCursor> {
  const safeLimit = Math.max(0, Math.trunc(limit));
  // limit 0: empty items window; hasMore from any returned lookahead row
  // (matches mapOffsetWindowToOffsetPage limitPlusOne with limit 0).
  if (safeLimit === 0) {
    return {
      hasMore: rows.length > 0,
      items: [],
      nextCursor: null,
    };
  }
  const hasMore = rows.length > safeLimit;
  const items = hasMore ? rows.slice(0, safeLimit) : [...rows];
  const last = items.length > 0 ? items.at(-1) : undefined;
  return {
    hasMore,
    items,
    nextCursor: hasMore && last !== undefined ? getCursor(last) : null,
  };
}

/**
 * Package an offset window into {@link OffsetPage}.
 */
export function mapOffsetWindowToOffsetPage<T>(input: {
  items: readonly T[];
  offset: number;
  limit: number;
  /** When true, more rows exist after this window (caller already knows). */
  hasMore?: boolean;
  /** Optional total when a count was performed. */
  total?: number;
  /** When items were fetched with limit+1, set true to auto-trim. */
  limitPlusOne?: boolean;
}): OffsetPage<T> {
  const offset = Math.max(0, Math.trunc(input.offset));
  const limit = Math.max(0, Math.trunc(input.limit));
  let items = [...input.items];
  let hasMore = input.hasMore ?? false;

  // Apply for every nonnegative limit (including 0) so zero-length windows
  // still auto-trim lookahead, matching mapLimitPlusOneToPage.
  // Trim independently of the hasMore signal: when callers already know
  // availability (explicit hasMore), do not overwrite with length inference
  // (discussion_r3687083537). Infer only when input.hasMore is undefined.
  if (input.limitPlusOne) {
    const inferredHasMore = items.length > limit;
    if (inferredHasMore) {
      items = items.slice(0, limit);
    }
    if (input.hasMore === undefined) {
      hasMore = inferredHasMore;
    }
  } else if (input.hasMore === undefined && typeof input.total === "number") {
    hasMore = offset + items.length < input.total;
  }

  return {
    items,
    limit,
    offset,
    ...(typeof input.total === "number" ? { total: input.total } : {}),
    hasMore,
  };
}

/**
 * Map athena-chat `MessagePage` wire (`items` + snake_case `next_before_seq`,
 * no `hasMore`) to the canonical camelCase {@link SequencePage} contract.
 *
 * athena-chat `list_messages` returns only LIMIT rows and always supplies
 * `next_before_seq` on nonempty pages without limit+1 lookahead. A full page
 * plus cursor therefore does **not** prove more results exist (exact-multiple
 * terminal pages would spuriously drive load-more UI).
 *
 * `hasMore` is true only when:
 * - the wire includes an explicit `has_more: true`, or
 * - the caller used limit+1 fetch semantics (`limitPlusOne: true`, a finite
 *   `limit`, and `items.length > limit`) when `has_more` is omitted.
 *   Without a finite `limit`, `limitPlusOne` is ignored (no wipe / false hasMore).
 * When `limitPlusOne` is set with a finite `limit`, the extra row is always
 * trimmed - even if an explicit `has_more` is also supplied.
 *
 * Chat limit+1 rows are ASC after reverse (oldest at index 0). The lookahead
 * row is the **leading** oldest item — trim with `slice(-limit)` / drop index 0,
 * not `slice(0, limit)` (which would drop the newest message). After trim,
 * `nextBeforeSeq` is derived from the oldest retained item's `room_seq`/`seq`
 * when present so the cursor matches the retained boundary.
 *
 * Otherwise `hasMore` is false. Cursor is still mapped for callers that page
 * manually. Call this before validating with `sequencePageSchema`.
 */
export function mapChatMessagePageWireToSequencePage<T>(wire: {
  items: readonly T[];
  next_before_seq?: number | null;
  /** Request limit used for the list call (required for limit+1 trim). */
  limit?: number;
  /** Explicit server availability signal when the wire provides it. */
  has_more?: boolean;
  /**
   * When true and `limit` is a finite number, treat items as limit+1 fetch
   * and auto-trim. Ignored when `limit` is omitted or non-finite.
   */
  limitPlusOne?: boolean;
}): SequencePage<T> {
  const raw = wire.next_before_seq;
  let nextBeforeSeq =
    typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : null;
  let items = [...wire.items];
  // Omitted/non-finite limit must not default to 0 under limitPlusOne (would
  // wipe items and set hasMore=true). Require a finite limit for lookahead.
  const hasFiniteLimit =
    typeof wire.limit === "number" && Number.isFinite(wire.limit);
  const safeLimit = hasFiniteLimit
    ? Math.max(0, Math.trunc(wire.limit as number))
    : 0;

  // hasMore signal: explicit has_more wins; else derive from limit+1 length.
  let hasMore = false;
  if (wire.has_more === true) {
    hasMore = true;
  } else if (wire.has_more === false) {
    hasMore = false;
  } else if (wire.limitPlusOne && hasFiniteLimit) {
    hasMore = items.length > safeLimit;
  }

  // Trim lookahead independently of has_more (discussion_r3687053473):
  // both may be set; limitPlusOne still auto-trims to `limit` rows.
  if (wire.limitPlusOne && hasFiniteLimit && items.length > safeLimit) {
    // ASC after reverse: drop leading oldest lookahead; keep newest `limit`.
    items = safeLimit === 0 ? [] : items.slice(-safeLimit);
    const oldestRetained = items[0];
    const derived = seqFromChatItem(oldestRetained);
    if (derived !== null) {
      nextBeforeSeq = derived;
    }
  }
  // No full-page + cursor heuristic: server does not look ahead.

  return {
    hasMore,
    items,
    nextBeforeSeq,
  };
}

/** Prefer chat `room_seq`, then generic `seq`, for sequence-cursor derivation. */
function seqFromChatItem(item: unknown): number | null {
  if (item === null || typeof item !== "object") {
    return null;
  }
  const record = item as Record<string, unknown>;
  for (const key of ["room_seq", "seq"] as const) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.trunc(value);
    }
  }
  return null;
}
