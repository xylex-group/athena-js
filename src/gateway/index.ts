/**
 * athena gateway react module
 *
 * exports the useAthenaGateway hook and all associated types
 */

export { useAthenaGateway } from './use-athena-gateway.js'
export type {
  AthenaGatewayCondition,
  AthenaFetchPayload,
  AthenaInsertPayload,
  AthenaDeletePayload,
  AthenaUpdatePayload,
  AthenaGatewayBaseOptions,
  AthenaGatewayHookConfig,
  AthenaGatewayCallOptions,
  AthenaGatewayResponse,
  AthenaGatewayResponseLog,
  AthenaGatewayCallLog,
  AthenaGatewayHookResult,
  AthenaGatewayMethod,
  AthenaGatewayEndpointPath,
} from './types.js'
