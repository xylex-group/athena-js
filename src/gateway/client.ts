import type {
  AthenaGatewayBaseOptions,
  AthenaGatewayCallOptions,
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

const DEFAULT_BASE_URL = "https://athena-db.com";
const DEFAULT_CLIENT = "railway_direct";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  if (isRecord(payload)) {
    const messageCandidates = [payload.error, payload.message, payload.details];
    for (const candidate of messageCandidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
  }

  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload.trim();
  }

  return fallback;
}

function detailsFromError(error: AthenaGatewayError): AthenaGatewayErrorDetails {
  return error.toDetails();
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
      query.set(filter.column, toRpcFilterQueryValue(filter));
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

  const athenaClientKeys = ["x-athena-client", "X-Athena-Client"];
  Object.entries(extraHeaders).forEach(([key, value]) => {
    if (athenaClientKeys.includes(key)) return;
    const normalized = normalizeHeaderValue(value);
    if (normalized) {
      headers[key] = normalized;
    }
  });

  return headers;
}

async function callAthena<T>(
  config: AthenaGatewayBaseOptions,
  endpoint: AthenaGatewayEndpointPath,
  method: AthenaGatewayMethod,
  payload: unknown,
  options?: AthenaGatewayCallOptions,
): Promise<AthenaGatewayResponse<T>> {
  const baseUrl = (
    options?.baseUrl ??
    config.baseUrl ??
    DEFAULT_BASE_URL
  ).replace(/\/$/, "");
  const url = `${baseUrl}${endpoint}`;
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
      });

      return {
        ok: false,
        status: response.status,
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
  fetchGateway<T>(
    payload: AthenaFetchPayload,
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
  return {
    baseUrl: (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, ""),
    buildHeaders(options) {
      return buildHeaders(config, options);
    },
    fetchGateway(payload, options) {
      return callAthena(config, "/gateway/fetch", "POST", payload, options);
    },
    insertGateway(payload, options) {
      return callAthena(config, "/gateway/insert", "PUT", payload, options);
    },
    updateGateway(payload, options) {
      return callAthena(config, "/gateway/update", "POST", payload, options);
    },
    deleteGateway(payload, options) {
      return callAthena(config, "/gateway/delete", "DELETE", payload, options);
    },
    rpcGateway(payload, options) {
      if (options?.get) {
        const endpoint = buildRpcGetEndpoint(payload);
        return callAthena(config, endpoint, "GET", null, options);
      }
      return callAthena(config, "/gateway/rpc", "POST", payload, options);
    },
    queryGateway(payload, options) {
      return callAthena(config, "/gateway/query", "POST", payload, options);
    },
  };
}
