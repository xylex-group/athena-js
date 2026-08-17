/**
 * Athena public contracts v1.
 *
 * Breaking changes belong in `contracts/v2/` with explicit adapters.
 * @see docs/adr/0021-layered-contract-policy.md
 */

export type {
  AthenaJsonArray,
  AthenaJsonObject,
  AthenaJsonPrimitive,
  AthenaJsonValue,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  OffsetPage,
  Page,
  SequencePage,
} from "./common.ts";
export type { AthenaTransportErrorCode as AthenaTransportErrorCodeName } from "./errors.ts";
export {
  type AthenaErrorBody,
  type AthenaErrorResponse,
  AthenaTransportErrorCode,
} from "./errors.ts";

export {
  type AnyPageRequest,
  type CursorPageRequest,
  type LimitPolicy,
  type OffsetPageRequest,
  PaginationLimitPolicy,
  type PaginationLimitPolicyName,
  type SequencePageRequest,
} from "./pagination.ts";
