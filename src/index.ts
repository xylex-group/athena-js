/**
 * athena-js
 *
 * database driver API gateway SDK — Athena client for the Athena HTTP API
 * built by XYLEX Group
 */

// Athena client
export { createClient, AthenaClient } from './supabase.js'
export type {
  SupabaseClient,
  TableQueryBuilder,
  SupabaseResult,
  AthenaClientBuilder,
  AthenaClientConfig,
} from './supabase.js'

// Gateway types
export type {
  BackendType,
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
} from './gateway/types.js'
