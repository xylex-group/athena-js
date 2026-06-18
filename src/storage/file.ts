import type {
  AthenaStorageBinaryCallOptions,
  AthenaStorageCallOptions,
  CreateStorageUploadUrlRequest,
  GetStorageFileUrlQuery,
  ListStorageFilesRequest,
  ManagedFileRecord,
  StorageBatchUploadUrlResponse,
  StorageFileMutationResponse,
  StorageListFilesResponse,
  StorageServerSideEncryptionOptions,
  StorageUploadUrlResponse,
} from './module.ts'

export type AthenaStorageTemplateValue = string | number | boolean | null | undefined
export type AthenaStorageTemplateVars = Record<string, AthenaStorageTemplateValue>
export type AthenaStorageEnv = Record<string, string | undefined>
export type AthenaStorageUploadHeaders = ConstructorParameters<typeof Headers>[0]
export type AthenaStoragePrefixPath =
  | string
  | ((context: AthenaStoragePathContext) => string | null | undefined)

export interface AthenaStoragePathContext {
  vars: AthenaStorageTemplateVars
  env: AthenaStorageEnv
  organizationId?: string
  organization_id?: string
  userId?: string
  user_id?: string
  resourceId?: string
  resource_id?: string
}

export interface AthenaStorageFileConfig {
  /**
   * Prefix applied by high-level file helpers before storage keys are sent to Athena.
   * Supports tokens such as `{organization_id}`, `{organizationId}`, `{env.NODE_ENV}`,
   * and `${ATHENA_STORAGE_PREFIX}`.
   */
  prefixPath?: AthenaStoragePrefixPath
  vars?: AthenaStorageTemplateVars
  env?: AthenaStorageEnv
}

export type AthenaStorageUploadSource = Blob | ArrayBuffer | Uint8Array

export interface AthenaStorageUploadConstraints {
  maxFiles?: number
  allowedExtensions?: readonly string[]
  extensions?: readonly string[]
  maxFileSizeMb?: number
  maxFileSizeBytes?: number
}

export interface AthenaStorageUploadProgress {
  phase: 'preparing' | 'uploading' | 'complete'
  fileIndex: number
  fileCount: number
  fileName: string
  loaded: number
  total: number
  percent: number
  aggregateLoaded: number
  aggregateTotal: number
  aggregatePercent: number
}

export type AthenaStorageUploadProgressHandler = (progress: AthenaStorageUploadProgress) => void

export interface AthenaStorageFileUploadInput extends AthenaStorageUploadConstraints, StorageServerSideEncryptionOptions {
  s3_id: string
  bucket?: string
  files: AthenaStorageUploadSource | ArrayLike<AthenaStorageUploadSource> | readonly AthenaStorageUploadSource[]
  storage_key?: string
  storageKey?: string
  storageKeyTemplate?: string
  prefixPath?: AthenaStoragePrefixPath
  fileName?: string
  name?: string
  original_name?: string
  resource_id?: string
  resourceId?: string
  organization_id?: string
  organizationId?: string
  user_id?: string
  userId?: string
  mime_type?: string
  content_type?: string
  public?: boolean
  metadata?: Record<string, unknown>
  vars?: AthenaStorageTemplateVars
  env?: AthenaStorageEnv
  uploadHeaders?: AthenaStorageUploadHeaders
  onProgress?: AthenaStorageUploadProgressHandler
}

export interface AthenaStorageUploadedFile {
  file: ManagedFileRecord
  upload: StorageUploadUrlResponse['upload']
  source: AthenaStorageUploadSource
  fileName: string
  storage_key: string
  response: Response
}

export interface AthenaStorageFileUploadResult {
  files: AthenaStorageUploadedFile[]
  count: number
}

export interface AthenaStorageFileListInput extends Omit<ListStorageFilesRequest, 'prefix'> {
  prefix?: string
  prefixPath?: AthenaStoragePrefixPath
  vars?: AthenaStorageTemplateVars
  env?: AthenaStorageEnv
  organization_id?: string
  organizationId?: string
  user_id?: string
  userId?: string
  resource_id?: string
  resourceId?: string
}

export interface AthenaStorageFileDownloadInput extends GetStorageFileUrlQuery {
  fileId?: string
  fileIds?: readonly string[]
}

export type AthenaStorageFileDeleteInput = string | readonly string[]

export interface AthenaStorageFileModule {
  upload(
    input: AthenaStorageFileUploadInput,
    options?: AthenaStorageCallOptions,
  ): Promise<AthenaStorageFileUploadResult>
  download(
    fileId: string,
    query?: GetStorageFileUrlQuery,
    options?: AthenaStorageBinaryCallOptions,
  ): Promise<Response>
  download(
    fileIds: readonly string[],
    query?: GetStorageFileUrlQuery,
    options?: AthenaStorageBinaryCallOptions,
  ): Promise<Response[]>
  download(
    input: AthenaStorageFileDownloadInput,
    options?: AthenaStorageBinaryCallOptions,
  ): Promise<Response | Response[]>
  list(
    input: AthenaStorageFileListInput,
    options?: AthenaStorageCallOptions,
  ): Promise<StorageListFilesResponse>
  delete(fileId: string, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
  delete(fileIds: readonly string[], options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse[]>
}

export interface AthenaStorageFileBaseModule {
  createStorageUploadUrl(
    input: CreateStorageUploadUrlRequest,
    options?: AthenaStorageCallOptions,
  ): Promise<StorageUploadUrlResponse>
  createStorageUploadUrls(
    input: { files: CreateStorageUploadUrlRequest[] },
    options?: AthenaStorageCallOptions,
  ): Promise<StorageBatchUploadUrlResponse>
  listStorageFiles(input: ListStorageFilesRequest, options?: AthenaStorageCallOptions): Promise<StorageListFilesResponse>
  getStorageFileProxy(
    fileId: string,
    query?: GetStorageFileUrlQuery,
    options?: AthenaStorageBinaryCallOptions,
  ): Promise<Response>
  deleteStorageFile(fileId: string, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>
}

interface NormalizedUploadSource {
  source: AthenaStorageUploadSource
  fileName: string
  sizeBytes: number
  contentType?: string
}

interface ResolvedUploadRequest {
  uploadRequest: CreateStorageUploadUrlRequest
  source: NormalizedUploadSource
}

interface AthenaStorageXhrProgressEvent {
  loaded: number
}

interface AthenaStorageXhr {
  readonly upload: {
    onprogress: ((event: AthenaStorageXhrProgressEvent) => void) | null
  }
  readonly status: number
  readonly statusText: string
  readonly response: unknown
  onload: (() => void) | null
  onerror: (() => void) | null
  onabort: (() => void) | null
  open(method: string, url: string): void
  setRequestHeader(key: string, value: string): void
  getAllResponseHeaders(): string
  send(body: unknown): void
  abort(): void
}

declare const XMLHttpRequest: (new () => AthenaStorageXhr) | undefined

export function createStorageFileModule(
  base: AthenaStorageFileBaseModule,
  config: AthenaStorageFileConfig = {},
): AthenaStorageFileModule {
  const upload: AthenaStorageFileModule['upload'] = async (input, options) => {
    const sources = normalizeUploadSources(input)
    validateUploadConstraints(sources, input)

    const uploadRequests = sources.map((source, index): ResolvedUploadRequest => {
      const storageKey = resolveUploadStorageKey(input, source, index, options, config)
      return {
        source,
        uploadRequest: {
          s3_id: input.s3_id,
          bucket: input.bucket,
          storage_key: storageKey,
          name: input.name ?? source.fileName,
          original_name: input.original_name ?? source.fileName,
          resource_id: input.resource_id ?? input.resourceId,
          mime_type: input.mime_type ?? source.contentType,
          content_type: input.content_type ?? source.contentType,
          size_bytes: source.sizeBytes,
          public: input.public,
          metadata: input.metadata,
          server_side_encryption: input.server_side_encryption,
          sse: input.sse,
          ssekms_key_id: input.ssekms_key_id,
          kms_key_id: input.kms_key_id,
          bucket_key_enabled: input.bucket_key_enabled,
        },
      }
    })

    input.onProgress?.(createProgressSnapshot('preparing', sources, 0, 0, 0))

    const uploadUrls =
      uploadRequests.length === 1
        ? [await base.createStorageUploadUrl(uploadRequests[0].uploadRequest, options)]
        : (await base.createStorageUploadUrls({ files: uploadRequests.map(request => request.uploadRequest) }, options)).files

    const aggregateLoaded = new Array(uploadRequests.length).fill(0) as number[]
    const uploaded: AthenaStorageUploadedFile[] = []

    for (let index = 0; index < uploadRequests.length; index += 1) {
      const request = uploadRequests[index]
      const uploadUrl = uploadUrls[index]
      const response = await putUploadBody(
        uploadUrl.upload.url,
        uploadUrl.upload.headers ?? {},
        request.source,
        input,
        options,
        progress => {
          aggregateLoaded[index] = progress.loaded
          input.onProgress?.(createProgressSnapshot('uploading', sources, index, progress.loaded, sum(aggregateLoaded)))
        },
      )
      uploaded.push({
        file: uploadUrl.file,
        upload: uploadUrl.upload,
        source: request.source.source,
        fileName: request.source.fileName,
        storage_key: request.uploadRequest.storage_key,
        response,
      })
      aggregateLoaded[index] = request.source.sizeBytes
      input.onProgress?.(createProgressSnapshot('complete', sources, index, request.source.sizeBytes, sum(aggregateLoaded)))
    }

    return {
      files: uploaded,
      count: uploaded.length,
    }
  }

  const download = ((
    input: string | readonly string[] | AthenaStorageFileDownloadInput,
    queryOrOptions?: GetStorageFileUrlQuery | AthenaStorageBinaryCallOptions,
    maybeOptions?: AthenaStorageBinaryCallOptions,
  ): Promise<Response | Response[]> => {
    const { fileIds, query, options } = normalizeDownloadArgs(input, queryOrOptions, maybeOptions)
    const downloads = fileIds.map(fileId => base.getStorageFileProxy(fileId, query, options))
    return Array.isArray(input) || (isRecord(input) && Array.isArray(input.fileIds))
      ? Promise.all(downloads)
      : downloads[0]
  }) as AthenaStorageFileModule['download']

  const deleteFile = ((
    input: string | readonly string[],
    options?: AthenaStorageCallOptions,
  ): Promise<StorageFileMutationResponse | StorageFileMutationResponse[]> => {
    if (Array.isArray(input)) {
      return Promise.all(input.map(fileId => base.deleteStorageFile(fileId, options)))
    }
    return base.deleteStorageFile(input as string, options)
  }) as AthenaStorageFileModule['delete']

  return {
    upload,
    download,

    list(input, options) {
      const prefix = resolveStoragePath(input.prefix ?? '', input, options, config)
      return base.listStorageFiles(
        {
          s3_id: input.s3_id,
          prefix,
        },
        options,
      )
    },

    delete: deleteFile,
  }
}

export function resolveStoragePath(
  path: string,
  input: {
    prefixPath?: AthenaStoragePrefixPath
    vars?: AthenaStorageTemplateVars
    env?: AthenaStorageEnv
    organization_id?: string
    organizationId?: string
    user_id?: string
    userId?: string
    resource_id?: string
    resourceId?: string
  },
  options: AthenaStorageCallOptions | undefined,
  config: AthenaStorageFileConfig = {},
): string {
  const context = createPathContext(input, options, config)
  const prefixPath = input.prefixPath ?? config.prefixPath
  const prefix = typeof prefixPath === 'function'
    ? prefixPath(context)
    : prefixPath
  return joinStoragePath(renderStorageTemplate(prefix ?? '', context), renderStorageTemplate(path, context))
}

function resolveUploadStorageKey(
  input: AthenaStorageFileUploadInput,
  source: NormalizedUploadSource,
  index: number,
  options: AthenaStorageCallOptions | undefined,
  config: AthenaStorageFileConfig,
): string {
  const explicitKey = input.storage_key ?? input.storageKey
  const keyTemplate = input.storageKeyTemplate
  const fallbackName = source.fileName
  const context = createPathContext(input, options, config)
  const key = keyTemplate
    ? renderStorageTemplate(keyTemplate, {
        ...context,
        vars: {
          ...context.vars,
          index,
          fileName: source.fileName,
          name: source.fileName,
        },
      })
    : explicitKey ?? fallbackName
  return resolveStoragePath(key, input, options, config)
}

function normalizeUploadSources(input: AthenaStorageFileUploadInput): NormalizedUploadSource[] {
  const files = toArray(input.files)
  if (files.length === 0) {
    throw new Error('athena.storage.file.upload requires at least one file')
  }
  return files.map((source, index) => {
    const fileName = input.fileName ?? sourceName(source) ?? `file-${index + 1}`
    const sizeBytes = sourceSize(source)
    const contentType = input.content_type ?? input.mime_type ?? sourceContentType(source)
    return {
      source,
      fileName,
      sizeBytes,
      contentType,
    }
  })
}

function validateUploadConstraints(sources: readonly NormalizedUploadSource[], input: AthenaStorageFileUploadInput): void {
  const maxFiles = input.maxFiles ?? 1
  if (sources.length > maxFiles) {
    throw new Error(`athena.storage.file.upload accepts at most ${maxFiles} file${maxFiles === 1 ? '' : 's'} for this call`)
  }

  const maxFileSizeBytes = input.maxFileSizeBytes ?? (
    input.maxFileSizeMb === undefined ? undefined : Math.floor(input.maxFileSizeMb * 1024 * 1024)
  )
  if (maxFileSizeBytes !== undefined) {
    const tooLarge = sources.find(source => source.sizeBytes > maxFileSizeBytes)
    if (tooLarge) {
      throw new Error(`athena.storage.file.upload rejected ${tooLarge.fileName}: file exceeds ${maxFileSizeBytes} bytes`)
    }
  }

  const allowedExtensions = normalizeExtensions(input.allowedExtensions ?? input.extensions)
  if (allowedExtensions.size > 0) {
    const invalid = sources.find(source => !allowedExtensions.has(fileExtension(source.fileName)))
    if (invalid) {
      throw new Error(`athena.storage.file.upload rejected ${invalid.fileName}: extension is not allowed`)
    }
  }
}

async function putUploadBody(
  url: string,
  uploadHeaders: Record<string, string>,
  source: NormalizedUploadSource,
  input: AthenaStorageFileUploadInput,
  options: AthenaStorageCallOptions | undefined,
  onProgress: (progress: { loaded: number }) => void,
): Promise<Response> {
  const headers = new Headers(uploadHeaders)
  new Headers(input.uploadHeaders).forEach((value, key) => headers.set(key, value))
  if (source.contentType && !headers.has('Content-Type')) {
    headers.set('Content-Type', source.contentType)
  }
  if (typeof XMLHttpRequest !== 'undefined') {
    return putUploadBodyWithXhr(url, source, headers, options, onProgress)
  }
  onProgress({ loaded: 0 })
  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: source.source as RequestInit['body'],
    signal: options?.signal,
  })
  if (!response.ok) {
    throw new Error(`athena.storage.file.upload failed with status ${response.status}`)
  }
  onProgress({ loaded: source.sizeBytes })
  return response
}

function putUploadBodyWithXhr(
  url: string,
  source: NormalizedUploadSource,
  headers: Headers,
  options: AthenaStorageCallOptions | undefined,
  onProgress: (progress: { loaded: number }) => void,
): Promise<Response> {
  const Xhr = XMLHttpRequest
  if (Xhr === undefined) {
    return Promise.reject(new Error('athena.storage.file.upload requires XMLHttpRequest in this runtime'))
  }
  return new Promise((resolve, reject) => {
    const xhr = new Xhr()
    const abort = () => xhr.abort()
    xhr.open('PUT', url)
    headers.forEach((value, key) => xhr.setRequestHeader(key, value))
    xhr.upload.onprogress = (event: AthenaStorageXhrProgressEvent) => {
      onProgress({ loaded: event.loaded })
    }
    xhr.onload = () => {
      if (options?.signal) {
        options.signal.removeEventListener('abort', abort)
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`athena.storage.file.upload failed with status ${xhr.status}`))
        return
      }
      onProgress({ loaded: source.sizeBytes })
      resolve(new Response(xhr.response as ConstructorParameters<typeof Response>[0], {
        status: xhr.status,
        statusText: xhr.statusText,
        headers: parseXhrHeaders(xhr.getAllResponseHeaders()),
      }))
    }
    xhr.onerror = () => {
      if (options?.signal) {
        options.signal.removeEventListener('abort', abort)
      }
      reject(new Error('athena.storage.file.upload failed with a network error'))
    }
    xhr.onabort = () => {
      if (options?.signal) {
        options.signal.removeEventListener('abort', abort)
      }
      reject(new DOMException('Upload aborted', 'AbortError'))
    }
    if (options?.signal) {
      if (options.signal.aborted) {
        abort()
        return
      }
      options.signal.addEventListener('abort', abort, { once: true })
    }
    xhr.send(source.source)
  })
}

function normalizeDownloadArgs(
  input: string | readonly string[] | AthenaStorageFileDownloadInput,
  queryOrOptions?: GetStorageFileUrlQuery | AthenaStorageBinaryCallOptions,
  maybeOptions?: AthenaStorageBinaryCallOptions,
): {
  fileIds: string[]
  query?: GetStorageFileUrlQuery
  options?: AthenaStorageBinaryCallOptions
} {
  if (typeof input === 'string') {
    return { fileIds: [input], query: queryOrOptions as GetStorageFileUrlQuery | undefined, options: maybeOptions }
  }
  if (Array.isArray(input)) {
    return { fileIds: [...input], query: queryOrOptions as GetStorageFileUrlQuery | undefined, options: maybeOptions }
  }
  const downloadInput = input as AthenaStorageFileDownloadInput
  const { fileId, fileIds, ...query } = downloadInput
  return {
    fileIds: fileIds ? [...fileIds] : fileId ? [fileId] : [],
    query,
    options: queryOrOptions as AthenaStorageBinaryCallOptions | undefined,
  }
}

function createPathContext(
  input: {
    vars?: AthenaStorageTemplateVars
    env?: AthenaStorageEnv
    organization_id?: string
    organizationId?: string
    user_id?: string
    userId?: string
    resource_id?: string
    resourceId?: string
  },
  options: AthenaStorageCallOptions | undefined,
  config: AthenaStorageFileConfig,
): AthenaStoragePathContext {
  const organizationId = input.organizationId ?? input.organization_id ?? options?.organizationId ?? undefined
  const userId = input.userId ?? input.user_id ?? options?.userId ?? undefined
  const resourceId = input.resourceId ?? input.resource_id ?? undefined
  const vars = {
    ...(config.vars ?? {}),
    ...(input.vars ?? {}),
  }
  if (organizationId !== undefined) {
    vars.organizationId = organizationId
    vars.organization_id = organizationId
  }
  if (userId !== undefined) {
    vars.userId = userId
    vars.user_id = userId
  }
  if (resourceId !== undefined) {
    vars.resourceId = resourceId
    vars.resource_id = resourceId
  }
  return {
    vars,
    env: {
      ...readProcessEnv(),
      ...(config.env ?? {}),
      ...(input.env ?? {}),
    },
    organizationId,
    organization_id: organizationId,
    userId,
    user_id: userId,
    resourceId,
    resource_id: resourceId,
  }
}

function renderStorageTemplate(template: string, context: AthenaStoragePathContext): string {
  return template.replace(/\$\{([^}]+)\}|\{([^}]+)\}/g, (_match, shellToken: string | undefined, braceToken: string | undefined) => {
    const token = (shellToken ?? braceToken ?? '').trim()
    if (!token) return ''
    const value = resolveTemplateToken(token, context)
    return value === undefined || value === null ? '' : String(value)
  })
}

function resolveTemplateToken(token: string, context: AthenaStoragePathContext): AthenaStorageTemplateValue {
  if (token.startsWith('env.')) {
    return context.env[token.slice(4)]
  }
  if (token in context.vars) {
    return context.vars[token]
  }
  return context.env[token]
}

function joinStoragePath(...parts: readonly string[]): string {
  return parts
    .map(part => part.trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
}

function toArray(files: AthenaStorageFileUploadInput['files']): AthenaStorageUploadSource[] {
  if (isUploadSource(files)) return [files]
  return Array.from(files)
}

function isUploadSource(value: unknown): value is AthenaStorageUploadSource {
  return value instanceof Blob || value instanceof ArrayBuffer || value instanceof Uint8Array
}

function sourceName(source: AthenaStorageUploadSource): string | undefined {
  return isRecord(source) && typeof source.name === 'string' && source.name.trim()
    ? source.name.trim()
    : undefined
}

function sourceSize(source: AthenaStorageUploadSource): number {
  if (source instanceof Blob) return source.size
  return source.byteLength
}

function sourceContentType(source: AthenaStorageUploadSource): string | undefined {
  return source instanceof Blob && source.type.trim() ? source.type.trim() : undefined
}

function normalizeExtensions(extensions: readonly string[] | undefined): Set<string> {
  return new Set((extensions ?? []).map(extension => extension.replace(/^\./, '').toLowerCase()).filter(Boolean))
}

function fileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.')
  return lastDot === -1 ? '' : fileName.slice(lastDot + 1).toLowerCase()
}

function createProgressSnapshot(
  phase: AthenaStorageUploadProgress['phase'],
  sources: readonly NormalizedUploadSource[],
  fileIndex: number,
  loaded: number,
  aggregateLoaded: number,
): AthenaStorageUploadProgress {
  const total = sources[fileIndex]?.sizeBytes ?? 0
  const aggregateTotal = sources.reduce((totalBytes, source) => totalBytes + source.sizeBytes, 0)
  return {
    phase,
    fileIndex,
    fileCount: sources.length,
    fileName: sources[fileIndex]?.fileName ?? '',
    loaded,
    total,
    percent: total > 0 ? Math.round((loaded / total) * 100) : 100,
    aggregateLoaded,
    aggregateTotal,
    aggregatePercent: aggregateTotal > 0 ? Math.round((aggregateLoaded / aggregateTotal) * 100) : 100,
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function parseXhrHeaders(raw: string): Headers {
  const headers = new Headers()
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const index = line.indexOf(':')
    if (index === -1) continue
    headers.set(line.slice(0, index).trim(), line.slice(index + 1).trim())
  }
  return headers
}

function readProcessEnv(): AthenaStorageEnv {
  const processLike = (globalThis as { process?: { env?: AthenaStorageEnv } }).process
  return processLike?.env ?? {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}
