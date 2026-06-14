/**
 * athena-js browser entry
 *
 * Keeps the root package import browser-safe by avoiding Node-only modules
 * while preserving the existing export surface.
 */

// Athena client
export { createClient, AthenaClient } from './client.js'
export { Backend } from './gateway/types.js'
export { AthenaGatewayError, isAthenaGatewayError } from './gateway/errors.ts'
export { verifyAthenaGatewayUrl } from './gateway/client.ts'
export { normalizeAthenaGatewayBaseUrl } from './gateway/url.ts'
export {
  isOk,
  unwrap,
  unwrapRows,
  unwrapOne,
  requireSuccess,
  requireAffected,
  parseBooleanFlag,
  normalizeAthenaError,
  coerceInt,
  assertInt,
  withRetry,
  AthenaError,
  AthenaErrorCode,
  AthenaErrorKind,
  AthenaErrorCategory,
} from './auxiliaries.js'
export { identifier } from './sql-identifiers.ts'
export {
  defineDatabase,
  defineModel,
  defineRegistry,
  defineSchema,
} from './schema/definitions.ts'
export { createTypedClient } from './schema/typed-client.ts'
export {
  createModelFormAdapter,
  toModelFormDefaults,
  toModelPayload,
} from './schema/model-form.ts'
export {
  DEFAULT_POSTGRES_SCHEMAS,
  normalizeSchemaSelection,
  resolveProviderSchemas,
} from './generator/schema-selection.ts'
export { generatorEnv } from './generator/env.ts'
export { resolvePostgresColumnType } from './generator/postgres-type-mapping.ts'
export {
  ATHENA_AUTH_BASE_ERROR_CODES,
  athenaAuth,
  createAuthClient,
  defineAthenaAuthConfig,
  renderAthenaReactEmail,
  createAuthReactEmailInput,
  defineAuthEmailTemplate,
} from './auth/index.ts'
export { storageSdkManifest, AthenaStorageError } from './storage/module.ts'

import type {
  PostgresIntrospectionProviderOptions,
} from './schema/postgres-provider.ts'
import type { IntrospectionSnapshot, SchemaIntrospectionProvider } from './schema/types.ts'
import type {
  AthenaGeneratorConfig,
  GeneratedArtifacts,
  GeneratorExperimentalFlags,
  GeneratorProviderConfig,
  LoadGeneratorConfigOptions,
  LoadedGeneratorConfig,
  NormalizedAthenaGeneratorConfig,
  RunGeneratorOptions,
  RunGeneratorResult,
} from './generator/types.ts'

function throwBrowserUnsupported(apiName: string): never {
  throw new Error(
    `@xylex-group/athena: ${apiName} is not available in browser bundles. Use this API in a Node.js runtime.`,
  )
}

export function createPostgresIntrospectionProvider(
  options: PostgresIntrospectionProviderOptions,
): SchemaIntrospectionProvider {
  void options
  return throwBrowserUnsupported('createPostgresIntrospectionProvider')
}

export function defineGeneratorConfig<TConfig extends AthenaGeneratorConfig>(
  config: TConfig,
): TConfig {
  return config
}

export function findGeneratorConfigPath(cwd?: string): string | undefined {
  void cwd
  return throwBrowserUnsupported('findGeneratorConfigPath')
}

export async function loadGeneratorConfig(
  options: LoadGeneratorConfigOptions = {},
): Promise<LoadedGeneratorConfig> {
  void options
  return throwBrowserUnsupported('loadGeneratorConfig')
}

export function normalizeGeneratorConfig(
  input: AthenaGeneratorConfig,
): NormalizedAthenaGeneratorConfig {
  void input
  return throwBrowserUnsupported('normalizeGeneratorConfig')
}

export function generateArtifactsFromSnapshot(
  snapshot: IntrospectionSnapshot,
  config: AthenaGeneratorConfig | NormalizedAthenaGeneratorConfig,
): GeneratedArtifacts {
  void snapshot
  void config
  return throwBrowserUnsupported('generateArtifactsFromSnapshot')
}

export function resolveGeneratorProvider(
  providerConfig: GeneratorProviderConfig,
  experimentalFlags: GeneratorExperimentalFlags,
): SchemaIntrospectionProvider {
  void providerConfig
  void experimentalFlags
  return throwBrowserUnsupported('resolveGeneratorProvider')
}

export async function runSchemaGenerator(
  options: RunGeneratorOptions = {},
): Promise<RunGeneratorResult> {
  void options
  return throwBrowserUnsupported('runSchemaGenerator')
}

export type {
  AthenaClientExperimentalOptions,
  AthenaFromOptions,
  RpcQueryBuilder,
  RpcOrderOptions,
  AthenaCreateClientOptions,
  AthenaSdkClient,
  AthenaSdkClientWithAuth,
  AthenaSdkClientWithStorage,
  TableQueryBuilder,
  AthenaResult,
  AthenaCreateClientOptionsWithStorage,
} from './client.js'
export type { AthenaDbModule } from './db/module.js'
export type {
  AthenaEnvelope,
  AthenaStorageCallOptions,
  AthenaStorageErrorCode,
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
  StorageFileMutationResponse,
  StorageFolderMutationResponse,
  StorageListFilesResponse,
  StorageUploadUrlResponse,
  UpdateStorageCatalogRequest,
  UpdateStorageFileRequest,
} from './storage/module.js'
export type {
  AthenaErrorInput,
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
  DatabaseDef,
  InsertOf,
  IntrospectionColumn,
  IntrospectionInspectOptions,
  IntrospectionRelation,
  IntrospectionSchema,
  IntrospectionSnapshot,
  IntrospectionTable,
  IntrospectionTypeKind,
  ModelAt,
  ModelDef,
  ModelMetadata,
  ModelRelationKind,
  ModelRelationMetadata,
  PostgresIntrospectionProviderOptions,
  RegistryDef,
  RowOf,
  SchemaDef,
  SchemaIntrospectionProvider,
  ModelFormAdapter,
  ModelFormDefaults,
  ModelFormNullishMode,
  ModelFormValues,
  TenantContext,
  TenantContextValue,
  TenantKeyMap,
  ToModelFormDefaultsOptions,
  ToModelPayloadOptions,
  TypedAthenaClient,
  TypedClientOptions,
  UpdateOf,
} from './schema/index.ts'
export type {
  AthenaGeneratorConfig,
  GeneratedArtifact,
  GeneratedArtifacts,
  GeneratorArtifactKind,
  GeneratorExperimentalFlags,
  GeneratorFeatureFlags,
  GeneratorNamingConfig,
  GeneratorOutputConfig,
  GeneratorOutputTargets,
  GeneratorProviderConfig,
  GeneratorSchemaSelection,
  LoadGeneratorConfigOptions,
  LoadedGeneratorConfig,
  NamingStyle,
  NormalizedAthenaGeneratorConfig,
  RunGeneratorOptions,
  RunGeneratorResult,
} from './generator/index.ts'
export type {
  AthenaAuthQueryPrimitive,
  AthenaAuthQueryValue,
  AthenaAuthCredentials,
  AthenaAuthCallOptions,
  AthenaAuthClientConfig,
  AthenaAuthEndpointPath,
  AthenaAuthErrorCode,
  AthenaAuthErrorDetails,
  AthenaAuthRequestInput,
  AthenaAuthMethod,
  AthenaAuthResult,
  AthenaAuthBindings,
  AthenaAuthStatusResponse,
  AthenaAuthRevokeSessionRequest,
  AthenaAuthSessionRevokeBinding,
  AthenaAuthAdminUserSessionRevokeBinding,
  AthenaAuthResetPasswordBinding,
  AthenaAuthGenericInput,
  AthenaAuthGenericQueryInput,
  AthenaAuthSdkClient,
  AthenaAuthSocialRedirectResponse,
  AthenaAuthEmailChangeResponse,
  AthenaAuthLinkedAccount,
  AthenaAuthOrganization,
  AthenaAuthOrganizationMember,
  AthenaAuthOrganizationInvitation,
  AthenaAuthOrganizationBindings,
  AthenaOAuthTokenBundle,
  AthenaOAuthAccountTokenRequest,
  AthenaForgetPasswordRequest,
  AthenaResetPasswordRequest,
  AthenaVerifyEmailRequest,
  AthenaSendVerificationEmailRequest,
  AthenaChangeEmailRequest,
  AthenaChangePasswordRequest,
  AthenaUpdateUserRequest,
  AthenaDeleteUserRequest,
  AthenaDeleteUserCallbackRequest,
  AthenaDeleteUserResponse,
  AthenaAuthReactEmailProps,
  AthenaAuthReactEmailComponent,
  AthenaAuthReactEmailRenderInput,
  AthenaAuthReactEmailRenderOptions,
  AthenaAuthReactEmailConfig,
  AthenaAuthReactEmailEventPhase,
  AthenaAuthReactEmailRenderEvent,
  AthenaAuthEmailTemplateDefinition,
  AthenaAuthEmailTemplateReactOverrides,
  AthenaAuthEmailTemplateCreateFromDefinitionInput,
  AthenaAuthEmailTemplateUpdateFromDefinitionInput,
  AthenaAuthEmailTemplateBuilder,
  AthenaLinkSocialRequest,
  AthenaUnlinkAccountRequest,
  AthenaAuthSession,
  AthenaAuthSessionResponse,
  AthenaSocialSignInRequest,
  AthenaUsernameSignInRequest,
  AthenaAuthSignInResponse,
  AthenaAuthSignOutResponse,
  AthenaAuthUser,
  AthenaEmailSignInRequest,
  AthenaEmailSignUpRequest,
} from './auth/index.ts'
export type {
  AthenaJsonPrimitive,
  AthenaJsonValue,
  AthenaJsonObject,
  AthenaJsonArray,
  AthenaConditionCastType,
  AthenaRpcCallOptions,
  AthenaRpcFilter,
  AthenaRpcFilterOperator,
  AthenaRpcOrder,
  AthenaRpcPayload,
  AthenaGatewayErrorCode,
  AthenaGatewayErrorDetails,
  AthenaGatewayConnectionOptions,
  AthenaGatewayConnectionResult,
  BackendType,
  BackendConfig,
  AthenaGatewayCallOptions,
} from './gateway/types.js'
