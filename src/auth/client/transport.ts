import type {
  AthenaAuthCallOptions,
  AthenaAuthClientConfig,
  AthenaAuthEndpointPath,
  AthenaAuthFetchCompatibleInput,
  AthenaAuthQueryValue,
  AthenaAuthRequestInput,
  AthenaAuthResult,
} from "../types.ts";
import {
  executeGetWithCompatibleInput,
  executeGetWithQueryCompatibleInput,
  executePostWithCompatibleInput,
  executePostWithOptionalInput,
} from "./mutation.ts";
import {
  callAuthEndpoint,
  extractFetchOptions,
  extractQueryFromInput,
  inferDefaultMethod,
  mergeCallOptions,
  normalizeBaseUrl,
  withFreshSessionLookupQuery,
} from "./request.ts";
import type {
  InternalAuthSessionPersistence,
  InternalAuthSessionPersistenceAuthority,
} from "./session-persistence.ts";

export interface InternalAuthModuleRuntimeOptions {
  /** Whether deprecated flat aliases should emit compatibility warnings. */
  compatibilityWarnings?: boolean;
  sessionPersistence?: InternalAuthSessionPersistence;
  sessionPersistenceAuthority?: InternalAuthSessionPersistenceAuthority;
  resolveCallOptions?: () =>
    | AthenaAuthCallOptions
    | undefined
    | Promise<AthenaAuthCallOptions | undefined>;
}

export const ATHENA_AUTH_BIND_BASE_URL = Symbol.for(
  "@xylex-group/athena.auth.bindBaseUrl"
);

export interface AuthClientWithBindableBaseUrl {
  [ATHENA_AUTH_BIND_BASE_URL]?: (baseUrl: string) => void;
}

export function bindAthenaAuthClientBaseUrl(
  auth: object,
  baseUrl: string
): void {
  const bind = (auth as AuthClientWithBindableBaseUrl)[
    ATHENA_AUTH_BIND_BASE_URL
  ];
  bind?.(baseUrl);
}

export type AuthTransportRequest = <T = unknown>(
  input: AthenaAuthRequestInput,
  options?: AthenaAuthCallOptions
) => Promise<AthenaAuthResult<T>>;

export interface AuthTransport {
  bindBaseUrl(baseUrl: string): void;
  callAuthEndpoint: typeof callAuthEndpoint;
  executeGetWithCompatibleInput: typeof executeGetWithCompatibleInput;
  executeGetWithQueryCompatibleInput: typeof executeGetWithQueryCompatibleInput;
  executePostWithCompatibleInput: typeof executePostWithCompatibleInput;
  executePostWithOptionalInput: typeof executePostWithOptionalInput;
  extractFetchOptions: typeof extractFetchOptions;
  getGeneric: <T = unknown>(
    endpoint: AthenaAuthEndpointPath,
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<T>>;
  getWithQuery: <
    T = unknown,
    TQuery extends object = Record<string, AthenaAuthQueryValue>,
  >(
    endpoint: AthenaAuthEndpointPath,
    input?: AthenaAuthFetchCompatibleInput & {
      query?: TQuery;
    },
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<T>>;
  mergeCallOptions: typeof mergeCallOptions;
  postGeneric: <T = unknown>(
    endpoint: AthenaAuthEndpointPath,
    input?: AthenaAuthFetchCompatibleInput & object,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<T>>;
  request: AuthTransportRequest;
  readonly resolvedConfig: AthenaAuthClientConfig;
}

export function createAuthTransport(
  config: AthenaAuthClientConfig = {},
  runtimeOptions: InternalAuthModuleRuntimeOptions = {}
): AuthTransport {
  const resolvedConfig: AthenaAuthClientConfig = {
    ...config,
    baseUrl: normalizeBaseUrl(config.baseUrl),
  };

  const request: AuthTransportRequest = async <T = unknown>(
    input: AthenaAuthRequestInput,
    options?: AthenaAuthCallOptions
  ): Promise<AthenaAuthResult<T>> => {
    const method =
      input.method ??
      (input.body === undefined ? inferDefaultMethod(input.endpoint) : "POST");
    const contextOptions = await runtimeOptions.resolveCallOptions?.();
    const mergedOptions = mergeCallOptions(
      mergeCallOptions(contextOptions, input.fetchOptions),
      options
    );
    return await callAuthEndpoint<T>(
      resolvedConfig,
      { endpoint: input.endpoint, method },
      input.body,
      input.query,
      mergedOptions
    );
  };

  const postGeneric = <T = unknown>(
    endpoint: AthenaAuthEndpointPath,
    input?: AthenaAuthFetchCompatibleInput & object,
    options?: AthenaAuthCallOptions
  ) => {
    const { payload, fetchOptions } = extractFetchOptions(input);
    return request<T>(
      {
        body: payload ?? {},
        endpoint,
        fetchOptions,
        method: "POST",
      },
      options
    );
  };

  const getGeneric = <T = unknown>(
    endpoint: AthenaAuthEndpointPath,
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => {
    const { fetchOptions } = extractFetchOptions(input);
    return request<T>(
      {
        endpoint,
        fetchOptions,
        method: "GET",
        query:
          endpoint === "/get-session"
            ? withFreshSessionLookupQuery(input)
            : extractQueryFromInput(input),
      },
      options
    );
  };

  const getWithQuery = <
    T = unknown,
    TQuery extends object = Record<string, AthenaAuthQueryValue>,
  >(
    endpoint: AthenaAuthEndpointPath,
    input?: AthenaAuthFetchCompatibleInput & {
      query?: TQuery;
    },
    options?: AthenaAuthCallOptions
  ) => {
    const { payload, fetchOptions } = extractFetchOptions(input);
    const query = (payload as { query?: TQuery } | undefined)?.query as
      | Record<string, AthenaAuthQueryValue>
      | undefined;
    return request<T>(
      {
        endpoint,
        fetchOptions,
        method: "GET",
        query,
      },
      options
    );
  };

  return {
    bindBaseUrl(baseUrl: string) {
      resolvedConfig.baseUrl = normalizeBaseUrl(baseUrl);
    },
    callAuthEndpoint,
    executeGetWithCompatibleInput,
    executeGetWithQueryCompatibleInput,
    executePostWithCompatibleInput,
    executePostWithOptionalInput,
    extractFetchOptions,
    getGeneric,
    getWithQuery,
    mergeCallOptions,
    postGeneric,
    request,
    resolvedConfig,
  };
}
