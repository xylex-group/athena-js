import type { AthenaGatewayClient } from '../gateway/client.ts'
import type {
  AthenaGatewayCallOptions,
  AthenaGatewayEndpointPath,
  AthenaGatewayMethod,
} from '../gateway/types.ts'
import { buildAthenaGatewayUrl, normalizeAthenaGatewayBaseUrl } from '../gateway/url.ts'

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
  description: string
  endpoint: string
  region: string
  bucket?: string | null
  provider: string
  is_active: boolean
  active_credential_id?: string | null
  active_access_key?: string | null
  created_at: string
  updated_at: string
}

export interface S3CredentialListItem {
  id: string
  s3_id: string
  name: string
  description: string
  endpoint: string
  region: string
  bucket?: string | null
  provider: string
  access_key: string
  created_at: string
  updated_at: string
}

export interface ManagedFileRecord {
  id: string
  name: string
  original_name?: string | null
  url?: string | null
  bucket: string
  s3_id?: string | null
  prefix_path?: string | null
  size_bytes?: number | null
  mime_type?: string | null
  resource_id?: string | null
  organization_id: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  storage_key: string
  uploaded_by_user_id?: string | null
  extension?: string | null
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
  description?: string
  endpoint: string
  region: string
  bucket?: string
  provider?: string
  access_key_id: string
  secret_key: string
  session_token?: string
  metadata?: Record<string, unknown>
}

export interface UpdateStorageCatalogRequest {
  name?: string
  description?: string
  endpoint?: string
  region?: string
  bucket?: string
  provider?: string
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
  public: boolean
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

export interface AthenaEnvelope<T> {
  status: string
  message: string
  data: T
}

export interface GetStorageFileUrlQuery {
  purpose?: string
}

export interface AthenaStorageCallOptions extends AthenaGatewayCallOptions {
  signal?: AbortSignal
}

export type AthenaStorageErrorCode =
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'INVALID_JSON'
  | 'INVALID_ATHENA_ENVELOPE'

export class AthenaStorageError extends Error {
  readonly code: AthenaStorageErrorCode
  readonly status: number
  readonly endpoint: AthenaGatewayEndpointPath
  readonly method: AthenaGatewayMethod
  readonly raw: unknown

  constructor(input: {
    code: AthenaStorageErrorCode
    message: string
    status: number
    endpoint: AthenaGatewayEndpointPath
    method: AthenaGatewayMethod
    raw?: unknown
    cause?: unknown
  }) {
    super(input.message, { cause: input.cause })
    this.name = 'AthenaStorageError'
    this.code = input.code
    this.status = input.status
    this.endpoint = input.endpoint
    this.method = input.method
    this.raw = input.raw ?? null
  }
}

export interface AthenaStorageModule {
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

type StorageEnvelopeKind = 'raw' | 'athena'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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

function unwrapAthenaEnvelope<T>(
  payload: unknown,
  endpoint: AthenaGatewayEndpointPath,
  method: AthenaGatewayMethod,
): T {
  if (!isRecord(payload) || !('data' in payload)) {
    throw new AthenaStorageError({
      code: 'INVALID_ATHENA_ENVELOPE',
      message: `Athena storage ${method} ${endpoint} returned an invalid Athena envelope`,
      status: 200,
      endpoint,
      method,
      raw: payload,
    })
  }
  return payload.data as T
}

async function callStorageEndpoint<T>(
  gateway: AthenaGatewayClient,
  endpoint: AthenaGatewayEndpointPath,
  method: AthenaGatewayMethod,
  envelope: StorageEnvelopeKind,
  payload?: unknown,
  options?: AthenaStorageCallOptions,
): Promise<T> {
  const baseUrl = options?.baseUrl
    ? normalizeAthenaGatewayBaseUrl(options.baseUrl)
    : gateway.baseUrl
  const url = buildAthenaGatewayUrl(baseUrl, endpoint)
  const headers = gateway.buildHeaders(options)
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
    throw new AthenaStorageError({
      code: 'NETWORK_ERROR',
      message: `Network error while calling Athena storage ${method} ${endpoint}: ${message}`,
      status: 0,
      endpoint,
      method,
      cause: error,
    })
  }

  const rawText = await response.text()
  const parsedBody = parseResponseBody(rawText ?? '', response.headers.get('content-type'))
  if (parsedBody.parseFailed) {
    throw new AthenaStorageError({
      code: 'INVALID_JSON',
      message: `Athena storage ${method} ${endpoint} returned malformed JSON`,
      status: response.status,
      endpoint,
      method,
      raw: parsedBody.parsed,
    })
  }

  if (!response.ok) {
    throw new AthenaStorageError({
      code: 'HTTP_ERROR',
      message: resolveErrorMessage(
        parsedBody.parsed,
        `Athena storage ${method} ${endpoint} failed with status ${response.status}`,
      ),
      status: response.status,
      endpoint,
      method,
      raw: parsedBody.parsed,
    })
  }

  return envelope === 'athena'
    ? unwrapAthenaEnvelope<T>(parsedBody.parsed, endpoint, method)
    : parsedBody.parsed as T
}

export function createStorageModule(gateway: AthenaGatewayClient): AthenaStorageModule {
  return {
    listStorageCatalogs(options) {
      return callStorageEndpoint(gateway, storagePath('/storage/catalogs'), 'GET', 'raw', undefined, options)
    },
    createStorageCatalog(input, options) {
      return callStorageEndpoint(gateway, storagePath('/storage/catalogs'), 'POST', 'raw', input, options)
    },
    updateStorageCatalog(id, input, options) {
      return callStorageEndpoint(
        gateway,
        storagePath(withPathParam('/storage/catalogs/{id}', 'id', id)),
        'PATCH',
        'raw',
        input,
        options,
      )
    },
    deleteStorageCatalog(id, options) {
      return callStorageEndpoint(
        gateway,
        storagePath(withPathParam('/storage/catalogs/{id}', 'id', id)),
        'DELETE',
        'raw',
        undefined,
        options,
      )
    },
    listStorageCredentials(options) {
      return callStorageEndpoint(gateway, storagePath('/storage/credentials'), 'GET', 'raw', undefined, options)
    },
    createStorageUploadUrl(input, options) {
      return callStorageEndpoint(
        gateway,
        storagePath('/storage/files/upload-url'),
        'POST',
        'athena',
        input,
        options,
      )
    },
    createStorageUploadUrls(input, options) {
      return callStorageEndpoint(
        gateway,
        storagePath('/storage/files/upload-urls'),
        'POST',
        'athena',
        input,
        options,
      )
    },
    listStorageFiles(input, options) {
      return callStorageEndpoint(gateway, storagePath('/storage/files/list'), 'POST', 'athena', input, options)
    },
    getStorageFile(fileId, options) {
      return callStorageEndpoint(
        gateway,
        storagePath(withPathParam('/storage/files/{file_id}', 'file_id', fileId)),
        'GET',
        'athena',
        undefined,
        options,
      )
    },
    getStorageFileUrl(fileId, query, options) {
      const path = appendQuery(
        withPathParam('/storage/files/{file_id}/url', 'file_id', fileId),
        query,
      )
      return callStorageEndpoint(gateway, storagePath(path), 'GET', 'athena', undefined, options)
    },
    updateStorageFile(fileId, input, options) {
      return callStorageEndpoint(
        gateway,
        storagePath(withPathParam('/storage/files/{file_id}', 'file_id', fileId)),
        'PATCH',
        'athena',
        input,
        options,
      )
    },
    deleteStorageFile(fileId, options) {
      return callStorageEndpoint(
        gateway,
        storagePath(withPathParam('/storage/files/{file_id}', 'file_id', fileId)),
        'DELETE',
        'athena',
        undefined,
        options,
      )
    },
    setStorageFileVisibility(fileId, input, options) {
      return callStorageEndpoint(
        gateway,
        storagePath(withPathParam('/storage/files/{file_id}/visibility', 'file_id', fileId)),
        'PATCH',
        'athena',
        input,
        options,
      )
    },
    deleteStorageFolder(input, options) {
      return callStorageEndpoint(gateway, storagePath('/storage/folders/delete'), 'POST', 'athena', input, options)
    },
    moveStorageFolder(input, options) {
      return callStorageEndpoint(gateway, storagePath('/storage/folders/move'), 'POST', 'athena', input, options)
    },
  }
}
