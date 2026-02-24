/**
 * athena gateway react module
 *
 * Low-level gateway hook. Most users should use createClient() and the query builder.
 */

export { useAthenaGateway } from './use-athena-gateway.js'
export type {
  AthenaGatewayHookConfig,
  AthenaGatewayHookResult,
  AthenaGatewayCallOptions,
  AthenaFetchPayload,
  AthenaInsertPayload,
  AthenaUpdatePayload,
  AthenaDeletePayload,
  AthenaGatewayResponse,
} from './types.js'
