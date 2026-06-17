import type { AthenaAuthClientConfig } from './auth/types.ts'
import type { BackendConfig, BackendType } from './gateway/types.ts'
import type {
  AthenaClientBuilder,
  AthenaClientConfig,
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
  current: AthenaAuthClientConfig | undefined,
  next: AthenaAuthClientConfig,
): AthenaAuthClientConfig {
  const merged: AthenaAuthClientConfig = {
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
  private baseUrl?: string
  private apiKey?: string
  private backendConfig: BackendConfig = DEFAULT_BACKEND
  private clientName?: string
  private defaultHeaders?: Record<string, string>
  private authConfig?: AthenaAuthClientConfig
  private experimentalOptions?: AthenaClientExperimentalOptions

  constructor(
    private readonly buildClient: (config: AthenaClientConfig) => AthenaSdkClientWithAuth<false>,
  ) {}

  url(url: string): AthenaClientBuilder<false, false> {
    this.baseUrl = url
    return this
  }

  key(apiKey: string): AthenaClientBuilder<false, false> {
    this.apiKey = apiKey
    return this
  }

  backend(backend: BackendConfig | BackendType): AthenaClientBuilder<false, false> {
    this.backendConfig = toBackendConfig(backend)
    return this
  }

  client(clientName: string): AthenaClientBuilder<false, false> {
    this.clientName = clientName
    return this
  }

  headers(headers: Record<string, string>): AthenaClientBuilder<false, false> {
    this.defaultHeaders = headers
    return this
  }

  auth(config: AthenaAuthClientConfig): AthenaClientBuilder<false, false> {
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
    if (!this.baseUrl || !this.apiKey) {
      throw new Error('AthenaClient requires url and key; call .url() and .key() before .build()')
    }

    return this.buildClient({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      client: this.clientName,
      backend: this.backendConfig,
      headers: this.defaultHeaders,
      auth: this.authConfig,
      experimental: this.experimentalOptions,
    })
  }
}

export function createAthenaClientBuilder(
  buildClient: (config: AthenaClientConfig) => AthenaSdkClientWithAuth<false>,
): AthenaClientBuilder<false, false> {
  return new AthenaClientBuilderImpl(buildClient)
}
