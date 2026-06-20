import type {
  AthenaGatewayBaseOptions,
  AthenaGatewayCallOptions,
  AthenaGatewayConnectionOptions,
  AthenaGatewayConnectionResult,
  AthenaGatewayEndpointPath,
  AthenaGatewayErrorDetails,
  AthenaGatewayMethod,
  AthenaRpcCallOptions,
  AthenaRpcPayload,
  AthenaGatewayResponse,
} from "./types.js";
import type {
  AthenaDeletePayload,
  AthenaFetchPayload,
  AthenaInsertPayload,
  AthenaRpcFilter,
  AthenaUpdatePayload,
  AthenaQueryPayload,
} from "./types.js";
import { AthenaGatewayError } from "./errors.ts";
import {
  ATHENA_DEFAULT_BASE_URL,
  buildAthenaGatewayUrl,
  normalizeAthenaGatewayBaseUrl,
} from "./url.ts";
import { getSessionCookie } from "../cookies/index.ts";
import { buildSdkHeaderValue } from "../sdk-version.ts";

const DEFAULT_CLIENT = "railway_direct";
const SDK_NAME = "xylex-group/athena";
const SDK_HEADER_VALUE = buildSdkHeaderValue(SDK_NAME);
const NO_CACHE_HEADER_VALUE = 'no-cache'

function parseResponseBody(rawText: string, contentType: string | null) {
  if (!rawText) {
    return { parsed: null as unknown, parseFailed: false };
  }

  const contentTypeSuggestsJson =
    contentType?.toLowerCase().includes("application/json") ?? false;
  const looksJson =
    contentTypeSuggestsJson || rawText.startsWith("{") || rawText.startsWith("[");

  if (!looksJson) {
    return { parsed: rawText as unknown, parseFailed: false };
  }

  try {
    return { parsed: JSON.parse(rawText) as unknown, parseFailed: false };
  } catch {
    return { parsed: rawText as unknown, parseFailed: true };
  }
}

function normalizeHeaderValue(value?: string | null) {
  return value ? value : undefined;
}

function isCacheControlHeaderName(name: string) {
  return name.toLowerCase() === 'cache-control'
}

function resolveHeaderValue(
  headers: Record<string, string>,
  candidates: string[],
): string | undefined {
  for (const candidate of candidates) {
    const direct = normalizeHeaderValue(headers[candidate]);
    if (direct) return direct;
  }

  const loweredCandidates = new Set(candidates.map(candidate => candidate.toLowerCase()));
  for (const [key, value] of Object.entries(headers)) {
    if (!loweredCandidates.has(key.toLowerCase())) {
      continue;
    }
    const normalized = normalizeHeaderValue(value);
    if (normalized) return normalized;
  }

  return undefined;
}

function resolveBearerTokenFromAuthorizationHeader(
  headers: Record<string, string>,
): string | undefined {
  const authorization = resolveHeaderValue(headers, ["Authorization"]);
  if (!authorization) {
    return undefined;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token ? token : undefined;
}

function resolveSessionTokenFromCookieHeader(
  headers: Record<string, string>,
): string | undefined {
  const cookie = resolveHeaderValue(headers, ["Cookie"]);
  if (!cookie) {
    return undefined;
  }

  return getSessionCookie(new Headers({ cookie })) ?? undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function resolveStructuredErrorPayload(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null;
  return isRecord(payload.error) ? payload.error : payload;
}

function resolveRequestId(headers: Headers): string | undefined {
  return (
    headers.get("x-request-id") ??
    headers.get("x-correlation-id") ??
    headers.get("x-athena-request-id") ??
    undefined
  );
}

function resolveErrorMessage(payload: unknown, fallback: string) {
  const structuredPayload = resolveStructuredErrorPayload(payload);
  if (structuredPayload) {
    const messageCandidates = [structuredPayload.message, structuredPayload.error, structuredPayload.details];
    for (const candidate of messageCandidates) {
      const resolved = nonEmptyString(candidate);
      if (resolved) return resolved;
    }
  }

  const rawMessage = nonEmptyString(payload);
  if (rawMessage) return rawMessage;

  return fallback;
}

function resolveErrorHint(payload: unknown): string | undefined {
  const structuredPayload = resolveStructuredErrorPayload(payload);
  return structuredPayload ? nonEmptyString(structuredPayload.hint) : undefined;
}

function resolveStatusText(response: Response, payload: unknown): string | null {
  const rawStatusText = nonEmptyString(response.statusText);
  if (rawStatusText) return rawStatusText;
  const payloadRecord = isRecord(payload) ? payload : null;
  return payloadRecord ? nonEmptyString(payloadRecord.statusText) ?? null : null;
}

function detailsFromError(error: AthenaGatewayError): AthenaGatewayErrorDetails {
  return error.toDetails();
}

interface AthenaFindManyAstPayload {
  table_name: string;
  select: Record<string, unknown>;
  where?: Record<string, unknown>;
  orderBy?: Record<string, unknown>;
  limit?: number;
}

function toQueryScalar(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  return String(value);
}

function toQueryArray(values: unknown[]): string {
  return `{${values.map(toQueryScalar).join(",")}}`;
}

function toRpcArgumentQueryValue(value: unknown): string {
  if (Array.isArray(value)) return toQueryArray(value);
  if (value && typeof value === "object") return JSON.stringify(value);
  return toQueryScalar(value);
}

function toRpcFilterQueryValue(filter: AthenaRpcFilter): string {
  const value = filter.value;
  switch (filter.operator) {
    case "in": {
      if (!Array.isArray(value)) {
        throw new AthenaGatewayError({
          code: "UNKNOWN_ERROR",
          message: `RPC filter "${filter.column}" with operator "in" requires an array value`,
          status: 0,
        });
      }
      return `in.${toQueryArray(value)}`;
    }
    case "is":
      return `is.${toQueryScalar(value)}`;
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "like":
    case "ilike":
      return `${filter.operator}.${toQueryScalar(value)}`;
  }
}

function buildRpcGetEndpoint(payload: AthenaRpcPayload): AthenaGatewayEndpointPath {
  const functionName = (payload.function_name ?? payload.function).trim();
  if (!functionName) {
    throw new AthenaGatewayError({
      code: "UNKNOWN_ERROR",
      message: "rpc requires a function name",
      status: 0,
      endpoint: "/gateway/rpc",
      method: "GET",
    });
  }

  const query = new URLSearchParams();
  if (payload.schema) query.set("schema", payload.schema);
  if (payload.select) query.set("select", payload.select);
  if (payload.count) query.set("count", payload.count);
  if (payload.head) query.set("head", "true");
  if (typeof payload.limit === "number") query.set("limit", String(payload.limit));
  if (typeof payload.offset === "number") query.set("offset", String(payload.offset));
  if (payload.order?.column) {
    query.set(
      "order",
      payload.order.ascending === false
        ? `${payload.order.column}.desc`
        : payload.order.column,
    );
  }

  if (payload.args) {
    for (const [key, value] of Object.entries(payload.args)) {
      query.set(key, toRpcArgumentQueryValue(value));
    }
  }

  if (payload.filters?.length) {
    for (const filter of payload.filters) {
      if (payload.args && Object.prototype.hasOwnProperty.call(payload.args, filter.column)) {
        throw new AthenaGatewayError({
          code: "UNKNOWN_ERROR",
          message: `RPC filter "${filter.column}" conflicts with RPC argument "${filter.column}" in GET mode`,
          status: 0,
        });
      }
      query.append(filter.column, toRpcFilterQueryValue(filter));
    }
  }

  const endpoint = `/rpc/${encodeURIComponent(functionName)}`;
  const queryText = query.toString();
  const withQuery = queryText ? `${endpoint}?${queryText}` : endpoint;
  return withQuery as AthenaGatewayEndpointPath;
}

function buildHeaders(
  config: AthenaGatewayBaseOptions,
  options?: AthenaGatewayCallOptions,
): Record<string, string> {
  const mergedStripNulls = options?.stripNulls ?? true;
  const forceNoCache = Boolean(config.forceNoCache || options?.forceNoCache)
  const extraHeaders = {
    ...(config.headers ?? {}),
    ...(options?.headers ?? {}),
  };
  const headerClient =
    extraHeaders["x-athena-client"] ?? extraHeaders["X-Athena-Client"];
  const finalClient =
    options?.client ??
    config.client ??
    (typeof headerClient === "string" ? headerClient : undefined) ??
    DEFAULT_CLIENT;
  const finalApiKey = options?.apiKey ?? config.apiKey;
  const finalPublishEvent = options?.publishEvent ?? config.publishEvent;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Athena-Sdk": SDK_HEADER_VALUE,
  };

  if (options?.userId ?? config.userId) {
    headers["X-User-Id"] = options?.userId ?? config.userId ?? "";
  }

  if (options?.organizationId ?? config.organizationId) {
    headers["X-Organization-Id"] =
      options?.organizationId ?? config.organizationId ?? "";
  }

  if (finalClient) {
    headers["X-Athena-Client"] = finalClient;
  }

  const finalBackend = options?.backend ?? config.backend;
  if (finalBackend) {
    const type =
      typeof finalBackend === "string" ? finalBackend : finalBackend.type;
    if (type) headers["X-Backend-Type"] = type;
  }

  if (typeof mergedStripNulls === "boolean") {
    headers["X-Strip-Nulls"] = mergedStripNulls ? "true" : "false";
  }

  if (finalPublishEvent) {
    headers["X-Publish-Event"] = finalPublishEvent;
  }

  if (finalApiKey) {
    headers["apikey"] = finalApiKey;
    headers["x-api-key"] = headers["x-api-key"] ?? finalApiKey;
  }

  const explicitSessionToken = resolveHeaderValue(extraHeaders, [
    "X-Athena-Auth-Session-Token",
  ]);
  const derivedSessionToken =
    explicitSessionToken ?? resolveSessionTokenFromCookieHeader(extraHeaders);
  if (derivedSessionToken) {
    headers["X-Athena-Auth-Session-Token"] = derivedSessionToken;
  }

  const explicitBearerToken = resolveHeaderValue(extraHeaders, [
    "X-Athena-Auth-Bearer-Token",
  ]);
  const derivedBearerToken =
    explicitBearerToken ?? resolveBearerTokenFromAuthorizationHeader(extraHeaders);
  if (derivedBearerToken) {
    headers["X-Athena-Auth-Bearer-Token"] = derivedBearerToken;
  }

  const athenaClientKeys = ["x-athena-client", "X-Athena-Client"];
  Object.entries(extraHeaders).forEach(([key, value]) => {
    if (athenaClientKeys.includes(key)) return;
    if (forceNoCache && isCacheControlHeaderName(key)) return;
    const normalized = normalizeHeaderValue(value);
    if (normalized) {
      headers[key] = normalized;
    }
  });

  if (forceNoCache) {
    headers['Cache-Control'] = NO_CACHE_HEADER_VALUE
  }

  return headers;
}

function toInvalidUrlResponse<T>(
  error: unknown,
  endpoint: AthenaGatewayEndpointPath,
  method: AthenaGatewayMethod,
): AthenaGatewayResponse<T> {
  const message = error instanceof Error ? error.message : String(error);
  const gatewayError =
    error instanceof AthenaGatewayError
      ? error
      : new AthenaGatewayError({
          code: "INVALID_URL",
          message,
          status: 0,
          endpoint,
          method,
          cause: message,
          hint: "Set ATHENA_URL to a full http(s) URL before running queries.",
        });

  return {
    ok: false,
    status: 0,
    statusText: null,
    data: null,
    error: gatewayError.message,
    errorDetails: detailsFromError(
      new AthenaGatewayError({
        code: gatewayError.code,
        message: gatewayError.message,
        status: gatewayError.status,
        endpoint,
        method,
        requestId: gatewayError.requestId,
        hint: gatewayError.hint,
        cause: gatewayError.causeDetail,
      }),
    ),
    raw: null,
  };
}

function resolveGatewayBaseUrl(input?: string | null) {
  return normalizeAthenaGatewayBaseUrl(input, {
    defaultBaseUrl: ATHENA_DEFAULT_BASE_URL,
  });
}

function resolveProbePath(path?: string) {
  if (!path) return "/";
  if (!path.startsWith("/")) {
    throw new AthenaGatewayError({
      code: "INVALID_URL",
      message: `Athena gateway probe path must start with "/". Received ${JSON.stringify(path)}.`,
      status: 0,
      hint: 'Use a leading slash such as "/" or "/health".',
    });
  }
  return path;
}

function mergeConnectionHeaders(
  baseHeaders: Record<string, string>,
  headers?: Record<string, string>,
): Record<string, string> {
  const merged = {
    ...baseHeaders,
    ...(headers ?? {}),
  };

  if (!merged["X-Athena-Sdk"] && !merged["x-athena-sdk"]) {
    merged["X-Athena-Sdk"] = SDK_HEADER_VALUE;
  }

  return merged;
}

async function performConnectionCheck(
  baseUrl: string,
  requestHeaders: Record<string, string>,
  options?: AthenaGatewayConnectionOptions,
): Promise<AthenaGatewayConnectionResult> {
  const path = resolveProbePath(options?.path);
  const url = buildAthenaGatewayUrl(baseUrl, path);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: mergeConnectionHeaders(requestHeaders, options?.headers),
      signal: options?.signal,
    });
    const rawText = await response.text();
    const requestId = resolveRequestId(response.headers);
    const parsedBody = parseResponseBody(
      rawText ?? "",
      response.headers.get("content-type"),
    );

    if (parsedBody.parseFailed) {
      const invalidJsonError = new AthenaGatewayError({
        code: "INVALID_JSON",
        message: "Gateway probe returned malformed JSON",
        status: response.status,
        method: "GET",
        requestId,
        hint: "Verify the gateway response body is valid JSON.",
        cause: rawText.slice(0, 300),
      });
      return {
        ok: false,
        reachable: true,
        status: response.status,
        statusText: resolveStatusText(response, parsedBody.parsed),
        baseUrl,
        url,
        error: invalidJsonError.message,
        errorDetails: detailsFromError(invalidJsonError),
        raw: parsedBody.parsed,
      };
    }

    const parsed = parsedBody.parsed;
    if (!response.ok) {
      const httpError = new AthenaGatewayError({
        code: "HTTP_ERROR",
        message: resolveErrorMessage(
          parsed,
          `Athena gateway GET ${path} failed with status ${response.status}`,
        ),
        status: response.status,
        method: "GET",
        requestId,
        hint: resolveErrorHint(parsed),
      });

      return {
        ok: false,
        reachable: true,
        status: response.status,
        statusText: resolveStatusText(response, parsed),
        baseUrl,
        url,
        error: httpError.message,
        errorDetails: detailsFromError(httpError),
        raw: parsed,
      };
    }

    return {
      ok: true,
      reachable: true,
      status: response.status,
      statusText: resolveStatusText(response, parsed),
      baseUrl,
      url,
      error: undefined,
      errorDetails: null,
      raw: parsed,
    };
  } catch (callError) {
    const message = callError instanceof Error ? callError.message : String(callError);
    const networkError = new AthenaGatewayError({
      code: "NETWORK_ERROR",
      message: `Network error while probing Athena gateway ${url}: ${message}`,
      method: "GET",
      cause: message,
      hint: "Check gateway URL, DNS, and network reachability.",
    });
    return {
      ok: false,
      reachable: false,
      status: 0,
      statusText: null,
      baseUrl,
      url,
      error: networkError.message,
      errorDetails: detailsFromError(networkError),
      raw: null,
    };
  }
}

export async function verifyAthenaGatewayUrl(
  baseUrl: string,
  options?: AthenaGatewayConnectionOptions,
): Promise<AthenaGatewayConnectionResult> {
  const normalizedBaseUrl = normalizeAthenaGatewayBaseUrl(baseUrl);
  return performConnectionCheck(normalizedBaseUrl, { "X-Athena-Sdk": SDK_HEADER_VALUE }, options);
}

async function callAthena<T>(
  config: AthenaGatewayBaseOptions,
  endpoint: AthenaGatewayEndpointPath,
  method: AthenaGatewayMethod,
  payload: unknown,
  options?: AthenaGatewayCallOptions,
): Promise<AthenaGatewayResponse<T>> {
  let baseUrl: string;
  try {
    baseUrl = resolveGatewayBaseUrl(options?.baseUrl ?? config.baseUrl);
  } catch (error) {
    return toInvalidUrlResponse<T>(error, endpoint, method);
  }

  const url = buildAthenaGatewayUrl(baseUrl, endpoint);
  const headers = buildHeaders(config, options);

  try {
    const requestInit: RequestInit = {
      method,
      headers,
    };
    if (method !== "GET") {
      requestInit.body = JSON.stringify(payload);
    }

    const response = await fetch(url, requestInit);

    const rawText = await response.text();
    const requestId = resolveRequestId(response.headers);
    const parsedBody = parseResponseBody(
      rawText ?? "",
      response.headers.get("content-type"),
    );

    if (parsedBody.parseFailed) {
      const invalidJsonError = new AthenaGatewayError({
        code: "INVALID_JSON",
        message: "Gateway returned malformed JSON",
        status: response.status,
        endpoint,
        method,
        requestId,
        hint: "Verify the gateway response body is valid JSON.",
        cause: rawText.slice(0, 300),
      });
      return {
        ok: false,
        status: response.status,
        statusText: resolveStatusText(response, parsedBody.parsed),
        data: null,
        error: invalidJsonError.message,
        errorDetails: detailsFromError(invalidJsonError),
        raw: parsedBody.parsed,
      };
    }

    const parsed = parsedBody.parsed;
    const parsedPayload = isRecord(parsed) ? parsed : null;

    if (!response.ok) {
      const httpError = new AthenaGatewayError({
        code: "HTTP_ERROR",
        message: resolveErrorMessage(
          parsed,
          `Athena gateway ${method} ${endpoint} failed with status ${response.status}`,
        ),
        status: response.status,
        endpoint,
        method,
        requestId,
        hint: resolveErrorHint(parsed),
      });

      return {
        ok: false,
        status: response.status,
        statusText: resolveStatusText(response, parsed),
        data: null,
        error: httpError.message,
        errorDetails: detailsFromError(httpError),
        raw: parsed,
      };
    }

    // Unwrap envelope: API may return { data: [...], error: null } (e.g. when cached)
    // vs raw array when uncached. Use inner data when present to avoid double nesting.
    const payloadData =
      parsedPayload && "data" in parsedPayload
        ? (parsedPayload.data as T)
        : (parsed as T);
    const payloadCount =
      parsedPayload && "count" in parsedPayload
        ? typeof parsedPayload.count === "number" || parsedPayload.count === null
          ? (parsedPayload.count as number | null)
          : undefined
        : undefined;

    return {
      ok: true,
      status: response.status,
      statusText: resolveStatusText(response, parsed),
      data: payloadData ?? null,
      count: payloadCount,
      error: undefined,
      errorDetails: null,
      raw: parsed,
    };
  } catch (callError) {
    const message = callError instanceof Error ? callError.message : String(callError);
    const networkError = new AthenaGatewayError({
      code: "NETWORK_ERROR",
      message: `Network error while calling ${method} ${endpoint}: ${message}`,
      endpoint,
      method,
      cause: message,
      hint: "Check gateway URL, DNS, and network reachability.",
    });
    return {
      ok: false,
      status: 0,
      statusText: null,
      data: null,
      error: networkError.message,
      errorDetails: detailsFromError(networkError),
      raw: null,
    };
  }
}

export interface AthenaGatewayClient {
  baseUrl: string;
  buildHeaders(options?: AthenaGatewayCallOptions): Record<string, string>;
  verifyConnection(
    options?: AthenaGatewayConnectionOptions,
  ): Promise<AthenaGatewayConnectionResult>;
  fetchGateway<T>(
    payload: AthenaFetchPayload | AthenaFindManyAstPayload,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaGatewayResponse<T>>;
  insertGateway<T>(
    payload: AthenaInsertPayload,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaGatewayResponse<T>>;
  updateGateway<T>(
    payload: AthenaUpdatePayload,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaGatewayResponse<T>>;
  deleteGateway<T>(
    payload: AthenaDeletePayload,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaGatewayResponse<T>>;
  rpcGateway<T>(
    payload: AthenaRpcPayload,
    options?: AthenaRpcCallOptions,
  ): Promise<AthenaGatewayResponse<T>>;
  queryGateway<T>(
    payload: AthenaQueryPayload,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaGatewayResponse<T>>;
}

export function createAthenaGatewayClient(
  config: AthenaGatewayBaseOptions = {},
): AthenaGatewayClient {
  const normalizedBaseUrl = resolveGatewayBaseUrl(config.baseUrl);
  const normalizedConfig: AthenaGatewayBaseOptions = {
    ...config,
    baseUrl: normalizedBaseUrl,
  };

  return {
    baseUrl: normalizedBaseUrl,
    buildHeaders(options) {
      return buildHeaders(normalizedConfig, options);
    },
    verifyConnection(options) {
      return performConnectionCheck(
        normalizedBaseUrl,
        buildHeaders(normalizedConfig),
        options,
      );
    },
    fetchGateway(payload, options) {
      return callAthena(normalizedConfig, "/gateway/fetch", "POST", payload, options);
    },
    insertGateway(payload, options) {
      return callAthena(normalizedConfig, "/gateway/insert", "PUT", payload, options);
    },
    updateGateway(payload, options) {
      return callAthena(normalizedConfig, "/gateway/update", "POST", payload, options);
    },
    deleteGateway(payload, options) {
      return callAthena(normalizedConfig, "/gateway/delete", "DELETE", payload, options);
    },
    rpcGateway(payload, options) {
      if (options?.get) {
        const endpoint = buildRpcGetEndpoint(payload);
        return callAthena(normalizedConfig, endpoint, "GET", null, options);
      }
      return callAthena(normalizedConfig, "/gateway/rpc", "POST", payload, options);
    },
    queryGateway(payload, options) {
      return callAthena(normalizedConfig, "/gateway/query", "POST", payload, options);
    },
  };
}
