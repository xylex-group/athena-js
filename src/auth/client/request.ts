import { buildSdkHeaderValue } from "../../sdk-version.ts";
import {
  ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM,
  ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_VALUE,
} from "../../utils/athena-auth-url.ts";
import { buildServiceRequestHeaders } from "../../utils/athena-request-headers.ts";
import type {
  AthenaAuthCallOptions,
  AthenaAuthClientConfig,
  AthenaAuthEndpointPath,
  AthenaAuthFetchCompatibleInput,
  AthenaAuthMethod,
  AthenaAuthQueryValue,
  AthenaAuthResult,
} from "../types.ts";
import { type AuthRequestContext, toErrorDetails } from "./errors.ts";
import { buildRequestUrl, extractQueryFromPayload } from "./query.ts";
import { parseAuthTransportResponse } from "./response.ts";

const SDK_NAME = "@xylex-group/athena-auth";
const SDK_HEADER_VALUE = buildSdkHeaderValue(SDK_NAME);
export const DEFAULT_AUTH_BASE_URL = "http://localhost:3001/api/auth";

export function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? DEFAULT_AUTH_BASE_URL).replace(/\/$/, "");
}

export function mergeCallOptions(
  base?: AthenaAuthCallOptions,
  override?: AthenaAuthCallOptions
): AthenaAuthCallOptions | undefined {
  if (!(base || override)) {
    return;
  }
  return {
    ...base,
    ...override,
    headers: {
      ...(base?.headers ?? {}),
      ...(override?.headers ?? {}),
    },
  };
}

export function authCallOptionsFromRequestContext(
  request: {
    bearerToken?: string | null;
    cookie?: string | null;
    forceNoCache?: boolean;
    headers?: Record<string, string>;
  }
): AthenaAuthCallOptions | undefined {
  const headers = Object.fromEntries(
    Object.entries(request.headers ?? {}).filter(
      ([name]) =>
        name.toLowerCase() !== "authorization" &&
        name.toLowerCase() !== "cookie"
    )
  );
  const hasHeaders = Object.keys(headers).length > 0;
  const hasContext =
    Boolean(request.bearerToken || request.cookie) ||
    request.forceNoCache === true ||
    hasHeaders;

  if (!hasContext) {
    return;
  }

  return {
    bearerToken: request.bearerToken ?? undefined,
    cookie: request.cookie ?? undefined,
    forceNoCache: request.forceNoCache,
    headers: hasHeaders ? headers : undefined,
  };
}

export function extractFetchOptions<
  T extends AthenaAuthFetchCompatibleInput | undefined,
>(input: T) {
  if (!input) {
    return {
      fetchOptions: undefined,
      payload: undefined,
    };
  }

  const { fetchOptions, ...rest } = input;
  const hasPayloadKeys = Object.keys(rest).length > 0;
  return {
    fetchOptions,
    payload: hasPayloadKeys ? rest : undefined,
  };
}

export function extractQueryFromInput(
  input?: AthenaAuthFetchCompatibleInput
): Record<string, AthenaAuthQueryValue> | undefined {
  const { payload } = extractFetchOptions(input);
  return extractQueryFromPayload(payload);
}

export function withFreshSessionLookupQuery(
  input?: AthenaAuthFetchCompatibleInput
): Record<string, AthenaAuthQueryValue> {
  const query = extractQueryFromInput(input) ?? {};
  const explicit = query[ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM];
  if (explicit === false || explicit === "false") {
    const next = { ...query };
    delete next[ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM];
    return next;
  }
  return {
    ...query,
    [ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM]:
      ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_VALUE,
  };
}

export function buildHeaders(
  config: AthenaAuthClientConfig,
  options?: AthenaAuthCallOptions
): Record<string, string> {
  return buildServiceRequestHeaders("auth", SDK_HEADER_VALUE, config, options);
}

export function inferDefaultMethod(
  endpoint: AthenaAuthEndpointPath
): AthenaAuthMethod {
  if (endpoint.startsWith("/reset-password/")) {
    return "GET";
  }
  if (
    endpoint.startsWith("/authorization/roles/") &&
    !endpoint.endsWith("/clone") &&
    !endpoint.endsWith("/rights")
  ) {
    return "GET";
  }

  switch (endpoint) {
    case "/get-session":
    case "/admin/get-user":
    case "/list-sessions":
    case "/verify-email":
    case "/change-email/verify":
    case "/delete-user/verify":
    case "/email-list":
    case "/email/list":
    case "/delete-user/callback":
    case "/list-accounts":
    case "/passkey/generate-register-options":
    case "/passkey/list-user-passkeys":
    case "/.well-known/webauthn":
    case "/.well-known/jwks.json":
    case "/.well-known/openid-configuration":
    case "/admin/list-users":
    case "/admin/athena-client/list":
    case "/admin/audit-log/list":
    case "/admin/email/get":
    case "/admin/email-failure/list":
    case "/admin/email-failure/get":
    case "/admin/email-template/get":
    case "/admin/email-template/list":
    case "/admin/email/list":
    case "/api-key/get":
    case "/api-key/list":
    case "/organization/get-full-organization":
    case "/organization/list":
    case "/organization/get-invitation":
    case "/organization/list-invitations":
    case "/organization/list-user-invitations":
    case "/organization/list-members":
    case "/organization/get-active-member":
    case "/authorization/snapshot":
    case "/authorization/authority-snapshot":
    case "/authorization/rights":
    case "/authorization/roles":
    case "/authorization/audit":
    case "/authorization/assignments/users":
    case "/authorization/assignments/members":
    case "/health":
    case "/ok":
    case "/error":
      return "GET";
    default:
      return "POST";
  }
}

export async function callAuthEndpoint<T>(
  config: AthenaAuthClientConfig,
  context: AuthRequestContext,
  body?: unknown,
  query?: Record<string, AthenaAuthQueryValue>,
  options?: AthenaAuthCallOptions
): Promise<AthenaAuthResult<T>> {
  const baseUrl = normalizeBaseUrl(options?.baseUrl ?? config.baseUrl);
  const url = buildRequestUrl(baseUrl, context.endpoint, query);
  const headers = buildHeaders(config, options);
  const credentials = options?.credentials ?? config.credentials ?? "include";
  const requestInit: RequestInit = {
    cache: "no-store",
    credentials,
    headers,
    method: context.method,
    signal: options?.signal,
  };

  if (context.method !== "GET") {
    requestInit.body = JSON.stringify(body ?? {});
  }

  const fetcher = config.fetch ?? globalThis.fetch;
  if (!fetcher) {
    const details = toErrorDetails({
      code: "UNKNOWN_ERROR",
      endpoint: context.endpoint,
      hint: "Use Node 18+ or provide `fetch` through createClient({ auth: { fetch } })",
      message: "No fetch implementation available for auth client",
      method: context.method,
      status: 0,
    });
    return {
      data: null,
      error: details.message,
      errorDetails: details,
      ok: false,
      raw: null,
      status: 0,
    };
  }

  try {
    const response = await fetcher(url, requestInit);
    const rawText = await response.text();
    return parseAuthTransportResponse<T>({
      context,
      rawText,
      response,
    });
  } catch (callError) {
    const message =
      callError instanceof Error ? callError.message : String(callError);
    const details = toErrorDetails({
      cause: message,
      code: "NETWORK_ERROR",
      endpoint: context.endpoint,
      hint: "Check auth server URL, DNS, and network reachability.",
      message: `Network error while calling ${context.method} ${context.endpoint}: ${message}`,
      method: context.method,
      status: 0,
    });
    return {
      data: null,
      error: details.message,
      errorDetails: details,
      ok: false,
      raw: null,
      status: 0,
    };
  }
}
