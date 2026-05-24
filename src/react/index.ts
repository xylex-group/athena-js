/**
 * athena react module
 *
 * Includes low-level gateway hook + Athena-native query runtime hooks.
 */

export { useAthenaGateway } from '../gateway/use-athena-gateway.ts'
export { AthenaGatewayError, isAthenaGatewayError } from '../gateway/errors.ts'

export { AthenaQueryClient, createAthenaQueryClient, attachStateAdapter } from './query-client.ts'
export { AthenaQueryClientProvider, useAthenaQueryClient } from './provider.ts'
export { useQuery } from './use-query.ts'
export { useMutation } from './use-mutation.ts'
export {
  createModelFormAdapter,
  toModelFormDefaults,
  toModelPayload,
} from '../schema/model-form.ts'

export type {
  ModelFormAdapter,
  ModelFormDefaults,
  ModelFormNullishMode,
  ModelFormValues,
  ToModelFormDefaultsOptions,
  ToModelPayloadOptions,
} from '../schema/model-form.ts'

export type {
  AthenaGatewayHookConfig,
  AthenaGatewayHookResult,
  AthenaGatewayCallOptions,
  AthenaGatewayErrorCode,
  AthenaGatewayErrorDetails,
  AthenaRpcFilter,
  AthenaRpcFilterOperator,
  AthenaFetchPayload,
  AthenaInsertPayload,
  AthenaRpcOrder,
  AthenaRpcCallOptions,
  AthenaRpcPayload,
  AthenaUpdatePayload,
  AthenaDeletePayload,
  AthenaGatewayResponse,
} from '../gateway/types.ts'

export type {
  QueryStatus,
  AthenaCacheMode,
  QueryKey,
  AthenaQueryError,
  AthenaRetryDelay,
  AthenaRetryCount,
  AthenaResponseLike,
  AthenaQueryRequestLog,
  AthenaMutationRequestLog,
  AthenaQueryResult,
  AthenaMutationResultData,
  AthenaQueryState,
  AthenaMutationState,
  UseQueryOptions,
  UseQueryResult,
  UseMutationOptions,
  UseMutationResult,
  AthenaCachePolicy,
  AthenaQueryDefaults,
  AthenaMutationDefaults,
  AthenaQueryClientConfig,
  AthenaRuntimeEventType,
  AthenaRuntimeBaseEvent,
  AthenaQueryEvent,
  AthenaMutationEvent,
  AthenaRuntimeEvent,
  AthenaStateAdapter,
  AthenaUnsubscribe,
} from './types.ts'
