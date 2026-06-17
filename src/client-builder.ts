import type { BackendConfig, BackendType } from './gateway/types.ts'
import type {
  AthenaClientBuilder,
  AthenaCreateClientAuthOptions,
  AthenaCreateClientConfig,
  AthenaClientExperimentalOptions,
  AthenaCreateClientOptions,
  AthenaCreateClientOptionsWithStorage,
  AthenaCreateClientOptionsWithStorageAndTypecheckedColumns,
  AthenaCreateClientOptionsWithTypecheckedColumns,
  AthenaSdkClientWithAuth,
} from './client.ts'

const DEFAULT_BACKEND: BackendConfig = { type: 'athena' }

export function toBackendConfig(value: BackendConfig | BackendType | undefined): BackendConfig {
  if (!value) return DEFAULT_BACKEND
  return typeof value === 'string' ? { type: value } : value
}

function mergeHeaders(
  current: Record<string, string> | undefined,
  next: Record<string, string>,
): Record<string, string> {
  return {
    ...(current ?? {}),
    ...next,
  }
}

function mergeAuthClientConfig(
  current: AthenaCreateClientAuthOptions | undefined,
  next: AthenaCreateClientAuthOptions,
): AthenaCreateClientAuthOptions {
  const merged: AthenaCreateClientAuthOptions = {
    ...(current ?? {}),
    ...next,
  }
  if (current?.headers || next.headers) {
    merged.headers = mergeHeaders(current?.headers, next.headers ?? {})
  }
  return merged
}

function mergeExperimentalOptions(
  current: AthenaClientExperimentalOptions | undefined,
  next: AthenaClientExperimentalOptions,
): AthenaClientExperimentalOptions {
  const merged: AthenaClientExperimentalOptions = {
    ...(current ?? {}),
    ...next,
  }
  if (
    current?.traceQueries &&
    typeof current.traceQueries === 'object' &&
    next.traceQueries &&
    typeof next.traceQueries === 'object'
  ) {
    merged.traceQueries = {
      ...current.traceQueries,
      ...next.traceQueries,
    }
  }
  if (current?.storage || next.storage) {
    merged.storage = {
      ...(current?.storage ?? {}),
      ...(next.storage ?? {}),
    }
  }
  return merged
}

function resolveBuilderReturn<
  TStorageEnabled extends boolean,
  TStrict extends boolean,
>(
  builder: AthenaClientBuilder<false, false>,
  storageEnabled: TStorageEnabled,
  strictEnabled: TStrict,
): AthenaClientBuilder<TStorageEnabled, TStrict> {
  void storageEnabled
  void strictEnabled
  return builder as unknown as AthenaClientBuilder<TStorageEnabled, TStrict>
}

class AthenaClientBuilderImpl implements AthenaClientBuilder<false, false> {
  private rootUrl?: string | null
  private apiKey?: string | null
  private backendConfig: BackendConfig = DEFAULT_BACKEND
  private clientName?: string | null
  private defaultHeaders?: Record<string, string>
  private authConfig?: AthenaCreateClientAuthOptions
  private dbUrlOverride?: string
  private gatewayUrlOverride?: string
  private authUrlOverride?: string
  private storageUrlOverride?: string
  private experimentalOptions?: AthenaClientExperimentalOptions

  constructor(
    private readonly buildClient: (config: AthenaCreateClientConfig) => AthenaSdkClientWithAuth<false>,
  ) {}

  url(url: string | null | undefined): AthenaClientBuilder<false, false> {
    this.rootUrl = url
    return this
  }

  key(apiKey: string | null | undefined): AthenaClientBuilder<false, false> {
    this.apiKey = apiKey
    return this
  }

  backend(backend: BackendConfig | BackendType): AthenaClientBuilder<false, false> {
    this.backendConfig = toBackendConfig(backend)
    return this
  }

  client(clientName: string | null | undefined): AthenaClientBuilder<false, false> {
    this.clientName = clientName
    return this
  }

  headers(headers: Record<string, string>): AthenaClientBuilder<false, false> {
    this.defaultHeaders = headers
    return this
  }

  auth(config: AthenaCreateClientAuthOptions): AthenaClientBuilder<false, false> {
    this.authConfig = mergeAuthClientConfig(this.authConfig, config)
    return this
  }

  experimental(
    options: AthenaClientExperimentalOptions & { athenaStorageBackend: true; typecheckColumns: true },
  ): AthenaClientBuilder<true, true>
  experimental(options: AthenaClientExperimentalOptions & { athenaStorageBackend: true }): AthenaClientBuilder<true, false>
  experimental(options: AthenaClientExperimentalOptions & { typecheckColumns: true }): AthenaClientBuilder<false, true>
  experimental(options: AthenaClientExperimentalOptions): AthenaClientBuilder<false, false>
  experimental(
    options: AthenaClientExperimentalOptions,
  ): AthenaClientBuilder<false, false> | AthenaClientBuilder<true, false> | AthenaClientBuilder<true, true> | AthenaClientBuilder<false, true> {
    this.experimentalOptions = mergeExperimentalOptions(this.experimentalOptions, options)
    if (options.athenaStorageBackend && options.typecheckColumns) {
      return resolveBuilderReturn(this, true, true)
    }
    if (options.athenaStorageBackend) {
      return resolveBuilderReturn(this, true, false)
    }
    if (options.typecheckColumns) {
      return resolveBuilderReturn(this, false, true)
    }
    return this
  }

  options(options: AthenaCreateClientOptionsWithStorageAndTypecheckedColumns): AthenaClientBuilder<true, true>
  options(options: AthenaCreateClientOptionsWithStorage): AthenaClientBuilder<true, false>
  options(options: AthenaCreateClientOptionsWithTypecheckedColumns): AthenaClientBuilder<false, true>
  options(options: AthenaCreateClientOptions): AthenaClientBuilder<false, false>
  options(
    options: AthenaCreateClientOptions,
  ): AthenaClientBuilder<false, false> | AthenaClientBuilder<true, false> | AthenaClientBuilder<true, true> | AthenaClientBuilder<false, true> {
    if (options.client !== undefined) {
      this.clientName = options.client
    }
    if (options.backend !== undefined) {
      this.backendConfig = toBackendConfig(options.backend)
    }
    if (options.headers !== undefined) {
      this.defaultHeaders = mergeHeaders(this.defaultHeaders, options.headers)
    }
    if (options.auth !== undefined) {
      this.authConfig = mergeAuthClientConfig(this.authConfig, options.auth)
    }
    if (options.db?.url !== undefined && options.db.url !== null) {
      this.dbUrlOverride = options.db.url
    }
    if (options.gateway?.url !== undefined && options.gateway.url !== null) {
      this.gatewayUrlOverride = options.gateway.url
    }
    if (options.dbUrl !== undefined && options.dbUrl !== null) {
      this.dbUrlOverride = options.dbUrl
    }
    if (options.gatewayUrl !== undefined && options.gatewayUrl !== null) {
      this.gatewayUrlOverride = options.gatewayUrl
    }
    if (options.authUrl !== undefined && options.authUrl !== null) {
      this.authUrlOverride = options.authUrl
    }
    if (options.storage?.url !== undefined && options.storage.url !== null) {
      this.storageUrlOverride = options.storage.url
    }
    if (options.storageUrl !== undefined && options.storageUrl !== null) {
      this.storageUrlOverride = options.storageUrl
    }
    if (options.experimental !== undefined) {
      this.experimentalOptions = mergeExperimentalOptions(this.experimentalOptions, options.experimental)
    }
    if (options.experimental?.athenaStorageBackend && options.experimental.typecheckColumns) {
      return resolveBuilderReturn(this, true, true)
    }
    if (options.experimental?.athenaStorageBackend) {
      return resolveBuilderReturn(this, true, false)
    }
    if (options.experimental?.typecheckColumns) {
      return resolveBuilderReturn(this, false, true)
    }
    return this
  }

  build(): AthenaSdkClientWithAuth<false> {
    if ((!this.rootUrl && !this.dbUrlOverride && !this.gatewayUrlOverride) || !this.apiKey) {
      throw new Error(
        'AthenaClient requires key plus either .url() or a db/gateway override before .build()',
      )
    }

    return this.buildClient({
      url: this.rootUrl,
      key: this.apiKey,
      client: this.clientName,
      backend: this.backendConfig,
      headers: this.defaultHeaders,
      db: this.dbUrlOverride ? { url: this.dbUrlOverride } : undefined,
      gateway: this.gatewayUrlOverride ? { url: this.gatewayUrlOverride } : undefined,
      auth: this.authConfig,
      authUrl: this.authUrlOverride,
      storage: this.storageUrlOverride ? { url: this.storageUrlOverride } : undefined,
      storageUrl: this.storageUrlOverride,
      experimental: this.experimentalOptions,
    })
  }
}

export function createAthenaClientBuilder(
  buildClient: (config: AthenaCreateClientConfig) => AthenaSdkClientWithAuth<false>,
): AthenaClientBuilder<false, false> {
  return new AthenaClientBuilderImpl(buildClient)
}
