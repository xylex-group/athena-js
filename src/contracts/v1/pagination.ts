/**
 * v1 pagination request contracts and limit policy constants.
 * Aligns with real server endpoint defaults/maxima (not coarse service-wide buckets).
 */

import type { OffsetPage, Page, SequencePage } from "./common.ts";

/** Named limit defaults for a single server surface. */
export interface LimitPolicy {
  readonly defaultLimit: number;
  readonly maxLimit: number;
  /**
   * Inclusive lower bound for finite requested limits.
   * Defaults to 1 when omitted (chat/storage style). Auth list-users allows 0.
   */
  readonly minLimit?: number;
}

/**
 * Endpoint-specific limit policies.
 *
 * Prefer these (or a caller-supplied {@link LimitPolicy}) over any service-wide
 * AUTH/CHAT bucket — list-users, chat list, and chat search disagree on defaults/maxima.
 */
export const PaginationLimitPolicy = {
  /**
   * Auth admin list-users (`GET /admin/list-users`).
   * Adapter default 100; allow up to 500. Server uses only .min(max) so 0 is valid
   * (empty/count-only windows); do not floor to 1.
   */
  AUTH_LIST_USERS: { defaultLimit: 100, maxLimit: 500, minLimit: 0 },
  /**
   * Chat list messages — `unwrap_or(50).clamp(1, 200)` in athena-chat.
   */
  CHAT_LIST_MESSAGES: { defaultLimit: 50, maxLimit: 200, minLimit: 1 },
  /**
   * Chat list rooms — `unwrap_or(50).clamp(1, 200)` in athena-chat.
   */
  CHAT_LIST_ROOMS: { defaultLimit: 50, maxLimit: 200, minLimit: 1 },
  /**
   * Chat search messages — `unwrap_or(25).clamp(1, 100)` in athena-chat.
   */
  CHAT_SEARCH_MESSAGES: { defaultLimit: 25, maxLimit: 100, minLimit: 1 },
  /** Generic SDK fallback. */
  DEFAULT: { defaultLimit: 50, maxLimit: 500, minLimit: 1 },
  /** Default storage list/page size policy. */
  STORAGE: { defaultLimit: 50, maxLimit: 500, minLimit: 1 },
} as const satisfies Record<string, LimitPolicy>;

export type PaginationLimitPolicyName = keyof typeof PaginationLimitPolicy;

/** Cursor-style page request (opaque cursor). */
export interface CursorPageRequest<TCursor = string> {
  cursor?: TCursor | null;
  limit?: number;
}

/** Offset-style page request (legacy). */
export interface OffsetPageRequest {
  /** 1-based page index; resolved with pageSize/limit into offset when present. */
  currentPage?: number;
  limit?: number;
  offset?: number;
  pageSize?: number;
}

/** Sequence page request. */
export interface SequencePageRequest {
  beforeSeq?: number | null;
  limit?: number;
}

export type AnyPageRequest =
  | CursorPageRequest
  | OffsetPageRequest
  | SequencePageRequest;

export type { OffsetPage, Page, SequencePage };
