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

export interface AthenaStorageModule extends AthenaStorageBaseModule {
  file: AthenaStorageFileModule
  delete: AthenaStorageFileModule['delete']
}

type StorageEnvelopeKind = 'raw' | 'athena'

interface StorageModuleRuntimeOptions {
  onError?: AthenaStorageErrorHandler
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
      : gateway.baseUrl
    url = buildAthenaGatewayUrl(baseUrl, endpoint)
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
      : gateway.baseUrl
    url = buildAthenaGatewayUrl(baseUrl, endpoint)
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

export function createStorageModule(
  gateway: AthenaGatewayClient,
  runtimeOptions?: AthenaStorageClientConfig,
): AthenaStorageModule {
  const base: AthenaStorageBaseModule = {
    listStorageCatalogs(options) {
      return callStorageEndpoint(gateway, storagePath('/storage/catalogs'), 'GET', 'raw', undefined, options, runtimeOptions)
    },
    createStorageCatalog(input, options) {
      return callStorageEndpoint(gateway, storagePath('/storage/catalogs'), 'POST', 'raw', input, options, runtimeOptions)
    },
    updateStorageCatalog(id, input, options) {
      return callStorageEndpoint(
        gateway,
        storagePath(withPathParam('/storage/catalogs/{id}', 'id', id)),
        'PATCH',
        'raw',
        input,
        options,
        runtimeOptions,
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
        runtimeOptions,
      )
    },
    listStorageCredentials(options) {
      return callStorageEndpoint(gateway, storagePath('/storage/credentials'), 'GET', 'raw', undefined, options, runtimeOptions)
    },
    createStorageUploadUrl(input, options) {
      return callStorageEndpoint(
        gateway,
        storagePath('/storage/files/upload-url'),
        'POST',
        'athena',
        input,
        options,
        runtimeOptions,
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
        runtimeOptions,
      )
    },
    listStorageFiles(input, options) {
      return callStorageEndpoint(gateway, storagePath('/storage/files/list'), 'POST', 'athena', input, options, runtimeOptions)
    },
    getStorageFile(fileId, options) {
      return callStorageEndpoint(
        gateway,
        storagePath(withPathParam('/storage/files/{file_id}', 'file_id', fileId)),
        'GET',
        'athena',
        undefined,
        options,
        runtimeOptions,
      )
    },
    getStorageFileUrl(fileId, query, options) {
      const path = appendQuery(
        withPathParam('/storage/files/{file_id}/url', 'file_id', fileId),
        query,
      )
      return callStorageEndpoint(gateway, storagePath(path), 'GET', 'athena', undefined, options, runtimeOptions)
    },
    getStorageFileProxy(fileId, query, options) {
      const path = appendQuery(
        withPathParam('/storage/files/{file_id}/proxy', 'file_id', fileId),
        query,
      )
      return callStorageBinaryEndpoint(gateway, storagePath(path), 'GET', options, runtimeOptions)
    },
    updateStorageFile(fileId, input, options) {
      return callStorageEndpoint(
        gateway,
        storagePath(withPathParam('/storage/files/{file_id}', 'file_id', fileId)),
        'PATCH',
        'athena',
        input,
        options,
        runtimeOptions,
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
        runtimeOptions,
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
        runtimeOptions,
      )
    },
    deleteStorageFolder(input, options) {
      return callStorageEndpoint(gateway, storagePath('/storage/folders/delete'), 'POST', 'athena', input, options, runtimeOptions)
    },
    moveStorageFolder(input, options) {
      return callStorageEndpoint(gateway, storagePath('/storage/folders/move'), 'POST', 'athena', input, options, runtimeOptions)
    },
  }
  const file = createStorageFileModule(base, runtimeOptions)
  return {
    ...base,
    file,
    delete: file.delete,
  }
}
