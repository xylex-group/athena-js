/**
 * athena-js browser entry
 *
 * Keeps the root package import browser-safe by avoiding Node-only modules
 * while preserving the existing export surface.
 */

// Dragunov / 3.7 release + admin raw SQL surface (browser-safe types + helpers)
export type {
  AthenaAdminQueryExecutionMetadata,
  AthenaAdminQueryInput,
  AthenaAdminQueryResult,
  AthenaExpectedQueryShape,
  AthenaRawQueryOperation,
} from "./admin/query.ts";
export {
  ATHENA_RAW_SQL_COMPAT_DEPRECATED,
  classifyRawSqlOperation,
  createAdminQuery,
  sqlLooksLikeMultipleStatements,
} from "./admin/query.ts";
export {
  ATHENA_AUTH_ADMIN_LIMITS,
  ATHENA_AUTH_BASE_ERROR_CODES,
  ATHENA_AUTH_MAX_ADMIN_JSON_BYTES,
  ATHENA_AUTH_MAX_ADMIN_JSON_DEPTH,
  ATHENA_AUTH_MAX_TEMPLATE_VARIABLE_LENGTH,
  ATHENA_AUTH_MAX_TEMPLATE_VARIABLES,
  AUTH_EMAIL_EVENT_CATALOG,
  authEmailEvents,
  athenaAuth,
  createAuthReactEmailInput,
  defineAthenaAuthConfig,
  defineAuthEmailTemplate,
  flattenAuthEmailEvents,
  renderAthenaReactEmail,
  renderAuthEmailFragment,
} from "./auth/index.ts";
export {
  AthenaError,
  AthenaErrorCategory,
  AthenaErrorCode,
  AthenaErrorKind,
  assertInt,
  coerceInt,
  isOk,
  normalizeAthenaError,
  parseBooleanFlag,
  requireAffected,
  requireSuccess,
  unwrap,
  unwrapOne,
  unwrapRows,
  withRetry,
} from "./auxiliaries.js";
export type {
  AthenaBillingCallOptions,
  AthenaBillingClientConfig,
  AthenaBillingModule,
} from "./billing/index.ts";
export {
  AthenaBillingError,
  billingSdkManifest,
  createBillingModule,
} from "./billing/index.ts";
export {
  AthenaChatError,
  chatSdkManifest,
  unwrapChatMessage,
  unwrapChatRoom,
} from "./chat/module.ts";
export type { AthenaClientCapabilities } from "./cloudflare/types.ts";
export type {
  AthenaCompatibilityReport,
  AthenaCompatibilityWarning,
} from "./compatibility/report.ts";
export {
  buildCompatibilityReportFromHealth,
  buildUndiscoveredCompatibilityReport,
} from "./compatibility/report.ts";
export type {
  AnyPageRequest,
  AthenaErrorBody,
  AthenaErrorResponse,
  AthenaTransportErrorCode as AthenaTransportErrorCodeName,
  CursorPageRequest,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  LimitPolicy,
  OffsetPage,
  OffsetPageRequest,
  Page,
  PaginationLimitPolicyName,
  SequencePage,
  SequencePageRequest,
} from "./contracts/v1/index.ts";
export {
  AthenaTransportErrorCode,
  PaginationLimitPolicy,
} from "./contracts/v1/index.ts";
export { verifyAthenaGatewayUrl } from "./gateway/client.ts";
export { AthenaGatewayError, isAthenaGatewayError } from "./gateway/errors.ts";
export {
  ATHENA_GATEWAY_ROUTES,
  ATHENA_ROUTE_MANIFEST,
  getAthenaRouteDescriptor,
  isDeprecatedAthenaRoute,
} from "./gateway/routes.ts";
export { Backend } from "./gateway/types.js";
export { normalizeAthenaGatewayBaseUrl } from "./gateway/url.ts";
export { generatorEnv } from "./generator/env.ts";
export { resolvePostgresColumnType } from "./generator/postgres-type-mapping.ts";
export {
  GENERATED_FILE_BANNER,
  renderGeneratedFileHeader,
  stripGeneratedFileHeader,
  withGeneratedFileBanner,
} from "./generator/render-shared.ts";
export {
  DEFAULT_POSTGRES_SCHEMAS,
  normalizeSchemaSelection,
  resolveProviderSchemas,
} from "./generator/schema-selection.ts";
export {
  filterIntrospectionSnapshot,
  normalizeTableSelection,
} from "./generator/table-selection.ts";
export {
  clampPaginationLimit,
  mapAthenaErrorCodeToTransportCode,
  mapChatMessagePageWireToSequencePage,
  mapLimitPlusOneToPage,
  mapNormalizedAthenaErrorToErrorResponse,
  mapOffsetWindowToOffsetPage,
} from "./mappers/index.ts";
export type {
  AthenaCacheContextDescriptor,
  AthenaCacheScope,
  AthenaExecuteOptions,
  AthenaExecutable,
  AthenaFieldDependency,
  AthenaFilterDescriptor,
  AthenaModelDependency,
  AthenaOrderDescriptor,
  AthenaPagination,
  AthenaPredicateNode,
  AthenaProjectionDescriptor,
  AthenaProjectionKind,
  AthenaQueryDependencyDescriptor,
  AthenaQueryDescriptor,
  AthenaQueryDescriptorCompileInput,
  AthenaQueryFieldDependencyKind,
  AthenaQueryOperation,
  AthenaQueryTarget,
  AthenaRangeDescriptor,
  AthenaRelationDependency,
  AthenaRelationDescriptor,
  AthenaSelectionNode,
} from "./query/descriptor.ts";
export {
  ATHENA_EXECUTABLE,
  buildAthenaModelScopeKey,
  buildAthenaQueryKey,
  compileAthenaQueryDescriptor,
  createCapturedAthenaExecutable,
  isAthenaExecutable,
  resolveAthenaQueryTarget,
} from "./query/descriptor.ts";
export {
  canonicalizeAthenaValue,
  hashAthenaValue,
} from "./query/canonicalize.ts";
export { explainAthenaQuery } from "./query/explain.ts";
export type { AthenaQueryExplanation } from "./query/explain.ts";
export { defineModelView } from "./query/model-view.ts";
export type {
  AthenaModelView,
  AthenaModelViewDefinition,
  AthenaModelViewField,
} from "./query/model-view.ts";
export type {
  AthenaEntityContextIdentity,
  AthenaEntityKey,
  AthenaModelIdentity,
  AthenaPrimaryKey,
} from "./query/model-identity.ts";
export {
  athenaEntityKeyToken,
  createAthenaEntityKey,
  entityKeyFromSinglePrimary,
  modelIdentity,
} from "./query/model-identity.ts";
export type {
  AthenaReadQueryClient,
  AthenaReadQueryColumn,
  AthenaReadQueryDefinition,
  AthenaReadQueryExecutionInput,
  AthenaReadQueryExecutionResult,
  AthenaReadQueryFilter,
  AthenaReadQueryFilterOperator,
  AthenaReadQueryFilterValue,
  AthenaReadQueryFlatRow,
  AthenaReadQueryMode,
  AthenaReadQueryOrder,
  AthenaReadQueryOrderByInput,
  AthenaReadQueryOrderDirection,
  AthenaReadQueryRelationRef,
  AthenaTableFilter,
  AthenaTableFilterOperator,
  AthenaTableFilterValue,
  AthenaTableFlatRow,
  AthenaTableOrder,
  AthenaTableOrderByInput,
  AthenaTableOrderDirection,
  AthenaTableQueryClient,
  AthenaTableQueryColumn,
  AthenaTableQueryDefinition,
  AthenaTableQueryExecutionInput,
  AthenaTableQueryExecutionResult,
  AthenaTableQueryMode,
  AthenaTableRelationRef,
} from "./query/read-query.ts";
export {
  applyAthenaReadQueryFilters,
  applyAthenaReadQuerySelectLimit,
  applyAthenaReadQuerySelectOrder,
  applyAthenaTableFilters,
  applyAthenaTableSelectLimit,
  applyAthenaTableSelectOrder,
  buildAthenaReadQueryFindManyOrderBy,
  buildAthenaReadQueryFindManySelect,
  buildAthenaReadQueryFindManyWhere,
  buildAthenaReadQuerySelectString,
  buildAthenaTableFindManyOrderBy,
  buildAthenaTableFindManySelect,
  buildAthenaTableFindManyWhere,
  buildAthenaTableSelectString,
  clampAthenaReadQueryTotalItems,
  clampAthenaTableTotalItems,
  executeAthenaReadQuery,
  executeAthenaTableQuery,
  flattenAthenaReadQueryRows,
  flattenAthenaRows,
  normalizeAthenaReadQueryOrderBy,
  normalizeAthenaTableOrderBy,
  resolveAthenaReadQueryPageFetch,
} from "./query/read-query.ts";
export {
  descriptorFromReadQueryDefinition,
  readQueryDefinitionFromDescriptor,
} from "./query/read-query-descriptor.ts";
export { getAthenaDebugAst } from "./query-debug-ast.ts";
export type {
  AthenaNormalizedHealth,
  AthenaReleaseChannel,
  AthenaReleaseIdentity,
} from "./release/identity.ts";
export {
  normalizeAthenaHealthPayload,
  normalizeAthenaReleaseIdentity,
} from "./release/identity.ts";
export type { AthenaContractIssue } from "./runtime/index.ts";
export {
  AthenaContractParseError,
  athenaErrorBodySchema,
  athenaErrorResponseSchema,
  athenaTransportErrorCodeSchema,
  cursorPageRequestSchema,
  jsonObjectSchema,
  jsonPrimitiveSchema,
  jsonValueSchema,
  offsetPageRequestSchema,
  offsetPageSchema,
  pageSchema,
  parseContractOrThrow,
  safeParseContract,
  sequencePageRequestSchema,
  sequencePageSchema,
} from "./runtime/index.ts";
export {
  defineDatabase,
  defineModel,
  defineRegistry,
  defineSchema,
} from "./schema/definitions.ts";
export {
  createModelFormAdapter,
  toModelFormDefaults,
  toModelPayload,
} from "./schema/model-form.ts";
export type {
  ModelSqlDialect,
  ModelSqlFile,
  ModelSqlInput,
  ModelSqlOptions,
  ModelsToSqlFilesOptions,
} from "./schema/model-sql.ts";
export {
  collectModelsFromSqlInput,
  modelsToSql,
  modelsToSqlFiles,
  sqlD1,
  sqlPostgres,
  sqlSqlite,
} from "./schema/model-sql.ts";
export { table } from "./schema/table-builder.ts";
export {
  boolean,
  enumeration,
  json,
  number,
  string,
} from "./schema/table-columns.ts";
// Schema-diff APIs (browser-safe pure functions; match root package surface)
export {
  ATHENA_INTERNAL_SCHEMAS,
  ATHENA_SCHEMA_SNAPSHOT_VERSION,
  SchemaDiffError,
  columnTypesEqual,
  columnsEqual,
  diffSchemas,
  emptySchemaSnapshot,
  isSchemaDiffEmpty,
  normalizeDefaultExpression,
  normalizeReferentialAction,
  normalizeSchemaColumnType,
  normalizeSchemaSnapshot,
  parseSchemaTypeString,
  primaryKeysEqual,
  schemaSnapshotFromIntrospection,
  schemaSnapshotFromModels,
  summarizeSchemaDiffOperations,
  tableIdentityKey,
  validateSchemaSnapshot,
} from "./schema/diff/index.ts";
export type {
  AthenaSchemaSnapshot,
  DiffSchemasInput,
  DiffSchemasOptions,
  SchemaColumn,
  SchemaColumnType,
  SchemaDiff,
  SchemaDiffErrorCode,
  SchemaDiffOperation,
  SchemaDiffOperationKind,
  SchemaDiffSummary,
  SchemaForeignKey,
  SchemaIndex,
  SchemaNamespace,
  SchemaPrimaryKey,
  SchemaReferentialAction,
  SchemaSnapshotFromIntrospectionOptions,
  SchemaSnapshotFromModelsOptions,
  SchemaTable,
  SchemaTableIdentity,
  SchemaUniqueConstraint,
} from "./schema/diff/index.ts";
export { identifier } from "./sql-identifiers.ts";
export type {
  AthenaStorageBackupNamespace,
  StorageBackupCreateRequest,
  StorageBackupJob,
  StorageBackupListPage,
  StorageBackupQueuedJob,
  StorageBackupRecord,
  StorageBackupSchedule,
} from "./storage/module.ts";
export {
  AthenaStorageError,
  AthenaStorageErrorCode,
  createAthenaStorageError,
  requireStorageManifestRoute,
  storageLiveHttpRoutes,
  storageSdkManifest,
} from "./storage/module.ts";
export type {
  AthenaAuthConfig,
  AthenaBillingConfig,
  AthenaChatConfig,
  AthenaClient,
  AthenaClientConfig,
  AthenaClientConfigWithR2,
  AthenaClientWithR2Storage,
  AthenaConfigurationErrorCode,
  AthenaDbConfig,
  AthenaRequestContext,
  AthenaRequestContextProvider,
  AthenaService,
  AthenaStorageConfig,
} from "./v3-client-core.ts";
// Athena client (browser-safe core — no Node `pg` dependency graph).
export { AthenaConfigurationError } from "./v3-client-core.ts";

import type { R2BucketLike } from "./cloudflare/types.ts";
import type { AthenaClientModelsInput } from "./schema/types.ts";
import {
  type AthenaClient as AthenaBrowserClient,
  type AthenaClientConfig as AthenaBrowserClientConfig,
  type AthenaClientConfigWithR2 as AthenaBrowserClientConfigWithR2,
  type AthenaClientWithR2Storage as AthenaBrowserClientWithR2Storage,
  assertDirectPostgresRequiresNodeRuntime,
  assertLocalAuthRequiresNodeRuntime,
  createClient as createUniversalClient,
} from "./v3-client-core.ts";

/**
 * Browser `createClient`: identical to the root entry, except direct
 * PostgreSQL (`db.pgUri`) is a Node/server-only feature and fails fast with
 * `ATHENA_POSTGRES_DIRECT_NODE_REQUIRED` instead of bundling `pg`.
 */
export function createClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(
  config:
    | (AthenaBrowserClientConfig<TModels> & { r2: R2BucketLike })
    | AthenaBrowserClientConfigWithR2<TModels>
): AthenaBrowserClientWithR2Storage<TModels>;
export function createClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(config: AthenaBrowserClientConfig<TModels>): AthenaBrowserClient<TModels>;
export function createClient<
  const TModels extends AthenaClientModelsInput | undefined = undefined,
>(
  config: AthenaBrowserClientConfig<TModels>
): AthenaBrowserClient<TModels> | AthenaBrowserClientWithR2Storage<TModels> {
  assertDirectPostgresRequiresNodeRuntime(config);
  assertLocalAuthRequiresNodeRuntime(config);
  const factory = createUniversalClient as unknown as (c: unknown) => unknown;
  return factory(config) as
    | AthenaBrowserClient<TModels>
    | AthenaBrowserClientWithR2Storage<TModels>;
}

import type {
  AthenaGeneratorConfig,
  GeneratedArtifacts,
  GeneratorExperimentalFlags,
  GeneratorProviderConfig,
  LoadedGeneratorConfig,
  LoadGeneratorConfigOptions,
  NormalizedAthenaGeneratorConfig,
  RunGeneratorOptions,
  RunGeneratorResult,
} from "./generator/types.ts";
import type { PostgresIntrospectionProviderOptions } from "./schema/postgres-provider.ts";
import type {
  IntrospectionSnapshot,
  SchemaIntrospectionProvider,
} from "./schema/types.ts";

function throwBrowserUnsupported(apiName: string): never {
  throw new Error(
    `@xylex-group/athena: ${apiName} is not available in browser bundles. Use this API in a Node.js runtime.`
  );
}

export function createPostgresIntrospectionProvider(
  options: PostgresIntrospectionProviderOptions
): SchemaIntrospectionProvider {
  void options;
  return throwBrowserUnsupported("createPostgresIntrospectionProvider");
}

export function defineAthenaConfig<TConfig extends AthenaGeneratorConfig>(
  config: TConfig
): TConfig {
  return config;
}

/** @deprecated Prefer {@link defineAthenaConfig}. Alias through 5.0 (AD-003). */
export const defineGeneratorConfig = defineAthenaConfig;

export function findGeneratorConfigPath(cwd?: string): string | undefined {
  void cwd;
  return throwBrowserUnsupported("findGeneratorConfigPath");
}

export async function loadGeneratorConfig(
  options: LoadGeneratorConfigOptions = {}
): Promise<LoadedGeneratorConfig> {
  void options;
  return throwBrowserUnsupported("loadGeneratorConfig");
}

export function normalizeGeneratorConfig(
  input: AthenaGeneratorConfig
): NormalizedAthenaGeneratorConfig {
  void input;
  return throwBrowserUnsupported("normalizeGeneratorConfig");
}

export function generateArtifactsFromSnapshot(
  snapshot: IntrospectionSnapshot,
  config: AthenaGeneratorConfig | NormalizedAthenaGeneratorConfig
): GeneratedArtifacts {
  void snapshot;
  void config;
  return throwBrowserUnsupported("generateArtifactsFromSnapshot");
}

export function resolveGeneratorProvider(
  providerConfig: GeneratorProviderConfig,
  experimentalFlags: GeneratorExperimentalFlags
): SchemaIntrospectionProvider {
  void providerConfig;
  void experimentalFlags;
  return throwBrowserUnsupported("resolveGeneratorProvider");
}

export function applyGeneratorProjectEnv(cwd: string): () => void {
  void cwd;
  return throwBrowserUnsupported("applyGeneratorProjectEnv");
}

export function detectAuthorityMode(
  preferred: "direct" | "gateway" | "auto" = "auto"
): "direct" | "gateway" {
  void preferred;
  return throwBrowserUnsupported("detectAuthorityMode");
}

export function formatSchemaFallbackMessages(options: {
  discoveryError?: string;
  schemas: readonly string[];
  expectedLiveSchemas?: readonly string[];
}): string[] {
  void options;
  return throwBrowserUnsupported("formatSchemaFallbackMessages");
}

export function resolveGeneratorDatabaseAuthority(options: {
  applyProjectEnv?: boolean;
  cwd?: string;
  loaded?: LoadedGeneratorConfig;
  mode?: "direct" | "gateway" | "auto";
  provider?: GeneratorProviderConfig;
}): {
  mode: "direct" | "gateway";
  provider: GeneratorProviderConfig;
  restoreEnv: () => void;
  source: "explicit-provider" | "loaded-config" | "environment-probe";
} {
  void options;
  return throwBrowserUnsupported("resolveGeneratorDatabaseAuthority");
}

export async function runSchemaGenerator(
  options: RunGeneratorOptions = {}
): Promise<RunGeneratorResult> {
  void options;
  return throwBrowserUnsupported("runSchemaGenerator");
}

export type {
  AthenaAdminEmailCreateRequest,
  AthenaAdminEmailDeleteRequest,
  AthenaAdminEmailEventTypeListResponse,
  AthenaAdminEmailEventTypeRecord,
  AthenaAdminEmailFailureCreateRequest,
  AthenaAdminEmailFailureDeleteRequest,
  AthenaAdminEmailFailureGetQuery,
  AthenaAdminEmailFailureGetResponse,
  AthenaAdminEmailFailureListQuery,
  AthenaAdminEmailFailureListResponse,
  AthenaAdminEmailFailureUpdateRequest,
  AthenaAdminEmailFailureUpdateResponse,
  AthenaAdminEmailGetQuery,
  AthenaAdminEmailGetResponse,
  AthenaAdminEmailListQuery,
  AthenaAdminEmailListResponse,
  AthenaAdminEmailTemplateCreateRequest,
  AthenaAdminEmailTemplateDeleteRequest,
  AthenaAdminEmailTemplateGetQuery,
  AthenaAdminEmailTemplateGetResponse,
  AthenaAdminEmailTemplateListQuery,
  AthenaAdminEmailTemplateListResponse,
  AthenaAdminEmailTemplateRecord,
  AthenaAdminEmailTemplateSendRequest,
  AthenaAdminEmailTemplateSendResponse,
  AthenaAdminEmailTemplateUpdateRequest,
  AthenaAdminEmailUpdateRequest,
  AthenaAdminEmailUpdateResponse,
  AthenaAuthAdminLimits,
  AthenaAuthAdminUserSessionRevokeBinding,
  AthenaAuthBindings,
  AthenaAuthHttpHandlers,
  AthenaAuthServerBindings,
  AthenaAuthCallOptions,
  AthenaAuthClientConfig,
  AthenaAuthCredentials,
  AthenaAuthEmailChangeResponse,
  AthenaAuthEmailTemplateAttachment,
  AthenaAuthEmailTemplateBuilder,
  AthenaAuthEmailTemplateCreateFromDefinitionInput,
  AthenaAuthEmailTemplateDefinition,
  AthenaAuthEmailTemplateReactOverrides,
  AthenaAuthEmailTemplateUpdateFromDefinitionInput,
  AthenaAuthEmailTemplateVariableBinding,
  AthenaAuthEndpointPath,
  AthenaAuthErrorCode,
  AthenaAuthErrorDetails,
  AthenaAuthGenericInput,
  AthenaAuthGenericQueryInput,
  AthenaAuthGetUserResponse,
  AthenaAuthLinkedAccount,
  AthenaAuthMethod,
  AthenaAuthOrganization,
  AthenaAuthOrganizationBindings,
  AthenaAuthOrganizationInvitation,
  AthenaAuthOrganizationMember,
  AthenaAuthQueryPrimitive,
  AthenaAuthQueryValue,
  AthenaAuthReactEmailComponent,
  AthenaAuthReactEmailConfig,
  AthenaAuthReactEmailEventPhase,
  AthenaAuthReactEmailProps,
  AthenaAuthReactEmailRenderEvent,
  AthenaAuthReactEmailRenderInput,
  AthenaAuthReactEmailRenderOptions,
  AthenaAuthRequestInput,
  AthenaAuthResetPasswordBinding,
  AthenaAuthResult,
  AthenaAuthRevokeSessionRequest,
  AthenaAuthSession,
  AthenaAuthSessionResponse,
  AthenaAuthSessionRevokeBinding,
  AthenaAuthSignInResponse,
  AthenaAuthSignOutResponse,
  AthenaAuthSocialRedirectResponse,
  AthenaAuthStatusResponse,
  AthenaAuthUser,
  AthenaChangeEmailRequest,
  AthenaChangePasswordRequest,
  AthenaDeleteUserCallbackRequest,
  AthenaDeleteUserRequest,
  AthenaDeleteUserResponse,
  AthenaEmailSignInRequest,
  AthenaEmailSignUpRequest,
  AthenaForgetPasswordRequest,
  AthenaLinkSocialRequest,
  AthenaOAuthAccountTokenRequest,
  AthenaOAuthTokenBundle,
  AthenaResetPasswordRequest,
  AthenaSendVerificationEmailRequest,
  AthenaSocialSignInRequest,
  AthenaUnlinkAccountRequest,
  AthenaUpdateUserRequest,
  AthenaUsernameSignInRequest,
  AthenaVerifyEmailRequest,
  AuthBindings,
} from "./auth/index.ts";
export type {
  AthenaErrorInput,
  AthenaOperationContext,
  IntCoercionOptions,
  NormalizedAthenaError,
  RequireAffectedOptions,
  RetryBackoffStrategy,
  RetryConfig,
  UnwrapOneOptions,
  UnwrapOptions,
} from "./auxiliaries.js";
export type * from "./chat/types.js";
export type {
  AthenaFromOptions,
  AthenaRequestMethod,
  AthenaRequestOptions,
  AthenaRequestQueryValueMap,
  AthenaRequestResponse,
  AthenaRequestService,
  AthenaResult,
  RpcOrderOptions,
  RpcQueryBuilder,
  TableQueryBuilder,
} from "./client.js";
export type {
  AthenaDbModule,
  AthenaTransactionClient,
} from "./db/module.js";
export {
  AthenaTransactionError,
  isAthenaTransactionError,
} from "./db/transaction/index.ts";
export type {
  AthenaExecutableOutput,
  AthenaTransactionBackend,
  AthenaTransactionCapabilities,
  AthenaTransactionErrorCode,
  AthenaTransactionIsolationLevel,
  AthenaTransactionOptions,
  AthenaTransactionResults,
} from "./db/transaction/index.ts";
export type {
  AthenaConditionCastType,
  AthenaGatewayCallOptions,
  AthenaGatewayConnectionOptions,
  AthenaGatewayConnectionResult,
  AthenaGatewayErrorCode,
  AthenaGatewayErrorDetails,
  AthenaJsonArray,
  AthenaJsonObject,
  AthenaJsonPrimitive,
  AthenaJsonValue,
  AthenaRpcCallOptions,
  AthenaRpcFilter,
  AthenaRpcFilterOperator,
  AthenaRpcOrder,
  AthenaRpcPayload,
  BackendConfig,
  BackendType,
} from "./gateway/types.js";
export type {
  AthenaGeneratorConfig,
  GeneratedArtifact,
  GeneratedArtifacts,
  GeneratorArtifactKind,
  GeneratorExperimentalFlags,
  GeneratorFeatureFlags,
  GeneratorFilterConfig,
  GeneratorInternalConfig,
  GeneratorNamingConfig,
  GeneratorOutputConfig,
  GeneratorOutputFormat,
  GeneratorOutputPreset,
  GeneratorOutputTargets,
  GeneratorProviderConfig,
  GeneratorSchemaSelection,
  GeneratorTableSelection,
  LoadedGeneratorConfig,
  LoadGeneratorConfigOptions,
  NamingStyle,
  NormalizedAthenaGeneratorConfig,
  NormalizedGeneratorFilterConfig,
  NormalizedGeneratorOutputConfig,
  RunGeneratorOptions,
  RunGeneratorResult,
  SkippedGeneratedArtifact,
  SkippedGeneratedArtifactReason,
} from "./generator/index.ts";
export type {
  AthenaDeleteDebugAst,
  AthenaFindManyDebugAst,
  AthenaInsertDebugAst,
  AthenaQueryDebugAst,
  AthenaRawQueryDebugAst,
  AthenaRpcBuilderStateAst,
  AthenaRpcDebugAst,
  AthenaSelectDebugAst,
  AthenaSelectDebugTransport,
  AthenaTableBuilderStateAst,
  AthenaUpdateDebugAst,
  AthenaUpsertDebugAst,
} from "./query-debug-ast.ts";
export type {
  AnyColumnBuilder,
  AthenaColumnBuilder,
  AthenaModelTarget,
  AthenaTableDef,
  AthenaTableSchemaBundle,
  ColumnRuntimeConfig,
  DatabaseDef,
  FormValuesFromColumns,
  FormValuesOf,
  InsertFromColumns,
  InsertOf,
  IntrospectionColumn,
  IntrospectionInspectOptions,
  IntrospectionRelation,
  IntrospectionSchema,
  IntrospectionSnapshot,
  IntrospectionTable,
  IntrospectionTypeKind,
  ModelAt,
  ModelColumnKind,
  ModelColumnMetadata,
  ModelDef,
  ModelFormAdapter,
  ModelFormDefaults,
  ModelFormNullishMode,
  ModelFormValues,
  ModelMetadata,
  ModelRelationKind,
  ModelRelationMetadata,
  PostgresIntrospectionProviderOptions,
  RegistryDef,
  RowFromColumns,
  RowOf,
  SchemaDef,
  SchemaIntrospectionProvider,
  TenantContext,
  TenantContextValue,
  TenantKeyMap,
  ToModelFormDefaultsOptions,
  ToModelPayloadOptions,
  UpdateFromColumns,
  UpdateOf,
} from "./schema/index.ts";
export type {
  AthenaStorageEnv,
  AthenaStorageFileConfig,
  AthenaStorageFileDeleteInput,
  AthenaStorageFileDownloadInput,
  AthenaStorageFileListInput,
  AthenaStorageFileModule,
  AthenaStorageFileUploadInput,
  AthenaStorageFileUploadResult,
  AthenaStoragePathContext,
  AthenaStoragePrefixPath,
  AthenaStorageTemplateValue,
  AthenaStorageTemplateVars,
  AthenaStorageUploadConstraints,
  AthenaStorageUploadedFile,
  AthenaStorageUploadProgress,
  AthenaStorageUploadProgressHandler,
  AthenaStorageUploadSource,
} from "./storage/file.js";
// Keep value exports aligned with root `index.ts` so browser condition consumers
// can import storage path helpers and multipart defaults without Node-only paths.
export {
  createStorageFileModule,
  DEFAULT_MULTIPART_PART_SIZE_BYTES,
  DEFAULT_MULTIPART_THRESHOLD_BYTES,
  resolveStoragePath,
} from "./storage/file.js";
export type * from "./storage/module.js";
export type {
  AthenaEnvelope,
  AthenaStorageBinaryCallOptions,
  AthenaStorageCallOptions,
  AthenaStorageClientConfig,
  AthenaStorageErrorDetails,
  AthenaStorageErrorHandler,
  AthenaStorageErrorInput,
  AthenaStorageModule,
  CreateStorageCatalogRequest,
  CreateStorageUploadUrlRequest,
  CreateStorageUploadUrlsRequest,
  DeleteStorageFolderRequest,
  GetStorageFileUrlQuery,
  ListStorageFilesRequest,
  ManagedFileRecord,
  MoveStorageFolderRequest,
  PresignedFileUrlResponse,
  S3CatalogItem,
  S3CredentialListItem,
  SetStorageFileVisibilityRequest,
  StorageBatchUploadUrlResponse,
  StorageFileAccessPurpose,
  StorageFileMutationResponse,
  StorageFolderMutationResponse,
  StorageListFilesResponse,
  StorageUploadUrlResponse,
  UpdateStorageCatalogRequest,
  UpdateStorageFileRequest,
} from "./storage/module.js";
export type {
  AthenaTableCatalogColumn,
  AthenaTableCatalogQueryClient,
  AthenaTableCatalogRelation,
  AthenaTableCatalogResponse,
  AthenaTableCatalogTable,
  AthenaTableSchemaConfig,
  AthenaTableSchemaHandlerOptions,
  AthenaTableShowcaseConfig,
  FetchAthenaTableCatalogOptions,
  TableCatalogColumn,
  TableCatalogRelation,
  TableCatalogResponse,
  TableCatalogTable,
} from "./tables/index.ts";
// Table schema catalog + App Router handlers (`/api/tables/schema`)
export {
  ATHENA_TABLE_SCHEMA_ROUTE,
  buildAthenaTableCatalogQueries,
  createAthenaTableSchemaHandlers,
  fetchAthenaTableCatalog,
  fetchTableCatalog,
  handleAthenaTableSchemaPost,
  hasAthenaTableSchemaCredentials,
  isAthenaTableSchemaConfig,
  parseAthenaTableSchemaScope,
} from "./tables/index.ts";
