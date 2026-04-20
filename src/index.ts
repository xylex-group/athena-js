/**
 * athena-js
 *
 * database driver API gateway SDK — Athena client for the Athena HTTP API
 * built by XYLEX Group
 */

// Athena client
export { createClient, AthenaClient } from "./client.js";
export { Backend } from "./gateway/types.js";
export { AthenaGatewayError, isAthenaGatewayError } from "./gateway/errors.ts";
export {
  isOk,
  unwrap,
  unwrapRows,
  unwrapOne,
  requireSuccess,
  requireAffected,
  normalizeAthenaError,
  coerceInt,
  assertInt,
  withRetry,
} from './auxiliaries.js'
export type {
  RpcQueryBuilder,
  RpcOrderOptions,
  AthenaSdkClient,
  TableQueryBuilder,
  AthenaResult,
} from "./client.js";
export type {
  AthenaErrorKind,
  AthenaOperationContext,
  NormalizedAthenaError,
  UnwrapOptions,
  UnwrapOneOptions,
  RequireAffectedOptions,
  IntCoercionOptions,
  RetryConfig,
  RetryBackoffStrategy,
} from './auxiliaries.js'
export type {
  AthenaConditionCastType,
  AthenaRpcCallOptions,
  AthenaRpcFilter,
  AthenaRpcFilterOperator,
  AthenaRpcOrder,
  AthenaRpcPayload,
  AthenaGatewayErrorCode,
  AthenaGatewayErrorDetails,
  BackendType,
  BackendConfig,
  AthenaGatewayCallOptions,
} from "./gateway/types.js";
