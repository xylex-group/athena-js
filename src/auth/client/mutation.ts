import type {
  AthenaAuthCallOptions,
  AthenaAuthClientConfig,
  AthenaAuthFetchCompatibleInput,
  AthenaAuthQueryValue,
  AthenaAuthResult,
} from "../types.ts";
import type { AuthRequestContext } from "./errors.ts";
import {
  callAuthEndpoint,
  extractFetchOptions,
  mergeCallOptions,
} from "./request.ts";

export function executePostWithCompatibleInput<
  TPayload extends AthenaAuthFetchCompatibleInput,
  TResult,
>(
  config: AthenaAuthClientConfig,
  context: AuthRequestContext,
  input: TPayload,
  options?: AthenaAuthCallOptions
): Promise<AthenaAuthResult<TResult>> {
  const { payload, fetchOptions } = extractFetchOptions(input);
  const mergedOptions = mergeCallOptions(fetchOptions, options);
  return callAuthEndpoint<TResult>(
    config,
    context,
    payload ?? {},
    undefined,
    mergedOptions
  );
}

export function executePostWithOptionalInput<TResult>(
  config: AthenaAuthClientConfig,
  context: AuthRequestContext,
  input?: AthenaAuthFetchCompatibleInput,
  options?: AthenaAuthCallOptions
): Promise<AthenaAuthResult<TResult>> {
  const { fetchOptions } = extractFetchOptions(input);
  const mergedOptions = mergeCallOptions(fetchOptions, options);
  return callAuthEndpoint<TResult>(
    config,
    context,
    {},
    undefined,
    mergedOptions
  );
}

export function executeGetWithCompatibleInput<TResult>(
  config: AthenaAuthClientConfig,
  context: AuthRequestContext,
  input?: AthenaAuthFetchCompatibleInput,
  options?: AthenaAuthCallOptions
): Promise<AthenaAuthResult<TResult>> {
  const { fetchOptions } = extractFetchOptions(input);
  const mergedOptions = mergeCallOptions(fetchOptions, options);
  return callAuthEndpoint<TResult>(
    config,
    context,
    undefined,
    undefined,
    mergedOptions
  );
}

export function executeGetWithQueryCompatibleInput<
  TQuery extends object,
  TResult,
>(
  config: AthenaAuthClientConfig,
  context: AuthRequestContext,
  input?: { query?: TQuery } & AthenaAuthFetchCompatibleInput,
  options?: AthenaAuthCallOptions
): Promise<AthenaAuthResult<TResult>> {
  const { payload, fetchOptions } = extractFetchOptions(input);
  const mergedOptions = mergeCallOptions(fetchOptions, options);
  const query = (
    payload as { query?: Record<string, AthenaAuthQueryValue> } | undefined
  )?.query;
  return callAuthEndpoint<TResult>(
    config,
    context,
    undefined,
    query,
    mergedOptions
  );
}
