/**
 * athena react module
 *
 * Includes low-level gateway hook + Athena-native query runtime hooks.
 */

export type {
  AthenaSessionData,
  ToSessionDataOptions,
} from "../auth/session-data.ts";
export { toSessionData } from "../auth/session-data.ts";
export type { DerivedSessionView } from "../auth/session-view.ts";
export { deriveSessionView } from "../auth/session-view.ts";
export type { AthenaAuthBindings, AuthBindings } from "../auth/types.ts";
export { AthenaGatewayError, isAthenaGatewayError } from "../gateway/errors.ts";
export type {
  AthenaDeletePayload,
  AthenaFetchPayload,
  AthenaGatewayCallOptions,
  AthenaGatewayErrorCode,
  AthenaGatewayErrorDetails,
  AthenaGatewayHookConfig,
  AthenaGatewayHookResult,
  AthenaGatewayResponse,
  AthenaInsertPayload,
  AthenaJsonArray,
  AthenaJsonObject,
  AthenaJsonPrimitive,
  AthenaJsonValue,
  AthenaRpcCallOptions,
  AthenaRpcFilter,
  AthenaRpcFilterOperator,
  AthenaRpcOrder,
  AthenaRpcPayload,
  AthenaUpdatePayload,
} from "../gateway/types.ts";
export { useAthenaGateway } from "../gateway/use-athena-gateway.ts";
export type {
  ModelFormAdapter,
  ModelFormDefaults,
  ModelFormNullishMode,
  ModelFormValues,
  ToModelFormDefaultsOptions,
  ToModelPayloadOptions,
} from "../schema/model-form.ts";
export {
  createModelFormAdapter,
  toModelFormDefaults,
  toModelPayload,
} from "../schema/model-form.ts";
export { AthenaQueryClientProvider, useAthenaQueryClient } from "./provider.ts";
export type { AthenaNormalizedQueryPage } from "../query/entity-graph.ts";
export {
  type AthenaCacheTransaction,
  type AthenaDehydratedCache,
  type AthenaModelCache,
  AthenaQueryClient,
  attachStateAdapter,
  createAthenaQueryClient,
} from "./query-client.ts";
export type {
  AthenaCacheMode,
  AthenaCachePolicy,
  AthenaInvalidateQueriesFilters,
  AthenaMutationDefaults,
  AthenaMutationEvent,
  AthenaMutationRequestLog,
  AthenaMutationResultData,
  AthenaMutationState,
  AthenaQueryClientConfig,
  AthenaQueryDefaults,
  AthenaQueryError,
  AthenaQueryEvent,
  AthenaQueryRequestLog,
  AthenaQueryResult,
  AthenaQueryState,
  AthenaResponseLike,
  AthenaRetryCount,
  AthenaRetryDelay,
  AthenaRuntimeBaseEvent,
  AthenaRuntimeEvent,
  AthenaRuntimeEventType,
  AthenaStateAdapter,
  AthenaUnsubscribe,
  QueryKey,
  QueryStatus,
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
} from "./types.ts";
export type {
  UseAdminPermissionOptions,
  UseAdminPermissionResult,
} from "./use-admin-permission.ts";
export { useAdminPermission } from "./use-admin-permission.ts";
export type { UseAthenaMutationOptions } from "./use-athena-mutation.ts";
export { useAthenaMutation } from "./use-athena-mutation.ts";
export type { UseAthenaQueryOptions } from "./use-athena-query.ts";
export { useAthenaQuery } from "./use-athena-query.ts";
export type {
  UseAthenaReadQueryOptions,
  UseAthenaReadQueryResult,
} from "./use-athena-read-query.ts";
export { useAthenaReadQuery } from "./use-athena-read-query.ts";
export type {
  UseAthenaSessionClientOptions,
  UseAthenaSessionClientResult,
} from "./use-athena-session-client.ts";
export { useAthenaSessionClient } from "./use-athena-session-client.ts";
export { useMutation } from "./use-mutation.ts";
export { useQuery } from "./use-query.ts";
export type {
  UseSessionAuthClient,
  UseSessionOptions,
  UseSessionResult,
} from "./use-session.ts";
export { useSession } from "./use-session.ts";
export type {
  UseStorageFileDeleteOptions,
  UseStorageFileDeleteResult,
} from "./use-storage-file-delete.ts";
export { useStorageFileDelete } from "./use-storage-file-delete.ts";
export type {
  UseStorageFilesOptions,
  UseStorageFilesResult,
} from "./use-storage-files.ts";
export { useStorageFiles } from "./use-storage-files.ts";
export type {
  UseStorageUploadInput,
  UseStorageUploadOptions,
  UseStorageUploadResult,
} from "./use-storage-upload.ts";
export { useStorageUpload } from "./use-storage-upload.ts";
