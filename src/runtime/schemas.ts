/**
 * Zod schemas for v1 contracts (JSON, pagination, error envelopes).
 */

import { z } from "zod";
import type { JsonObject, JsonValue } from "../contracts/v1/common.ts";
import { AthenaTransportErrorCode } from "../contracts/v1/errors.ts";
import { PaginationLimitPolicy } from "../contracts/v1/pagination.ts";

export const jsonPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

/** Recursive JSON value; output type matches public {@link JsonValue}. */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    jsonPrimitiveSchema,
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

/** JSON object map; output type matches public {@link JsonObject}. */
export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(
  z.string(),
  jsonValueSchema
);

export const athenaTransportErrorCodeSchema = z.enum([
  AthenaTransportErrorCode.ValidationError,
  AthenaTransportErrorCode.AuthenticationRequired,
  AthenaTransportErrorCode.Forbidden,
  AthenaTransportErrorCode.NotFound,
  AthenaTransportErrorCode.Conflict,
  AthenaTransportErrorCode.RateLimited,
  AthenaTransportErrorCode.Transient,
  AthenaTransportErrorCode.Internal,
]);

/**
 * Strict error body: unknown keys (e.g. drifted `request_id`) fail validation
 * instead of being stripped. `details` remains an open JsonObject bag.
 */
export const athenaErrorBodySchema = z
  .object({
    code: athenaTransportErrorCodeSchema,
    details: jsonObjectSchema.optional(),
    message: z.string(),
    requestId: z.string().optional(),
    retryable: z.boolean(),
  })
  .strict();

/** Strict outer envelope: only the `error` key is allowed. */
export const athenaErrorResponseSchema = z
  .object({
    error: athenaErrorBodySchema,
  })
  .strict();

/**
 * Cursor page request schema. Pass a cursor schema when the endpoint uses a
 * non-string cursor (e.g. numeric IDs); defaults to opaque string cursors.
 */
export function cursorPageRequestSchema<C extends z.ZodTypeAny = z.ZodString>(
  cursorSchema: C = z.string() as unknown as C
) {
  return z.object({
    cursor: z.union([cursorSchema, z.null()]).optional(),
    limit: z.number().int().positive().optional(),
  });
}

export const offsetPageRequestSchema = z.object({
  currentPage: z.number().int().positive().optional(),
  // nonnegative so AUTH_LIST_USERS empty/count-only requests (limit 0) validate
  // after clampPaginationLimit(0, "AUTH_LIST_USERS") — aligns with policy minLimit 0.
  limit: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
  pageSize: z.number().int().positive().optional(),
});

/** Sequence page request schema (`beforeSeq` + `limit`). */
export const sequencePageRequestSchema = z.object({
  beforeSeq: z.union([z.number().int(), z.null()]).optional(),
  limit: z.number().int().positive().optional(),
});

/**
 * Cursor page result schema. Second argument selects the cursor wire type so
 * runtime validation matches {@link Page} / `mapLimitPlusOneToPage` generics.
 */
export function pageSchema<
  T extends z.ZodTypeAny,
  C extends z.ZodTypeAny = z.ZodString,
>(itemSchema: T, cursorSchema: C = z.string() as unknown as C) {
  return z.object({
    hasMore: z.boolean(),
    items: z.array(itemSchema),
    nextCursor: z.union([cursorSchema, z.null()]),
  });
}

export function offsetPageSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    hasMore: z.boolean(),
    items: z.array(itemSchema),
    limit: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().optional(),
  });
}

export function sequencePageSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    hasMore: z.boolean(),
    items: z.array(itemSchema),
    nextBeforeSeq: z.union([z.number().int(), z.null()]),
  });
}

export { PaginationLimitPolicy };
