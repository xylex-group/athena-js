import type { AthenaGatewayClient } from '../gateway/client.ts'
import type {
  AthenaGatewayCallOptions,
  AthenaGatewayEndpointPath,
  AthenaGatewayErrorCode,
  AthenaGatewayMethod,
} from '../gateway/types.ts'
import type {
  AthenaErrorCategory,
  AthenaErrorCode,
  AthenaErrorKind,
  NormalizedAthenaError,
} from '../auxiliaries.ts'
import { normalizeAthenaError } from '../auxiliaries.ts'
import { isAthenaGatewayError } from '../gateway/errors.ts'
import { buildAthenaGatewayUrl, normalizeAthenaGatewayBaseUrl } from '../gateway/url.ts'
import { createStorageFileModule } from './file.ts'
import type { AthenaStorageFileConfig, AthenaStorageFileModule } from './file.ts'

export const storageSdkManifest = {
  namespace: 'storage',
  basePath: '/storage',
  envelopeKinds: {
    raw: 'response body is the payload',
    athena: 'response body is { status, message, data }',
  },
  methods: [
    {
      name: 'listStorageCatalogs',
      method: 'GET',
      path: '/storage/catalogs',
      responseEnvelope: 'raw',
      responseType: '{ data: S3CatalogItem[] }',
    },
    {
      name: 'createStorageCatalog',
      method: 'POST',
      path: '/storage/catalogs',
      requestType: 'CreateStorageCatalogRequest',
      responseEnvelope: 'raw',
      responseType: 'S3CatalogItem',
    },
    {
      name: 'updateStorageCatalog',
      method: 'PATCH',
      path: '/storage/catalogs/{id}',
      pathParams: ['id'],
      requestType: 'UpdateStorageCatalogRequest',
      responseEnvelope: 'raw',
      responseType: 'S3CatalogItem',
    },
    {
      name: 'deleteStorageCatalog',
      method: 'DELETE',
      path: '/storage/catalogs/{id}',
      pathParams: ['id'],
      responseEnvelope: 'raw',
      responseType: '{ id: string; deleted: boolean }',
    },
    {
      name: 'listStorageCredentials',
      method: 'GET',
      path: '/storage/credentials',
      responseEnvelope: 'raw',
      responseType: '{ data: S3CredentialListItem[] }',
    },
    {
      name: 'createStorageUploadUrl',
      method: 'POST',
      path: '/storage/files/upload-url',
      requestType: 'CreateStorageUploadUrlRequest',
      responseEnvelope: 'athena',
      responseType: 'StorageUploadUrlResponse',
    },
    {
      name: 'createStorageUploadUrls',
      method: 'POST',
      path: '/storage/files/upload-urls',
      requestType: 'CreateStorageUploadUrlsRequest',
      responseEnvelope: 'athena',
      responseType: 'StorageBatchUploadUrlResponse',
    },
    {
      name: 'listStorageFiles',
      method: 'POST',
      path: '/storage/files/list',
      requestType: 'ListStorageFilesRequest',
      responseEnvelope: 'athena',
      responseType: 'StorageListFilesResponse',
    },
    {
      name: 'getStorageFile',
      method: 'GET',
      path: '/storage/files/{file_id}',
      pathParams: ['file_id'],
      responseEnvelope: 'athena',
      responseType: 'StorageFileMutationResponse',
    },
    {
      name: 'getStorageFileUrl',
      method: 'GET',
      path: '/storage/files/{file_id}/url',
      pathParams: ['file_id'],
      queryParams: ['purpose'],
      responseEnvelope: 'athena',
      responseType: 'PresignedFileUrlResponse',
    },
    {
      name: 'getStorageFileProxy',
      method: 'GET',
      path: '/storage/files/{file_id}/proxy',
      pathParams: ['file_id'],
      queryParams: ['purpose'],
      responseEnvelope: 'raw',
      responseType: 'Response',
      binary: true,
    },
    {
      name: 'updateStorageFile',
      method: 'PATCH',
      path: '/storage/files/{file_id}',
      pathParams: ['file_id'],
      requestType: 'UpdateStorageFileRequest',
      responseEnvelope: 'athena',
      responseType: 'StorageFileMutationResponse',
    },
    {
      name: 'deleteStorageFile',
      method: 'DELETE',
      path: '/storage/files/{file_id}',
      pathParams: ['file_id'],
      responseEnvelope: 'athena',
      responseType: 'StorageFileMutationResponse',
    },
    {
      name: 'setStorageFileVisibility',
      method: 'PATCH',
      path: '/storage/files/{file_id}/visibility',
      pathParams: ['file_id'],
      requestType: 'SetStorageFileVisibilityRequest',
      responseEnvelope: 'athena',
      responseType: 'StorageFileMutationResponse',
    },
    {
      name: 'deleteStorageFolder',
      method: 'POST',
      path: '/storage/folders/delete',
      requestType: 'DeleteStorageFolderRequest',
      responseEnvelope: 'athena',
      responseType: 'StorageFolderMutationResponse',
    },
    {
      name: 'moveStorageFolder',
      method: 'POST',
      path: '/storage/folders/move',
      requestType: 'MoveStorageFolderRequest',
      responseEnvelope: 'athena',
      responseType: 'StorageFolderMutationResponse',
    },
  ],
} as const

export interface S3CatalogItem {
  id: string
  name: string
  endpoint?: string | null
  region?: string | null
  bucket: string
  provider: string
  force_path_style: boolean
  default_prefix?: string | null
  public_base_url?: string | null
  is_active: boolean
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface S3CredentialListItem {
  id: string
  s3_id: string
  name: string
  endpoint?: string | null
  region?: string | null
  bucket: string
  provider: string
  access_key: string
  is_active: boolean
  created_at: string
  rotated_at?: string | null
}

export interface ManagedFileRecord {
  id: string
  name: string
  original_name?: string | null
  file_name?: string | null
  url?: string | null
  bucket: string
  s3_id?: string | null
  prefix_path?: string | null
  size_bytes?: number | null
  mime_type?: string | null
  content_type?: string | null
  resource_id?: string | null
  organization_id?: string | null
  created_by_user_id?: string | null
  uploaded_by_user_id?: string | null
  checksum_sha256?: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  storage_key: string
  extension?: string | null
  visibility?: 'private' | 'organization' | 'public'
  is_public: boolean
  status: string
  deleted_at?: string | null
}

export interface PresignedFileUrlResponse {
  file_id: string
  bucket: string
  storage_key: string
  purpose: string
  url: string
  expires_at: string
  expires_at_epoch_seconds: number
  expires_in: number
  cache_hit: boolean
  cache_layer: string
}

export interface CreateStorageCatalogRequest {
  name: string
  endpoint: string
  region: string
  bucket: string
  provider?: string
  force_path_style?: boolean
  default_prefix?: string
  public_base_url?: string
  access_key_id: string
  secret_key: string
  session_token?: string
  metadata?: Record<string, unknown>
}

export interface UpdateStorageCatalogRequest {
  name?: string
  endpoint?: string
  region?: string
  bucket?: string
  provider?: string
  force_path_style?: boolean
  default_prefix?: string | null
  public_base_url?: string | null
  access_key_id?: string
  secret_key?: string
  session_token?: string
  is_active?: boolean
  metadata?: Record<string, unknown>
}

export interface CreateStorageUploadUrlRequest {
  s3_id: string
  bucket?: string
  storage_key: string
  name?: string
  original_name?: string
  resource_id?: string
  mime_type?: string
  content_type?: string
  size_bytes?: number
  file_id?: string
  public?: boolean
  visibility?: 'private' | 'organization' | 'public'
  metadata?: Record<string, unknown>
}

export interface CreateStorageUploadUrlsRequest {
  files: CreateStorageUploadUrlRequest[]
}

export interface StorageUploadUrlResponse {
  file: ManagedFileRecord
  upload: PresignedFileUrlResponse
}

export interface StorageBatchUploadUrlResponse {
  files: StorageUploadUrlResponse[]
}

export interface ListStorageFilesRequest {
  s3_id: string
  prefix: string
}

export interface StorageListFilesResponse {
  files: ManagedFileRecord[]
  count: number
}

export interface UpdateStorageFileRequest {
  storage_key: string
  bucket?: string
}

export interface SetStorageFileVisibilityRequest {
  public?: boolean
  visibility?: 'private' | 'organization' | 'public'
}

export interface DeleteStorageFolderRequest {
  s3_id: string
  prefix: string
}

export interface MoveStorageFolderRequest {
  s3_id: string
  from_prefix: string
  to_prefix: string
}

export interface StorageFileMutationResponse {
  file: ManagedFileRecord
}

export interface StorageFolderMutationResponse {
  s3_id: string
  prefix: string
  processed_files: number
}

export interface StorageFileMutationManyResponse {
  files: ManagedFileRecord[]
  count: number
}

export interface StorageFilePermissionRecord {
  id: string
  file_id: string
  principal_type: 'user' | 'organization' | 'team' | 'role'
  principal_id: string
  permission: 'read' | 'write' | 'delete' | 'share' | 'owner'
  granted_by_user_id?: string | null
  created_at: string
  expires_at?: string | null
  revoked_at?: string | null
  metadata: Record<string, unknown>
}

export interface StoragePermissionListResponse {
  permissions: StorageFilePermissionRecord[]
  count: number
}

export interface StoragePermissionCheckResponse {
  allowed: boolean
  permission: string
}

export interface StorageAuditEventRecord {
  id: string
  operation: string
  file_id?: string | null
  s3_id?: string | null
  bucket?: string | null
  storage_key?: string | null
  actor_user_id?: string | null
  organization_id?: string | null
  status: 'success' | 'error'
  error?: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface StorageAuditListResponse {
  events: StorageAuditEventRecord[]
  count: number
}

export interface ConfirmStorageUploadRequest {
  size_bytes?: number
  content_type?: string
  checksum_sha256?: string
  metadata?: Record<string, unknown>
}

export interface SearchStorageFilesRequest {
  query?: string
  limit?: number
}

export interface DeleteManyStorageFilesRequest {
  file_ids: string[]
}

export interface UpdateManyStorageFilesRequest {
  file_ids: string[]
  storage_key: string
  bucket?: string
}

export interface SetManyStorageFileVisibilityRequest {
  file_ids: string[]
  public?: boolean
  visibility?: 'private' | 'organization' | 'public'
}

export interface CopyStorageFileRequest {
  storage_key: string
  bucket?: string
  file_name?: string
  visibility?: 'private' | 'organization' | 'public'
  metadata?: Record<string, unknown>
}

export interface ListStorageFoldersRequest {
  s3_id: string
  prefix: string
}

export interface TreeStorageFoldersRequest {
  s3_id: string
  prefix: string
}

export interface StoragePermissionListRequest {
  file_id: string
}

export interface StoragePermissionGrantRequest {
  file_id: string
  principal_type: 'user' | 'organization' | 'team' | 'role'
  principal_id: string
  permission: 'read' | 'write' | 'delete' | 'share' | 'owner'
  expires_at?: string
  metadata?: Record<string, unknown>
}

export interface StoragePermissionRevokeRequest {
  file_id: string
  principal_type: 'user' | 'organization' | 'team' | 'role'
  principal_id: string
  permission: 'read' | 'write' | 'delete' | 'share' | 'owner'
}

export interface StoragePermissionCheckRequest {
  file_id: string
  permission: 'read' | 'write' | 'delete' | 'share' | 'owner'
}

export interface StorageMultipartCreateRequest {
  file_id: string
  content_type?: string
}

export interface StorageMultipartSignPartRequest {
  file_id: string
  upload_id: string
  part_number: number
}

export interface StorageMultipartCompletePartInput {
  part_number: number
  etag: string
}

export interface StorageMultipartCompleteRequest {
  file_id: string
  upload_id: string
  parts: StorageMultipartCompletePartInput[]
}

export interface StorageMultipartAbortRequest {
  file_id: string
  upload_id: string
}

export interface StorageMultipartListPartsRequest {
  file_id: string
  upload_id: string
}

export interface StorageObjectFolderCreateRequest {
  endpoint: string
  region: string
  access_key_id: string
  secret_key: string
  bucket: string
  prefix: string
}

export type StorageObjectFolderDeleteRequest = StorageObjectFolderCreateRequest

export interface StorageObjectFolderRenameRequest extends Omit<StorageObjectFolderCreateRequest, 'prefix'> {
  from_prefix: string
  to_prefix: string
}

export interface StorageObjectBaseRequest {
  endpoint: string
  region: string
  access_key_id: string
  secret_key: string
  bucket: string
}

export interface StorageObjectRequest extends StorageObjectBaseRequest {
  key: string
}

export interface StorageObjectCopyRequest extends StorageObjectBaseRequest {
  source_key: string
  destination_key: string
  destination_bucket?: string
}

export interface StorageObjectPublicUrlRequest extends StorageObjectRequest {
  public_base_url?: string
  force_path_style?: boolean
}

export interface StorageListObjectsRequest extends StorageObjectBaseRequest {
  prefix?: string
  delimiter?: string
  continuation_token?: string
  max_keys?: number
}

export interface StorageUpdateObjectRequest extends StorageObjectRequest {
  acl?: string
  content_type?: string
  cache_control?: string
  content_disposition?: string
  content_encoding?: string
  content_language?: string
  metadata?: Record<string, string>
}

export interface StoragePresignUploadRequest extends StorageObjectRequest {
  content_type?: string
}

export type StorageBucketCorsRequest = StorageObjectBaseRequest

export interface StorageBucketCorsRuleInput {
  allowed_origins: string[]
  allowed_methods: string[]
  allowed_headers?: string[]
  expose_headers?: string[]
  max_age_seconds?: number
}

export interface StorageSetBucketCorsRequest extends StorageBucketCorsRequest {
  rules: StorageBucketCorsRuleInput[]
}

export interface StorageAuditQueryRequest {
  file_id?: string
  limit?: number
  offset?: number
}

export interface AthenaEnvelope<T> {
  status: string
  message: string
  data: T
}

export type StorageFileAccessPurpose = 'read' | 'download' | 'stream'

export interface GetStorageFileUrlQuery {
  purpose?: StorageFileAccessPurpose | (string & {})
}

export type AthenaStorageErrorHandler = (error: AthenaStorageError) => void | Promise<void>

export interface AthenaStorageClientConfig extends AthenaStorageFileConfig {
  onError?: AthenaStorageErrorHandler
}

export interface AthenaStorageCallOptions extends AthenaGatewayCallOptions {
  signal?: AbortSignal
  onError?: AthenaStorageErrorHandler
}

export type AthenaStorageBinaryCallOptions = AthenaStorageCallOptions

export type AthenaStorageErrorCode =
  | 'INVALID_URL'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'INVALID_JSON'
  | 'INVALID_ATHENA_ENVELOPE'
  | 'UNKNOWN_ERROR'

export const AthenaStorageErrorCode = {
  InvalidUrl: 'INVALID_URL',
  NetworkError: 'NETWORK_ERROR',
  HttpError: 'HTTP_ERROR',
  InvalidJson: 'INVALID_JSON',
  InvalidAthenaEnvelope: 'INVALID_ATHENA_ENVELOPE',
  UnknownError: 'UNKNOWN_ERROR',
} as const satisfies Record<string, AthenaStorageErrorCode>

export interface AthenaStorageErrorDetails {
  code: AthenaStorageErrorCode
  athenaCode: AthenaErrorCode
  kind: AthenaErrorKind
  category: AthenaErrorCategory
  retryable: boolean
  message: string
  status: number
  endpoint: AthenaGatewayEndpointPath
  method: AthenaGatewayMethod
  requestId?: string
  hint?: string
  cause?: string
  raw: unknown
}

export interface AthenaStorageErrorInput {
  code: AthenaStorageErrorCode
  message: string
  status: number
  endpoint: AthenaGatewayEndpointPath
  method: AthenaGatewayMethod
  raw?: unknown
  requestId?: string
  hint?: string
  cause?: unknown
}

export class AthenaStorageError extends Error {
  readonly code: AthenaStorageErrorCode
  readonly athenaCode: AthenaErrorCode
  readonly kind: AthenaErrorKind
  readonly category: AthenaErrorCategory
  readonly retryable: boolean
  readonly status: number
  readonly endpoint: AthenaGatewayEndpointPath
  readonly method: AthenaGatewayMethod
  readonly requestId?: string
  readonly hint?: string
  readonly causeDetail?: string
  readonly raw: unknown
  readonly normalized: NormalizedAthenaError
  readonly __athenaNormalizedError: NormalizedAthenaError

  constructor(input: AthenaStorageErrorInput) {
    super(input.message, { cause: input.cause })
    this.name = 'AthenaStorageError'
    this.code = input.code
    this.status = input.status
    this.endpoint = input.endpoint
    this.method = input.method
    this.requestId = input.requestId
    this.hint = input.hint
    this.causeDetail = causeToString(input.cause)
    this.raw = input.raw ?? null
    this.normalized = normalizeStorageErrorInput(input)
    this.__athenaNormalizedError = this.normalized
    this.athenaCode = this.normalized.code
    this.kind = this.normalized.kind
    this.category = this.normalized.category
    this.retryable = this.normalized.retryable
    Object.defineProperty(this, '__athenaNormalizedError', {
      value: this.normalized,
      enumerable: false,
      configurable: false,
      writable: false,
    })
  }

  toDetails(): AthenaStorageErrorDetails {
    return {
      code: this.code,
      athenaCode: this.athenaCode,
      kind: this.kind,
      category: this.category,
      retryable: this.retryable,
      message: this.message,
      status: this.status,
      endpoint: this.endpoint,
      method: this.method,
      requestId: this.requestId,
      hint: this.hint,
      cause: this.causeDetail,
      raw: this.raw,
    }
  }
}

export interface AthenaStorageBaseModule {
  listStorageCatalogs(options?: AthenaStorageCallOptions): Promise<{ data: S3CatalogItem[] }>
  createStorageCatalog(
    input: CreateStorageCatalogRequest,
    options?: AthenaStorageCallOptions,
  ): Promise<S3CatalogItem>
  updateStorageCatalog(
    id: string,
    input: UpdateStorageCatalogRequest,
    options?: AthenaStorageCallOptions,
  ): Promise<S3CatalogItem>
  deleteStorageCatalog(
    id: string,
    options?: AthenaStorageCallOptions,
  ): Promise<{ id: string; deleted: boolean }>
  listStorageCredentials(options?: AthenaStorageCallOptions): Promise<{ data: S3CredentialListItem[] }>
  createStorageUploadUrl(
    input: CreateStorageUploadUrlRequest,
    options?: AthenaStorageCallOptions,
  ): Promise<StorageUploadUrlResponse>
  createStorageUploadUrls(
    input: CreateStorageUploadUrlsRequest,
    options?: AthenaStorageCallOptions,
  ): Promise<StorageBatchUploadUrlResponse>
  listStorageFiles(
    input: ListStorageFilesRequest,
    options?: AthenaStorageCallOptions,
  ): Promise<StorageListFilesResponse>
  getStorageFile(fileId: string, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
  getStorageFileUrl(
    fileId: string,
    query?: GetStorageFileUrlQuery,
    options?: AthenaStorageCallOptions,
  ): Promise<PresignedFileUrlResponse>
  getStorageFileProxy(
    fileId: string,
    query?: GetStorageFileUrlQuery,
    options?: AthenaStorageBinaryCallOptions,
  ): Promise<Response>
  updateStorageFile(
    fileId: string,
    input: UpdateStorageFileRequest,
    options?: AthenaStorageCallOptions,
  ): Promise<StorageFileMutationResponse>
  deleteStorageFile(fileId: string, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
  setStorageFileVisibility(
    fileId: string,
    input: SetStorageFileVisibilityRequest,
    options?: AthenaStorageCallOptions,
  ): Promise<StorageFileMutationResponse>
  deleteStorageFolder(
    input: DeleteStorageFolderRequest,
    options?: AthenaStorageCallOptions,
  ): Promise<StorageFolderMutationResponse>
  moveStorageFolder(
    input: MoveStorageFolderRequest,
    options?: AthenaStorageCallOptions,
  ): Promise<StorageFolderMutationResponse>
}

export type AthenaStoragePutBody =
  | Blob
  | ArrayBuffer
  | Uint8Array
  | ReadableStream<Uint8Array>

export interface AthenaStoragePutOptions {
  headers?: Record<string, string>
  signal?: AbortSignal
}

export interface AthenaStorageManagedUpload extends PresignedFileUrlResponse {
  method: 'PUT'
  headers: Record<string, string>
  expiresAt: string
  put(body: AthenaStoragePutBody, options?: AthenaStoragePutOptions): Promise<Response>
}

export interface StorageUploadUrlResponseWithPut extends Omit<StorageUploadUrlResponse, 'upload'> {
  upload: AthenaStorageManagedUpload
}

export interface StorageBatchUploadUrlResponseWithPut {
  files: StorageUploadUrlResponseWithPut[]
}

export interface AthenaStorageFileUploadRequest {
  s3_id?: string
  s3Id?: string
  bucket?: string
  storage_key?: string
  storageKey?: string
  name?: string
  fileName?: string
  original_name?: string
  originalName?: string
  resource_id?: string
  resourceId?: string
  mime_type?: string
  mimeType?: string
  content_type?: string
  contentType?: string
  size_bytes?: number
  sizeBytes?: number
  file_id?: string
  fileId?: string
  public?: boolean
  visibility?: 'private' | 'organization' | 'public'
  metadata?: Record<string, unknown>
}

export interface AthenaStorageFileUploadManyRequest {
  files: AthenaStorageFileUploadRequest[]
}

export interface AthenaStorageFileNamespace extends AthenaStorageFileModule {
  upload(
    input: AthenaStorageFileUploadRequest,
    options?: AthenaStorageCallOptions,
  ): Promise<StorageUploadUrlResponseWithPut>
  upload(
    input: Parameters<AthenaStorageFileModule['upload']>[0],
    options?: AthenaStorageCallOptions,
  ): ReturnType<AthenaStorageFileModule['upload']>
  uploadMany(
    input: AthenaStorageFileUploadManyRequest,
    options?: AthenaStorageCallOptions,
  ): Promise<StorageBatchUploadUrlResponseWithPut>
  confirmUpload(
    fileId: string,
    input?: ConfirmStorageUploadRequest,
    options?: AthenaStorageCallOptions,
  ): Promise<StorageFileMutationResponse>
  uploadBinary(
    fileId: string,
    body: AthenaStoragePutBody,
    options?: AthenaStorageCallOptions,
  ): Promise<StorageFileMutationResponse>
  search(
    input: SearchStorageFilesRequest,
    options?: AthenaStorageCallOptions,
  ): Promise<StorageListFilesResponse>
  get(fileId: string, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
  update(
    fileId: string,
    input: UpdateStorageFileRequest,
    options?: AthenaStorageCallOptions,
  ): Promise<StorageFileMutationResponse>
  deleteMany(
    input: DeleteManyStorageFilesRequest,
    options?: AthenaStorageCallOptions,
  ): Promise<StorageFileMutationManyResponse>
  updateMany(
    input: UpdateManyStorageFilesRequest,
    options?: AthenaStorageCallOptions,
  ): Promise<StorageFileMutationManyResponse>
  restore(fileId: string, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
  purge(fileId: string, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
  copy(
    fileId: string,
    input: CopyStorageFileRequest,
    options?: AthenaStorageCallOptions,
  ): Promise<StorageFileMutationResponse>
  url(
    fileId: string,
    query?: GetStorageFileUrlQuery,
    options?: AthenaStorageCallOptions,
  ): Promise<PresignedFileUrlResponse>
  publicUrl(fileId: string, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  proxy(
    fileId: string,
    query?: GetStorageFileUrlQuery,
    options?: AthenaStorageBinaryCallOptions,
  ): Promise<Response>
  visibility: {
    set(
      fileId: string,
      input: SetStorageFileVisibilityRequest,
      options?: AthenaStorageCallOptions,
    ): Promise<StorageFileMutationResponse>
    setMany(
      input: SetManyStorageFileVisibilityRequest,
      options?: AthenaStorageCallOptions,
    ): Promise<StorageFileMutationManyResponse>
  }
}

export interface AthenaStorageCredentialsNamespace {
  list(options?: AthenaStorageCallOptions): Promise<{ data: S3CredentialListItem[] }>
}

export interface AthenaStorageCatalogNamespace {
  list(options?: AthenaStorageCallOptions): Promise<{ data: S3CatalogItem[] }>
  create(input: CreateStorageCatalogRequest, options?: AthenaStorageCallOptions): Promise<S3CatalogItem>
  update(id: string, input: UpdateStorageCatalogRequest, options?: AthenaStorageCallOptions): Promise<S3CatalogItem>
  delete(id: string, options?: AthenaStorageCallOptions): Promise<{ id: string; deleted: boolean }>
}

export interface AthenaStorageFolderNamespace {
  list(input: ListStorageFoldersRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  tree(input: TreeStorageFoldersRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  delete(input: DeleteStorageFolderRequest, options?: AthenaStorageCallOptions): Promise<StorageFolderMutationResponse>
  move(input: MoveStorageFolderRequest, options?: AthenaStorageCallOptions): Promise<StorageFolderMutationResponse>
}

export interface AthenaStoragePermissionNamespace {
  list(input: StoragePermissionListRequest, options?: AthenaStorageCallOptions): Promise<StoragePermissionListResponse>
  grant(input: StoragePermissionGrantRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  revoke(input: StoragePermissionRevokeRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  check(input: StoragePermissionCheckRequest, options?: AthenaStorageCallOptions): Promise<StoragePermissionCheckResponse>
}

export interface AthenaStorageObjectFolderNamespace {
  create(input: StorageObjectFolderCreateRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  delete(input: StorageObjectFolderDeleteRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  rename(input: StorageObjectFolderRenameRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
}

export interface AthenaStorageObjectNamespace {
  list(input: StorageListObjectsRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  head(input: StorageObjectRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  exists(input: StorageObjectRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  validate(input: StorageObjectRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  update(input: StorageUpdateObjectRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  copy(input: StorageObjectCopyRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  url(input: StorageObjectRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  publicUrl(input: StorageObjectPublicUrlRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  delete(input: StorageObjectRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  uploadUrl(input: StoragePresignUploadRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  folder: AthenaStorageObjectFolderNamespace
}

export interface AthenaStorageBucketCorsNamespace {
  get(input: StorageBucketCorsRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  set(input: StorageSetBucketCorsRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  delete(input: StorageBucketCorsRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
}

export interface AthenaStorageBucketNamespace {
  list(input: Omit<StorageObjectBaseRequest, 'bucket'>, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  create(input: StorageObjectBaseRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  delete(input: StorageObjectBaseRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  cors: AthenaStorageBucketCorsNamespace
}

export interface AthenaStorageMultipartNamespace {
  create(input: StorageMultipartCreateRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  signPart(input: StorageMultipartSignPartRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  complete(input: StorageMultipartCompleteRequest, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
  abort(input: StorageMultipartAbortRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
  listParts(input: StorageMultipartListPartsRequest, options?: AthenaStorageCallOptions): Promise<Record<string, unknown>>
}

export interface AthenaStorageAuditNamespace {
  list(input: StorageAuditQueryRequest, options?: AthenaStorageCallOptions): Promise<StorageAuditListResponse>
}

export interface AthenaStorageModule extends AthenaStorageBaseModule {
  credentials: AthenaStorageCredentialsNamespace
  catalog: AthenaStorageCatalogNamespace
  file: AthenaStorageFileNamespace
  folder: AthenaStorageFolderNamespace
  permission: AthenaStoragePermissionNamespace
  object: AthenaStorageObjectNamespace
  bucket: AthenaStorageBucketNamespace
  multipart: AthenaStorageMultipartNamespace
  audit: AthenaStorageAuditNamespace
  delete: AthenaStorageFileModule['delete']
}

type StorageEnvelopeKind = 'raw' | 'athena'

interface StorageModuleRuntimeOptions {
  baseUrl?: string
  onError?: AthenaStorageErrorHandler
  stripBasePath?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function causeToString(cause: unknown): string | undefined {
  if (cause === undefined || cause === null) return undefined
  if (typeof cause === 'string') return cause
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim()
  try {
    return JSON.stringify(cause)
  } catch {
    return String(cause)
  }
}

function storageGatewayCode(code: AthenaStorageErrorCode): AthenaGatewayErrorCode {
  if (code === 'INVALID_URL') return 'INVALID_URL'
  if (code === 'NETWORK_ERROR') return 'NETWORK_ERROR'
  if (code === 'INVALID_JSON' || code === 'INVALID_ATHENA_ENVELOPE') return 'INVALID_JSON'
  if (code === 'HTTP_ERROR') return 'HTTP_ERROR'
  return 'UNKNOWN_ERROR'
}

function headerValue(headers: Headers, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = headers.get(name)
    if (value?.trim()) return value.trim()
  }
  return undefined
}

function storageOperationFromEndpoint(
  endpoint: AthenaGatewayEndpointPath,
  method: AthenaGatewayMethod,
): string {
  const endpointPath = String(endpoint).split('?')[0]
  for (const candidate of storageSdkManifest.methods) {
    if (candidate.method !== method) continue
    const pattern = `^${candidate.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{[^/]+\\\}/g, '[^/]+')}$`
    if (new RegExp(pattern).test(endpointPath)) {
      return candidate.name
    }
  }
  return `storage:${method.toLowerCase()}`
}

function normalizeStorageErrorInput(input: AthenaStorageErrorInput): NormalizedAthenaError {
  return normalizeAthenaError(
    {
      data: null,
      error: {
        message: input.message,
        gatewayCode: storageGatewayCode(input.code),
        status: input.status,
        raw: input.raw ?? input.cause ?? null,
      },
      errorDetails: {
        code: storageGatewayCode(input.code),
        message: input.message,
        status: input.status,
        endpoint: input.endpoint,
        method: input.method,
        requestId: input.requestId,
        hint: input.hint,
        cause: causeToString(input.cause),
      },
      raw: input.raw ?? input.cause ?? null,
      status: input.status,
    },
    { operation: storageOperationFromEndpoint(input.endpoint, input.method) },
  )
}

export function createAthenaStorageError(input: AthenaStorageErrorInput): AthenaStorageError {
  return new AthenaStorageError(input)
}

async function notifyStorageError(
  error: AthenaStorageError,
  options: AthenaStorageCallOptions | undefined,
  runtimeOptions: StorageModuleRuntimeOptions | undefined,
): Promise<void> {
  const handlers = [runtimeOptions?.onError, options?.onError].filter(
    (handler): handler is AthenaStorageErrorHandler => typeof handler === 'function',
  )
  for (const handler of handlers) {
    try {
      await handler(error)
    } catch {
      // Error observers must not mask the original storage failure.
    }
  }
}

async function rejectStorageError(
  input: AthenaStorageErrorInput,
  options: AthenaStorageCallOptions | undefined,
  runtimeOptions: StorageModuleRuntimeOptions | undefined,
): Promise<never> {
  const error = createAthenaStorageError(input)
  await notifyStorageError(error, options, runtimeOptions)
  throw error
}

function parseResponseBody(rawText: string, contentType: string | null) {
  if (!rawText) {
    return { parsed: null as unknown, parseFailed: false }
  }

  const contentTypeSuggestsJson =
    contentType?.toLowerCase().includes('application/json') ?? false
  const looksJson =
    contentTypeSuggestsJson || rawText.startsWith('{') || rawText.startsWith('[')

  if (!looksJson) {
    return { parsed: rawText as unknown, parseFailed: false }
  }

  try {
    return { parsed: JSON.parse(rawText) as unknown, parseFailed: false }
  } catch {
    return { parsed: rawText as unknown, parseFailed: true }
  }
}

function appendQuery(path: string, query?: object): string {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    params.set(key, String(value))
  }
  const queryText = params.toString()
  return queryText ? `${path}?${queryText}` : path
}

function storagePath(path: string): AthenaGatewayEndpointPath {
  return path as AthenaGatewayEndpointPath
}

function resolveStorageEndpointPath(
  endpoint: AthenaGatewayEndpointPath,
  runtimeOptions?: StorageModuleRuntimeOptions,
): AthenaGatewayEndpointPath {
  if (!runtimeOptions?.stripBasePath) {
    return endpoint
  }

  const [pathname, queryText] = String(endpoint).split('?', 2)
  const trimmedPathname = pathname.startsWith('/storage/')
    ? pathname.slice('/storage'.length)
    : pathname === '/storage'
      ? '/'
      : pathname
  const resolvedPath = trimmedPathname.startsWith('/') ? trimmedPathname : `/${trimmedPathname}`
  return storagePath(queryText ? `${resolvedPath}?${queryText}` : resolvedPath)
}

function withPathParam(path: string, name: string, value: string): string {
  return path.replace(`{${name}}`, encodeURIComponent(value))
}

function resolveErrorMessage(payload: unknown, fallback: string): string {
  if (isRecord(payload)) {
    const message = payload.message ?? payload.error ?? payload.details
    if (typeof message === 'string' && message.trim()) {
      return message.trim()
    }
  }
  if (typeof payload === 'string' && payload.trim()) {
    return payload.trim()
  }
  return fallback
}

function resolveErrorHint(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  const hint = payload.hint ?? payload.suggestion
  return typeof hint === 'string' && hint.trim() ? hint.trim() : undefined
}

function resolveErrorCause(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  const cause = payload.cause ?? payload.reason
  return typeof cause === 'string' && cause.trim() ? cause.trim() : undefined
}

function storageCodeFromUnknown(error: unknown): AthenaStorageErrorCode {
  if (isAthenaGatewayError(error)) {
    if (error.code === 'INVALID_URL') return 'INVALID_URL'
    if (error.code === 'NETWORK_ERROR') return 'NETWORK_ERROR'
    if (error.code === 'INVALID_JSON') return 'INVALID_JSON'
    if (error.code === 'HTTP_ERROR') return 'HTTP_ERROR'
  }
  return 'UNKNOWN_ERROR'
}

async function callStorageEndpoint<T>(
  gateway: AthenaGatewayClient,
  endpoint: AthenaGatewayEndpointPath,
  method: AthenaGatewayMethod,
  envelope: StorageEnvelopeKind,
  payload?: unknown,
  options?: AthenaStorageCallOptions,
  runtimeOptions?: StorageModuleRuntimeOptions,
): Promise<T> {
  let url: string
  let headers: Record<string, string>
  try {
    const baseUrl = options?.baseUrl
      ? normalizeAthenaGatewayBaseUrl(options.baseUrl)
      : runtimeOptions?.baseUrl
        ? normalizeAthenaGatewayBaseUrl(runtimeOptions.baseUrl)
        : gateway.baseUrl
    url = buildAthenaGatewayUrl(baseUrl, resolveStorageEndpointPath(endpoint, runtimeOptions))
    headers = gateway.buildHeaders(options)
  } catch (error) {
    return rejectStorageError(
      {
        code: storageCodeFromUnknown(error),
        message: error instanceof Error
          ? error.message
          : `Athena storage ${method} ${endpoint} failed before sending the request`,
        status: isAthenaGatewayError(error) ? error.status : 0,
        endpoint,
        method,
        raw: error,
        requestId: isAthenaGatewayError(error) ? error.requestId : undefined,
        hint: isAthenaGatewayError(error) ? error.hint : undefined,
        cause: error,
      },
      options,
      runtimeOptions,
    )
  }
  const requestInit: RequestInit = {
    method,
    headers,
    signal: options?.signal,
  }
  if (payload !== undefined && method !== 'GET') {
    requestInit.body = JSON.stringify(payload)
  }

  let response: Response
  try {
    response = await fetch(url, requestInit)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return rejectStorageError(
      {
        code: 'NETWORK_ERROR',
        message: `Network error while calling Athena storage ${method} ${endpoint}: ${message}`,
        status: 0,
        endpoint,
        method,
        cause: error,
      },
      options,
      runtimeOptions,
    )
  }

  let rawText: string
  try {
    rawText = await response.text()
  } catch (error) {
    return rejectStorageError(
      {
        code: 'NETWORK_ERROR',
        message: `Athena storage ${method} ${endpoint} response body could not be read`,
        status: response.status,
        endpoint,
        method,
        requestId: headerValue(response.headers, ['x-athena-request-id', 'x-request-id', 'request-id']),
        cause: error,
      },
      options,
      runtimeOptions,
    )
  }
  const parsedBody = parseResponseBody(rawText ?? '', response.headers.get('content-type'))
  const requestId = headerValue(response.headers, ['x-athena-request-id', 'x-request-id', 'request-id'])
  if (parsedBody.parseFailed) {
    return rejectStorageError(
      {
        code: 'INVALID_JSON',
        message: `Athena storage ${method} ${endpoint} returned malformed JSON`,
        status: response.status,
        endpoint,
        method,
        requestId,
        raw: parsedBody.parsed,
      },
      options,
      runtimeOptions,
    )
  }

  if (!response.ok) {
    return rejectStorageError(
      {
        code: 'HTTP_ERROR',
        message: resolveErrorMessage(
          parsedBody.parsed,
          `Athena storage ${method} ${endpoint} failed with status ${response.status}`,
        ),
        status: response.status,
        endpoint,
        method,
        requestId,
        hint: resolveErrorHint(parsedBody.parsed),
        cause: resolveErrorCause(parsedBody.parsed),
        raw: parsedBody.parsed,
      },
      options,
      runtimeOptions,
    )
  }

  if (envelope === 'athena') {
    if (!isRecord(parsedBody.parsed) || !('data' in parsedBody.parsed)) {
      return rejectStorageError(
        {
          code: 'INVALID_ATHENA_ENVELOPE',
          message: `Athena storage ${method} ${endpoint} returned an invalid Athena envelope`,
          status: response.status,
          endpoint,
          method,
          requestId,
          raw: parsedBody.parsed,
        },
        options,
        runtimeOptions,
      )
    }
    return parsedBody.parsed.data as T
  }

  return parsedBody.parsed as T
}

async function callStorageBinaryEndpoint(
  gateway: AthenaGatewayClient,
  endpoint: AthenaGatewayEndpointPath,
  method: AthenaGatewayMethod,
  options?: AthenaStorageBinaryCallOptions,
  runtimeOptions?: StorageModuleRuntimeOptions,
): Promise<Response> {
  let url: string
  let headers: Record<string, string>
  try {
    const baseUrl = options?.baseUrl
      ? normalizeAthenaGatewayBaseUrl(options.baseUrl)
      : runtimeOptions?.baseUrl
        ? normalizeAthenaGatewayBaseUrl(runtimeOptions.baseUrl)
        : gateway.baseUrl
    url = buildAthenaGatewayUrl(baseUrl, resolveStorageEndpointPath(endpoint, runtimeOptions))
    headers = gateway.buildHeaders(options)
  } catch (error) {
    return rejectStorageError(
      {
        code: storageCodeFromUnknown(error),
        message: error instanceof Error
          ? error.message
          : `Athena storage ${method} ${endpoint} failed before sending the request`,
        status: isAthenaGatewayError(error) ? error.status : 0,
        endpoint,
        method,
        raw: error,
        requestId: isAthenaGatewayError(error) ? error.requestId : undefined,
        hint: isAthenaGatewayError(error) ? error.hint : undefined,
        cause: error,
      },
      options,
      runtimeOptions,
    )
  }

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      signal: options?.signal,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return rejectStorageError(
      {
        code: 'NETWORK_ERROR',
        message: `Network error while calling Athena storage ${method} ${endpoint}: ${message}`,
        status: 0,
        endpoint,
        method,
        cause: error,
      },
      options,
      runtimeOptions,
    )
  }

  if (response.ok) {
    return response
  }

  const requestId = headerValue(response.headers, ['x-athena-request-id', 'x-request-id', 'request-id'])
  let rawErrorBody: unknown = null
  try {
    const rawText = await response.text()
    const parsedBody = parseResponseBody(rawText ?? '', response.headers.get('content-type'))
    rawErrorBody = parsedBody.parsed
  } catch (error) {
    return rejectStorageError(
      {
        code: 'NETWORK_ERROR',
        message: `Athena storage ${method} ${endpoint} error response body could not be read`,
        status: response.status,
        endpoint,
        method,
        requestId,
        cause: error,
      },
      options,
      runtimeOptions,
    )
  }

  return rejectStorageError(
    {
      code: 'HTTP_ERROR',
      message: resolveErrorMessage(
        rawErrorBody,
        `Athena storage ${method} ${endpoint} failed with status ${response.status}`,
      ),
      status: response.status,
      endpoint,
      method,
      requestId,
      hint: resolveErrorHint(rawErrorBody),
      cause: resolveErrorCause(rawErrorBody),
      raw: rawErrorBody,
    },
    options,
    runtimeOptions,
  )
}

function isBlobBody(body: AthenaStoragePutBody): body is Blob {
  return typeof Blob !== 'undefined' && body instanceof Blob
}

function isReadableStreamBody(body: AthenaStoragePutBody): body is ReadableStream<Uint8Array> {
  return typeof ReadableStream !== 'undefined' && body instanceof ReadableStream
}

async function putPresignedUploadBody(
  uploadUrl: string,
  uploadHeaders: Record<string, string>,
  body: AthenaStoragePutBody,
  options?: AthenaStoragePutOptions,
): Promise<Response> {
  const headers = new Headers(uploadHeaders)
  Object.entries(options?.headers ?? {}).forEach(([key, value]) => headers.set(key, value))
  if (!headers.has('Content-Type') && isBlobBody(body) && body.type) {
    headers.set('Content-Type', body.type)
  }

  const init: RequestInit & { duplex?: 'half' } = {
    method: 'PUT',
    headers,
    body: body as RequestInit['body'],
    signal: options?.signal,
  }
  if (isReadableStreamBody(body)) {
    init.duplex = 'half'
  }
  return fetch(uploadUrl, init)
}

function attachManagedUpload(upload: PresignedFileUrlResponse): AthenaStorageManagedUpload {
  const headers: Record<string, string> = {}
  return {
    ...upload,
    method: 'PUT',
    headers,
    expiresAt: upload.expires_at,
    put(body, options) {
      return putPresignedUploadBody(upload.url, headers, body, options)
    },
  }
}

function attachUploadHelper(response: StorageUploadUrlResponse): StorageUploadUrlResponseWithPut {
  return {
    ...response,
    upload: attachManagedUpload(response.upload),
  }
}

function attachUploadHelpers(
  response: StorageBatchUploadUrlResponse,
): StorageBatchUploadUrlResponseWithPut {
  return {
    files: response.files.map(attachUploadHelper),
  }
}

function normalizeUploadUrlRequest(input: AthenaStorageFileUploadRequest): CreateStorageUploadUrlRequest {
  const s3_id = input.s3_id ?? input.s3Id
  const storage_key = input.storage_key ?? input.storageKey
  if (!s3_id?.trim()) {
    throw new Error('athena.storage.file.upload requires s3_id or s3Id')
  }
  if (!storage_key?.trim()) {
    throw new Error('athena.storage.file.upload requires storage_key or storageKey')
  }
  const fileName = input.fileName?.trim()
  const originalName = input.originalName?.trim()
  return {
    s3_id,
    bucket: input.bucket,
    storage_key,
    name: input.name ?? fileName,
    original_name: input.original_name ?? originalName ?? fileName,
    resource_id: input.resource_id ?? input.resourceId,
    mime_type: input.mime_type ?? input.mimeType,
    content_type: input.content_type ?? input.contentType,
    size_bytes: input.size_bytes ?? input.sizeBytes,
    file_id: input.file_id ?? input.fileId,
    public: input.public,
    visibility: input.visibility,
    metadata: input.metadata,
  }
}

async function callStorageUploadBinaryEndpoint<T>(
  gateway: AthenaGatewayClient,
  endpoint: AthenaGatewayEndpointPath,
  body: AthenaStoragePutBody,
  options?: AthenaStorageCallOptions,
  runtimeOptions?: StorageModuleRuntimeOptions,
): Promise<T> {
  let url: string
  let headers: Record<string, string>
  try {
    const baseUrl = options?.baseUrl
      ? normalizeAthenaGatewayBaseUrl(options.baseUrl)
      : runtimeOptions?.baseUrl
        ? normalizeAthenaGatewayBaseUrl(runtimeOptions.baseUrl)
        : gateway.baseUrl
    url = buildAthenaGatewayUrl(baseUrl, resolveStorageEndpointPath(endpoint, runtimeOptions))
    headers = gateway.buildHeaders(options)
  } catch (error) {
    return rejectStorageError(
      {
        code: storageCodeFromUnknown(error),
        message: error instanceof Error
          ? error.message
          : `Athena storage PUT ${endpoint} failed before sending the request`,
        status: isAthenaGatewayError(error) ? error.status : 0,
        endpoint,
        method: 'PUT',
        raw: error,
        requestId: isAthenaGatewayError(error) ? error.requestId : undefined,
        hint: isAthenaGatewayError(error) ? error.hint : undefined,
        cause: error,
      },
      options,
      runtimeOptions,
    )
  }

  delete headers['Content-Type']
  delete headers['content-type']
  if (isBlobBody(body) && body.type) {
    headers['Content-Type'] = body.type
  }

  const requestInit: RequestInit & { duplex?: 'half' } = {
    method: 'PUT',
    headers,
    body: body as RequestInit['body'],
    signal: options?.signal,
  }
  if (isReadableStreamBody(body)) {
    requestInit.duplex = 'half'
  }

  let response: Response
  try {
    response = await fetch(url, requestInit)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return rejectStorageError(
      {
        code: 'NETWORK_ERROR',
        message: `Network error while calling Athena storage PUT ${endpoint}: ${message}`,
        status: 0,
        endpoint,
        method: 'PUT',
        cause: error,
      },
      options,
      runtimeOptions,
    )
  }

  let rawText: string
  try {
    rawText = await response.text()
  } catch (error) {
    return rejectStorageError(
      {
        code: 'NETWORK_ERROR',
        message: `Athena storage PUT ${endpoint} response body could not be read`,
        status: response.status,
        endpoint,
        method: 'PUT',
        requestId: headerValue(response.headers, ['x-athena-request-id', 'x-request-id', 'request-id']),
        cause: error,
      },
      options,
      runtimeOptions,
    )
  }

  const parsedBody = parseResponseBody(rawText ?? '', response.headers.get('content-type'))
  const requestId = headerValue(response.headers, ['x-athena-request-id', 'x-request-id', 'request-id'])
  if (parsedBody.parseFailed) {
    return rejectStorageError(
      {
        code: 'INVALID_JSON',
        message: `Athena storage PUT ${endpoint} returned malformed JSON`,
        status: response.status,
        endpoint,
        method: 'PUT',
        requestId,
        raw: parsedBody.parsed,
      },
      options,
      runtimeOptions,
    )
  }
  if (!response.ok) {
    return rejectStorageError(
      {
        code: 'HTTP_ERROR',
        message: resolveErrorMessage(
          parsedBody.parsed,
          `Athena storage PUT ${endpoint} failed with status ${response.status}`,
        ),
        status: response.status,
        endpoint,
        method: 'PUT',
        requestId,
        hint: resolveErrorHint(parsedBody.parsed),
        cause: resolveErrorCause(parsedBody.parsed),
        raw: parsedBody.parsed,
      },
      options,
      runtimeOptions,
    )
  }
  if (!isRecord(parsedBody.parsed) || !('data' in parsedBody.parsed)) {
    return rejectStorageError(
      {
        code: 'INVALID_ATHENA_ENVELOPE',
        message: `Athena storage PUT ${endpoint} returned an invalid Athena envelope`,
        status: response.status,
        endpoint,
        method: 'PUT',
        requestId,
        raw: parsedBody.parsed,
      },
      options,
      runtimeOptions,
    )
  }
  return parsedBody.parsed.data as T
}

export function createStorageModule(
  gateway: AthenaGatewayClient,
  runtimeOptions?: AthenaStorageClientConfig,
): AthenaStorageModule {
  const resolvedRuntimeOptions = runtimeOptions as StorageModuleRuntimeOptions | undefined
  const callRaw = <T>(
    path: string,
    method: AthenaGatewayMethod,
    payload?: unknown,
    options?: AthenaStorageCallOptions,
  ) => callStorageEndpoint<T>(
    gateway,
    storagePath(path),
    method,
    'raw',
    payload,
    options,
    resolvedRuntimeOptions,
  )
  const callAthena = <T>(
    path: string,
    method: AthenaGatewayMethod,
    payload?: unknown,
    options?: AthenaStorageCallOptions,
  ) => callStorageEndpoint<T>(
    gateway,
    storagePath(path),
    method,
    'athena',
    payload,
    options,
    resolvedRuntimeOptions,
  )
  const base: AthenaStorageBaseModule = {
    listStorageCatalogs(options) {
      return callRaw('/storage/catalogs', 'GET', undefined, options)
    },
    createStorageCatalog(input, options) {
      return callRaw('/storage/catalogs', 'POST', input, options)
    },
    updateStorageCatalog(id, input, options) {
      return callRaw(withPathParam('/storage/catalogs/{id}', 'id', id), 'PATCH', input, options)
    },
    deleteStorageCatalog(id, options) {
      return callRaw(withPathParam('/storage/catalogs/{id}', 'id', id), 'DELETE', undefined, options)
    },
    listStorageCredentials(options) {
      return callRaw('/storage/credentials', 'GET', undefined, options)
    },
    createStorageUploadUrl(input, options) {
      return callAthena('/storage/files/upload-url', 'POST', input, options)
    },
    createStorageUploadUrls(input, options) {
      return callAthena('/storage/files/upload-urls', 'POST', input, options)
    },
    listStorageFiles(input, options) {
      return callAthena('/storage/files/list', 'POST', input, options)
    },
    getStorageFile(fileId, options) {
      return callAthena(withPathParam('/storage/files/{file_id}', 'file_id', fileId), 'GET', undefined, options)
    },
    getStorageFileUrl(fileId, query, options) {
      const path = appendQuery(
        withPathParam('/storage/files/{file_id}/url', 'file_id', fileId),
        query,
      )
      return callAthena(path, 'GET', undefined, options)
    },
    getStorageFileProxy(fileId, query, options) {
      const path = appendQuery(
        withPathParam('/storage/files/{file_id}/proxy', 'file_id', fileId),
        query,
      )
      return callStorageBinaryEndpoint(gateway, storagePath(path), 'GET', options, resolvedRuntimeOptions)
    },
    updateStorageFile(fileId, input, options) {
      return callAthena(withPathParam('/storage/files/{file_id}', 'file_id', fileId), 'PATCH', input, options)
    },
    deleteStorageFile(fileId, options) {
      return callAthena(withPathParam('/storage/files/{file_id}', 'file_id', fileId), 'DELETE', undefined, options)
    },
    setStorageFileVisibility(fileId, input, options) {
      return callAthena(withPathParam('/storage/files/{file_id}/visibility', 'file_id', fileId), 'PATCH', input, options)
    },
    deleteStorageFolder(input, options) {
      return callAthena('/storage/folders/delete', 'POST', input, options)
    },
    moveStorageFolder(input, options) {
      return callAthena('/storage/folders/move', 'POST', input, options)
    },
  }
  const fileFacade = createStorageFileModule(base, runtimeOptions)
  const fileUpload = ((
    input: AthenaStorageFileUploadRequest | Parameters<AthenaStorageFileModule['upload']>[0],
    options?: AthenaStorageCallOptions,
  ) => {
    if (isRecord(input) && 'files' in input) {
      return fileFacade.upload(input as unknown as Parameters<AthenaStorageFileModule['upload']>[0], options)
    }
    return base.createStorageUploadUrl(
      normalizeUploadUrlRequest(input as AthenaStorageFileUploadRequest),
      options,
    ).then(attachUploadHelper)
  }) as AthenaStorageFileNamespace['upload']
  const fileDelete = ((input: string | readonly string[], options?: AthenaStorageCallOptions) =>
    fileFacade.delete(input as unknown as Parameters<AthenaStorageFileModule['delete']>[0], options)
  ) as AthenaStorageFileNamespace['delete']

  const file: AthenaStorageFileNamespace = {
    ...fileFacade,
    upload: fileUpload,
    uploadMany(input, options) {
      return base.createStorageUploadUrls(
        { files: input.files.map(normalizeUploadUrlRequest) },
        options,
      ).then(attachUploadHelpers)
    },
    confirmUpload(fileId, input, options) {
      return callAthena(withPathParam('/storage/files/{file_id}/confirm-upload', 'file_id', fileId), 'POST', input ?? {}, options)
    },
    uploadBinary(fileId, body, options) {
      return callStorageUploadBinaryEndpoint(
        gateway,
        storagePath(withPathParam('/storage/files/{file_id}/upload', 'file_id', fileId)),
        body,
        options,
        resolvedRuntimeOptions,
      )
    },
    search(input, options) {
      return callAthena('/storage/files/search', 'POST', input, options)
    },
    get(fileId, options) {
      return base.getStorageFile(fileId, options)
    },
    update(fileId, input, options) {
      return base.updateStorageFile(fileId, input, options)
    },
    delete: fileDelete,
    deleteMany(input, options) {
      return callAthena('/storage/files/delete-many', 'POST', input, options)
    },
    updateMany(input, options) {
      return callAthena('/storage/files/update-many', 'POST', input, options)
    },
    restore(fileId, options) {
      return callAthena(withPathParam('/storage/files/{file_id}/restore', 'file_id', fileId), 'POST', {}, options)
    },
    purge(fileId, options) {
      return callAthena(withPathParam('/storage/files/{file_id}/purge', 'file_id', fileId), 'DELETE', undefined, options)
    },
    copy(fileId, input, options) {
      return callAthena(withPathParam('/storage/files/{file_id}/copy', 'file_id', fileId), 'POST', input, options)
    },
    url(fileId, query, options) {
      return base.getStorageFileUrl(fileId, query, options)
    },
    publicUrl(fileId, options) {
      return callAthena(withPathParam('/storage/files/{file_id}/public-url', 'file_id', fileId), 'GET', undefined, options)
    },
    proxy(fileId, query, options) {
      return base.getStorageFileProxy(fileId, query, options)
    },
    visibility: {
      set(fileId, input, options) {
        return base.setStorageFileVisibility(fileId, input, options)
      },
      setMany(input, options) {
        return callAthena('/storage/files/visibility-many', 'POST', input, options)
      },
    },
  }
  const credentials: AthenaStorageCredentialsNamespace = {
    list(options) {
      return base.listStorageCredentials(options)
    },
  }
  const catalog: AthenaStorageCatalogNamespace = {
    list(options) {
      return base.listStorageCatalogs(options)
    },
    create(input, options) {
      return base.createStorageCatalog(input, options)
    },
    update(id, input, options) {
      return base.updateStorageCatalog(id, input, options)
    },
    delete(id, options) {
      return base.deleteStorageCatalog(id, options)
    },
  }
  const folder: AthenaStorageFolderNamespace = {
    list(input, options) {
      return callAthena('/storage/folders/list', 'POST', input, options)
    },
    tree(input, options) {
      return callAthena('/storage/folders/tree', 'POST', input, options)
    },
    delete(input, options) {
      return base.deleteStorageFolder(input, options)
    },
    move(input, options) {
      return base.moveStorageFolder(input, options)
    },
  }
  const permission: AthenaStoragePermissionNamespace = {
    list(input, options) {
      return callAthena('/storage/permissions/list', 'POST', input, options)
    },
    grant(input, options) {
      return callAthena('/storage/permissions/grant', 'POST', input, options)
    },
    revoke(input, options) {
      return callAthena('/storage/permissions/revoke', 'POST', input, options)
    },
    check(input, options) {
      return callAthena('/storage/permissions/check', 'POST', input, options)
    },
  }
  const objectFolder: AthenaStorageObjectFolderNamespace = {
    create(input, options) {
      return callAthena('/storage/objects/folder', 'POST', input, options)
    },
    delete(input, options) {
      return callAthena('/storage/objects/folder/delete', 'POST', input, options)
    },
    rename(input, options) {
      return callAthena('/storage/objects/folder/rename', 'POST', input, options)
    },
  }
  const object: AthenaStorageObjectNamespace = {
    list(input, options) {
      return callAthena('/storage/objects', 'POST', input, options)
    },
    head(input, options) {
      return callAthena('/storage/objects/head', 'POST', input, options)
    },
    exists(input, options) {
      return callAthena('/storage/objects/exists', 'POST', input, options)
    },
    validate(input, options) {
      return callAthena('/storage/objects/validate', 'POST', input, options)
    },
    update(input, options) {
      return callAthena('/storage/objects/update', 'POST', input, options)
    },
    copy(input, options) {
      return callAthena('/storage/objects/copy', 'POST', input, options)
    },
    url(input, options) {
      return callAthena('/storage/objects/url', 'POST', input, options)
    },
    publicUrl(input, options) {
      return callAthena('/storage/objects/public-url', 'POST', input, options)
    },
    delete(input, options) {
      return callAthena('/storage/objects/delete', 'POST', input, options)
    },
    uploadUrl(input, options) {
      return callAthena('/storage/objects/upload-url', 'POST', input, options)
    },
    folder: objectFolder,
  }
  const bucket: AthenaStorageBucketNamespace = {
    list(input, options) {
      return callAthena('/storage/buckets/list', 'POST', input, options)
    },
    create(input, options) {
      return callAthena('/storage/buckets/create', 'POST', input, options)
    },
    delete(input, options) {
      return callAthena('/storage/buckets/delete', 'POST', input, options)
    },
    cors: {
      get(input, options) {
        return callAthena('/storage/buckets/cors', 'POST', input, options)
      },
      set(input, options) {
        return callAthena('/storage/buckets/cors/set', 'POST', input, options)
      },
      delete(input, options) {
        return callAthena('/storage/buckets/cors/delete', 'POST', input, options)
      },
    },
  }
  const multipart: AthenaStorageMultipartNamespace = {
    create(input, options) {
      return callAthena('/storage/multipart/create', 'POST', input, options)
    },
    signPart(input, options) {
      return callAthena('/storage/multipart/sign-part', 'POST', input, options)
    },
    complete(input, options) {
      return callAthena('/storage/multipart/complete', 'POST', input, options)
    },
    abort(input, options) {
      return callAthena('/storage/multipart/abort', 'POST', input, options)
    },
    listParts(input, options) {
      return callAthena('/storage/multipart/list-parts', 'POST', input, options)
    },
  }
  const audit: AthenaStorageAuditNamespace = {
    list(input, options) {
      return callAthena('/storage/audit/list', 'POST', input, options)
    },
  }
  return {
    ...base,
    credentials,
    catalog,
    file,
    folder,
    permission,
    object,
    bucket,
    multipart,
    audit,
    delete: file.delete,
  }
}
