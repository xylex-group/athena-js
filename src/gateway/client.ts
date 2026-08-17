import { parseHttpResponseBody as parseResponseBody } from "../http/parse-response-body.ts";
import { resolveMutationAffectedRows } from "../result/mutation-meta.ts";
import { buildSdkHeaderValue } from "../sdk-version.ts";
import { buildServiceRequestHeaders } from "../utils/athena-request-headers.ts";
import type { AthenaTransactionTransport } from "../db/transaction/types.ts";
import { AthenaGatewayError } from "./errors.ts";
import { createGatewayHttpTransactionTransport } from "./transaction.ts";
import type {
  AthenaDeletePayload,
  AthenaFetchPayload,
  AthenaGatewayBaseOptions,
  AthenaGatewayCallOptions,
  AthenaGatewayConnectionOptions,
  AthenaGatewayConnectionResult,
  AthenaGatewayEndpointPath,
  AthenaGatewayErrorDetails,
  AthenaGatewayMethod,
  AthenaGatewayResponse,
  AthenaInsertPayload,
  AthenaQueryPayload,
  AthenaRpcCallOptions,
  AthenaRpcFilter,
  AthenaRpcPayload,
  AthenaUpdatePayload,
} from "./types.js";
import { isAthenaSelectQueryAst } from "../query/engine/ast.ts";
import { serializeGatewayAst } from "./serialize-ast.ts";
import {
  ATHENA_DEFAULT_BASE_URL,
  buildAthenaGatewayUrl,
  normalizeAthenaGatewayBaseUrl,
} from "./url.ts";

const SDK_NAME = "xylex-group/athena";
const SDK_HEADER_VALUE = buildSdkHeaderValue(SDK_NAME);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function resolveStructuredErrorPayload(
  payload: unknown
): Record<string, unknown> | null {
  if (!isRecord(payload)) {
    return null;
  }
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
    const messageCandidates = [
      structuredPayload.message,
      structuredPayload.error,
      structuredPayload.details,
    ];
    for (const candidate of messageCandidates) {
      const resolved = nonEmptyString(candidate);
      if (resolved) {
        return resolved;
      }
    }
  }

  const rawMessage = nonEmptyString(payload);
  if (rawMessage) {
    return rawMessage;
  }

  return fallback;
}

function resolveErrorHint(payload: unknown): string | undefined {
  const structuredPayload = resolveStructuredErrorPayload(payload);
  return structuredPayload ? nonEmptyString(structuredPayload.hint) : undefined;
}

function resolveStatusText(
  response: Response,
  payload: unknown
): string | null {
  const rawStatusText = nonEmptyString(response.statusText);
  if (rawStatusText) {
    return rawStatusText;
  }
  const payloadRecord = isRecord(payload) ? payload : null;
  return payloadRecord
    ? (nonEmptyString(payloadRecord.statusText) ?? null)
    : null;
}

function detailsFromError(
  error: AthenaGatewayError
): AthenaGatewayErrorDetails {
  return error.toDetails();
}

interface AthenaFindManyAstPayload {
  limit?: number;
  orderBy?: Record<string, unknown>;
  select: Record<string, unknown>;
  table_name: string;
  where?: Record<string, unknown>;
}

function toQueryScalar(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "null";
  }
  return String(value);
}

function toQueryArray(values: unknown[]): string {
  return `{${values.map(toQueryScalar).join(",")}}`;
}

function toRpcArgumentQueryValue(value: unknown): string {
  if (Array.isArray(value)) {
    return toQueryArray(value);
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
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
    default: {
      const exhaustive: never = filter.operator;
      throw new AthenaGatewayError({
        code: "UNKNOWN_ERROR",
        message: `Unsupported RPC filter operator: ${String(exhaustive)}`,
        status: 0,
      });
    }
  }
}

function buildRpcGetEndpoint(
  payload: AthenaRpcPayload
): AthenaGatewayEndpointPath {
  const functionName = (payload.function_name ?? payload.function).trim();
  if (!functionName) {
    throw new AthenaGatewayError({
      code: "UNKNOWN_ERROR",
      endpoint: "/gateway/rpc",
      message: "rpc requires a function name",
      method: "GET",
      status: 0,
    });
  }

  const query = new URLSearchParams();
  if (payload.schema) {
    query.set("schema", payload.schema);
  }
  if (payload.select) {
    query.set("select", payload.select);
  }
  if (payload.count) {
    query.set("count", payload.count);
  }
  if (payload.head) {
    query.set("head", "true");
  }
  if (typeof payload.limit === "number") {
    query.set("limit", String(payload.limit));
  }
  if (typeof payload.offset === "number") {
    query.set("offset", String(payload.offset));
  }
  if (payload.order?.column) {
    query.set(
      "order",
      payload.order.ascending === false
        ? `${payload.order.column}.desc`
        : payload.order.column
    );
  }

  if (payload.args) {
    for (const [key, value] of Object.entries(payload.args)) {
      query.set(key, toRpcArgumentQueryValue(value));
    }
  }

  if (payload.filters?.length) {
    for (const filter of payload.filters) {
      if (payload.args && Object.hasOwn(payload.args, filter.column)) {
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
  options?: AthenaGatewayCallOptions
): Record<string, string> {
  return buildServiceRequestHeaders(
    "gateway",
    SDK_HEADER_VALUE,
    config,
    options,
    {
      client: options?.client ?? config.client ?? "DEFAULT_CLIENT",
      stripNulls: options?.stripNulls ?? true,
    }
  );
}

function toInvalidUrlResponse<T>(
  error: unknown,
  endpoint: AthenaGatewayEndpointPath,
  method: AthenaGatewayMethod
): AthenaGatewayResponse<T> {
  const message = error instanceof Error ? error.message : String(error);
  const gatewayError =
    error instanceof AthenaGatewayError
      ? error
      : new AthenaGatewayError({
          cause: message,
          code: "INVALID_URL",
          endpoint,
          hint: "Set ATHENA_URL to a full http(s) URL before running queries.",
          message,
          method,
          status: 0,
        });

  return {
    data: null,
    error: gatewayError.message,
    errorDetails: detailsFromError(
      new AthenaGatewayError({
        cause: gatewayError.causeDetail,
        code: gatewayError.code,
        endpoint,
        hint: gatewayError.hint,
        message: gatewayError.message,
        method,
        requestId: gatewayError.requestId,
        status: gatewayError.status,
      })
    ),
    ok: false,
    raw: null,
    status: 0,
    statusText: null,
  };
}

function resolveGatewayBaseUrl(input?: string | null) {
  return normalizeAthenaGatewayBaseUrl(input, {
    defaultBaseUrl: ATHENA_DEFAULT_BASE_URL,
  });
}

function resolveProbePath(path?: string) {
  if (!path) {
    return "/";
  }
  if (!path.startsWith("/")) {
    throw new AthenaGatewayError({
      code: "INVALID_URL",
      hint: 'Use a leading slash such as "/" or "/health".',
      message: `Athena gateway probe path must start with "/". Received ${JSON.stringify(path)}.`,
      status: 0,
    });
  }
  return path;
}

function mergeConnectionHeaders(
  baseHeaders: Record<string, string>,
  headers?: Record<string, string>
): Record<string, string> {
  const merged = {
    ...baseHeaders,
    ...(headers ?? {}),
  };

  if (!(merged["X-Athena-Sdk"] || merged["x-athena-sdk"])) {
    merged["X-Athena-Sdk"] = SDK_HEADER_VALUE;
  }

  return merged;
}

async function performConnectionCheck(
  baseUrl: string,
  requestHeaders: Record<string, string>,
  options?: AthenaGatewayConnectionOptions
): Promise<AthenaGatewayConnectionResult> {
  const path = resolveProbePath(options?.path);
  const url = buildAthenaGatewayUrl(baseUrl, path);

  try {
    const response = await fetch(url, {
      headers: mergeConnectionHeaders(requestHeaders, options?.headers),
      method: "GET",
      signal: options?.signal,
    });
    const rawText = await response.text();
    const requestId = resolveRequestId(response.headers);
    const parsedBody = parseResponseBody(
      rawText ?? "",
      response.headers.get("content-type")
    );

    if (parsedBody.parseFailed) {
      const invalidJsonError = new AthenaGatewayError({
        cause: rawText.slice(0, 300),
        code: "INVALID_JSON",
        hint: "Verify the gateway response body is valid JSON.",
        message: "Gateway probe returned malformed JSON",
        method: "GET",
        requestId,
        status: response.status,
      });
      return {
        baseUrl,
        error: invalidJsonError.message,
        errorDetails: detailsFromError(invalidJsonError),
        ok: false,
        raw: parsedBody.parsed,
        reachable: true,
        status: response.status,
        statusText: resolveStatusText(response, parsedBody.parsed),
        url,
      };
    }

    const parsed = parsedBody.parsed;
    if (!response.ok) {
      const httpError = new AthenaGatewayError({
        code: "HTTP_ERROR",
        hint: resolveErrorHint(parsed),
        message: resolveErrorMessage(
          parsed,
          `Athena gateway GET ${path} failed with status ${response.status}`
        ),
        method: "GET",
        requestId,
        status: response.status,
      });

      return {
        baseUrl,
        error: httpError.message,
        errorDetails: detailsFromError(httpError),
        ok: false,
        raw: parsed,
        reachable: true,
        status: response.status,
        statusText: resolveStatusText(response, parsed),
        url,
      };
    }

    return {
      baseUrl,
      error: undefined,
      errorDetails: null,
      ok: true,
      raw: parsed,
      reachable: true,
      status: response.status,
      statusText: resolveStatusText(response, parsed),
      url,
    };
  } catch (callError) {
    const message =
      callError instanceof Error ? callError.message : String(callError);
    const networkError = new AthenaGatewayError({
      cause: message,
      code: "NETWORK_ERROR",
      hint: "Check gateway URL, DNS, and network reachability.",
      message: `Network error while probing Athena gateway ${url}: ${message}`,
      method: "GET",
    });
    return {
      baseUrl,
      error: networkError.message,
      errorDetails: detailsFromError(networkError),
      ok: false,
      raw: null,
      reachable: false,
      status: 0,
      statusText: null,
      url,
    };
  }
}

export async function verifyAthenaGatewayUrl(
  baseUrl: string,
  options?: AthenaGatewayConnectionOptions
): Promise<AthenaGatewayConnectionResult> {
  const normalizedBaseUrl = normalizeAthenaGatewayBaseUrl(baseUrl);
  return performConnectionCheck(
    normalizedBaseUrl,
    { "X-Athena-Sdk": SDK_HEADER_VALUE },
    options
  );
}

async function callAthena<T>(
  config: AthenaGatewayBaseOptions,
  endpoint: AthenaGatewayEndpointPath,
  method: AthenaGatewayMethod,
  payload: unknown,
  options?: AthenaGatewayCallOptions
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
      headers,
      method,
      signal: options?.signal,
    };
    if (method !== "GET") {
      requestInit.body = JSON.stringify(payload);
    }

    const response = await fetch(url, requestInit);

    const rawText = await response.text();
    const requestId = resolveRequestId(response.headers);
    const parsedBody = parseResponseBody(
      rawText ?? "",
      response.headers.get("content-type")
    );

    if (parsedBody.parseFailed) {
      const invalidJsonError = new AthenaGatewayError({
        cause: rawText.slice(0, 300),
        code: "INVALID_JSON",
        endpoint,
        hint: "Verify the gateway response body is valid JSON.",
        message: "Gateway returned malformed JSON",
        method,
        requestId,
        status: response.status,
      });
      return {
        data: null,
        error: invalidJsonError.message,
        errorDetails: detailsFromError(invalidJsonError),
        ok: false,
        raw: parsedBody.parsed,
        status: response.status,
        statusText: resolveStatusText(response, parsedBody.parsed),
      };
    }

    const parsed = parsedBody.parsed;
    const parsedPayload = isRecord(parsed) ? parsed : null;

    if (!response.ok) {
      const httpError = new AthenaGatewayError({
        code: "HTTP_ERROR",
        endpoint,
        hint: resolveErrorHint(parsed),
        message: resolveErrorMessage(
          parsed,
          `Athena gateway ${method} ${endpoint} failed with status ${response.status}`
        ),
        method,
        requestId,
        status: response.status,
      });

      return {
        data: null,
        error: httpError.message,
        errorDetails: detailsFromError(httpError),
        ok: false,
        raw: parsed,
        status: response.status,
        statusText: resolveStatusText(response, parsed),
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
        ? typeof parsedPayload.count === "number" ||
          parsedPayload.count === null
          ? (parsedPayload.count as number | null)
          : undefined
        : undefined;

    const affectedRows = resolveMutationAffectedRows({
      count: payloadCount,
      endpoint,
      raw: parsed,
    });
    const mutationCount =
      affectedRows === undefined
        ? payloadCount
        : (payloadCount ?? affectedRows);

    return {
      ...(affectedRows !== undefined ? { affectedRows } : {}),
      count: mutationCount,
      data: payloadData ?? null,
      error: undefined,
      errorDetails: null,
      ok: true,
      raw: parsed,
      status: response.status,
      statusText: resolveStatusText(response, parsed),
    };
  } catch (callError) {
    const message =
      callError instanceof Error ? callError.message : String(callError);
    const networkError = new AthenaGatewayError({
      cause: message,
      code: "NETWORK_ERROR",
      endpoint,
      hint: "Check gateway URL, DNS, and network reachability.",
      message: `Network error while calling ${method} ${endpoint}: ${message}`,
      method,
    });
    return {
      data: null,
      error: networkError.message,
      errorDetails: detailsFromError(networkError),
      ok: false,
      raw: null,
      status: 0,
      statusText: null,
    };
  }
}

export interface AthenaGatewayClient {
  baseUrl: string;
  buildHeaders: (options?: AthenaGatewayCallOptions) => Record<string, string>;
  deleteGateway: <T>(
    payload: AthenaDeletePayload,
    options?: AthenaGatewayCallOptions
  ) => Promise<AthenaGatewayResponse<T>>;
  fetchGateway: <T>(
    payload: AthenaFetchPayload | AthenaFindManyAstPayload,
    options?: AthenaGatewayCallOptions
  ) => Promise<AthenaGatewayResponse<T>>;
  insertGateway: <T>(
    payload: AthenaInsertPayload,
    options?: AthenaGatewayCallOptions
  ) => Promise<AthenaGatewayResponse<T>>;
  queryGateway: <T>(
    payload: AthenaQueryPayload,
    options?: AthenaGatewayCallOptions
  ) => Promise<AthenaGatewayResponse<T>>;
  resolveCallOptions: (
    options?: AthenaGatewayCallOptions
  ) => Promise<AthenaGatewayCallOptions | undefined>;
  rpcGateway: <T>(
    payload: AthenaRpcPayload,
    options?: AthenaRpcCallOptions
  ) => Promise<AthenaGatewayResponse<T>>;
  updateGateway: <T>(
    payload: AthenaUpdatePayload,
    options?: AthenaGatewayCallOptions
  ) => Promise<AthenaGatewayResponse<T>>;
  transactions?: AthenaTransactionTransport;
  verifyConnection: (
    options?: AthenaGatewayConnectionOptions
  ) => Promise<AthenaGatewayConnectionResult>;
}

export function createAthenaGatewayClient(
  config: AthenaGatewayBaseOptions = {}
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
    deleteGateway(payload, options) {
      return callAthena(
        normalizedConfig,
        "/gateway/delete",
        "DELETE",
        payload,
        options
      );
    },
    fetchGateway(payload, options) {
      const wirePayload = isAthenaSelectQueryAst(payload)
        ? serializeGatewayAst(payload)
        : payload;
      return callAthena(
        normalizedConfig,
        "/gateway/fetch",
        "POST",
        wirePayload,
        options
      );
    },
    insertGateway(payload, options) {
      return callAthena(
        normalizedConfig,
        "/gateway/insert",
        "PUT",
        payload,
        options
      );
    },
    queryGateway(payload, options) {
      return callAthena(
        normalizedConfig,
        "/gateway/query",
        "POST",
        payload,
        options
      );
    },
    async resolveCallOptions(options) {
      return options;
    },
    rpcGateway(payload, options) {
      if (options?.get) {
        const endpoint = buildRpcGetEndpoint(payload);
        return callAthena(normalizedConfig, endpoint, "GET", null, options);
      }
      return callAthena(
        normalizedConfig,
        "/gateway/rpc",
        "POST",
        payload,
        options
      );
    },
    updateGateway(payload, options) {
      return callAthena(
        normalizedConfig,
        "/gateway/update",
        "POST",
        payload,
        options
      );
    },
    transactions: createGatewayHttpTransactionTransport({
      postTransaction(payload, options) {
        return callAthena(
          normalizedConfig,
          "/gateway/transaction",
          "POST",
          payload,
          options
        );
      },
    }),
    verifyConnection(options) {
      return performConnectionCheck(
        normalizedBaseUrl,
        buildHeaders(normalizedConfig),
        options
      );
    },
  };
}

type AthenaGatewayCallOptionsResolver = () =>
  | AthenaGatewayCallOptions
  | undefined
  | Promise<AthenaGatewayCallOptions | undefined>;

function mergeGatewayCallOptions(
  base?: AthenaGatewayCallOptions,
  override?: AthenaGatewayCallOptions
): AthenaGatewayCallOptions | undefined {
  if (!(base || override)) {
    return;
  }
  return {
    ...base,
    ...override,
    headers:
      base?.headers || override?.headers
        ? { ...(base?.headers ?? {}), ...(override?.headers ?? {}) }
        : undefined,
  };
}

/**
 * Creates a request-context view over one immutable gateway transport.
 * The resolver runs once for every operation; the underlying transport and
 * normalized route configuration are never reconstructed.
 */
export function createAthenaGatewayClientView(
  transport: AthenaGatewayClient,
  resolveContext: AthenaGatewayCallOptionsResolver
): AthenaGatewayClient {
  const resolveCallOptions = async (
    options?: AthenaGatewayCallOptions
  ): Promise<AthenaGatewayCallOptions | undefined> =>
    mergeGatewayCallOptions(await resolveContext(), options);

  return {
    baseUrl: transport.baseUrl,
    buildHeaders(options) {
      return transport.buildHeaders(options);
    },
    async deleteGateway(payload, options) {
      return transport.deleteGateway(
        payload,
        await resolveCallOptions(options)
      );
    },
    async fetchGateway(payload, options) {
      return transport.fetchGateway(payload, await resolveCallOptions(options));
    },
    async insertGateway(payload, options) {
      return transport.insertGateway(
        payload,
        await resolveCallOptions(options)
      );
    },
    async queryGateway(payload, options) {
      return transport.queryGateway(payload, await resolveCallOptions(options));
    },
    resolveCallOptions,
    async rpcGateway(payload, options) {
      return transport.rpcGateway(payload, await resolveCallOptions(options));
    },
    async updateGateway(payload, options) {
      return transport.updateGateway(
        payload,
        await resolveCallOptions(options)
      );
    },
    transactions: transport.transactions,
    async verifyConnection(options) {
      const context = await resolveCallOptions();
      const contextHeaders = transport.buildHeaders(context);
      return transport.verifyConnection({
        ...options,
        headers: {
          ...contextHeaders,
          ...(options?.headers ?? {}),
        },
      });
    },
  };
}
