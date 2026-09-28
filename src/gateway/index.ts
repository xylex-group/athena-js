/**
 * athena gateway react module
 *
 * Low-level gateway hook. Most users should use createClient() and the query builder.
 */

export { createAthenaGatewayClient, verifyAthenaGatewayUrl } from "./client.ts";
export { AthenaGatewayError, isAthenaGatewayError } from "./errors.ts";
export type {
  AthenaDeletePayload,
  AthenaDiscoveryErrorCode,
  AthenaFetchPayload,
  AthenaGatewayCallOptions,
  AthenaGatewayConnectionOptions,
  AthenaGatewayConnectionResult,
  AthenaGatewayErrorCode,
  AthenaGatewayErrorDetails,
  AthenaGatewayHookConfig,
  AthenaGatewayHookResult,
  AthenaGatewayResponse,
  AthenaGatewayTransportErrorCode,
  AthenaInsertPayload,
  AthenaRpcCallOptions,
  AthenaRpcFilter,
  AthenaRpcFilterOperator,
  AthenaRpcOrder,
  AthenaRpcPayload,
  AthenaUpdatePayload,
} from "./types.js";
export { normalizeAthenaGatewayBaseUrl } from "./url.ts";
export { useAthenaGateway } from "./use-athena-gateway.js";
