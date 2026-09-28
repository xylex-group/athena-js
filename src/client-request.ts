import type { BackendConfig } from "./gateway/types.ts";
import { normalizeAthenaGatewayBaseUrl } from "./gateway/url.ts";
import { buildSdkHeaderValue } from "./sdk-version.ts";
import {
  buildAthenaRequestHeaders,
  hasHeaderIgnoreCase,
} from "./utils/athena-request-headers.ts";

const SDK_NAME = "xylex-group/athena";

export type AthenaRequestService = "db" | "auth" | "chat" | "storage";
export type AthenaRequestMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export interface AthenaRequestQueryValueMap {
  [key: string]:
    | string
    | number
    | boolean
    | null
    | undefined
    | Array<string | number | boolean | null | undefined>;
}

export interface AthenaRequestOptions {
  /** Per-request override for the canonical `X-Athena-Key` header. */
  apiKey?: string | null;
  body?: RequestInit["body"] | Record<string, unknown> | unknown[] | null;
  credentials?: RequestInit["credentials"];
  headers?: Record<string, string>;
  method?: AthenaRequestMethod;
  path?: string;
  query?: AthenaRequestQueryValueMap;
  responseType?: "json" | "text" | "response";
  service?: AthenaRequestService;
  signal?: AbortSignal;
  url?: string;
}

export interface AthenaRequestResponse<T = unknown> {
  data: T | string | null;
  headers: Headers;
  ok: boolean;
  raw: Response;
  status: number;
  statusText: string;
}

export interface AthenaRawRequestConfig {
  apiKey?: string;
  authUrl?: string;
  backend?: BackendConfig;
  baseUrl?: string;
  chatUrl?: string;
  client?: string | null;
  headers?: Record<string, string>;
  jdbcUrl?: string | null;
  pgUri?: string | null;
  storageUrl?: string;
}

export interface AthenaRawRequestContext {
  bearerToken?: string | null;
  cookie?: string | null;
  forceNoCache?: boolean;
  headers?: Record<string, string>;
  organizationId?: string | null;
  sessionToken?: string | null;
  userId?: string | null;
}

function parseArbitraryResponseBody(
  rawText: string,
  contentType: string | null
): unknown {
  if (!rawText) {
    return null;
  }
  if (contentType?.toLowerCase().includes("application/json")) {
    try {
      return JSON.parse(rawText);
    } catch {
      return rawText;
    }
  }
  const trimmed = rawText.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return rawText;
    }
  }
  return rawText;
}

function toRequestQueryString(query?: AthenaRequestQueryValueMap): string {
  if (!query) {
    return "";
  }
  const params = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(query)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (value === undefined) {
        continue;
      }
      params.append(key, value === null ? "" : String(value));
    }
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

function isJsonBody(body: AthenaRequestOptions["body"]): boolean {
  return (
    body !== undefined &&
    body !== null &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    !(body instanceof URLSearchParams) &&
    !(body instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(body) &&
    typeof body !== "string"
  );
}

export function createAthenaRequest(
  config: AthenaRawRequestConfig,
  resolveContext: () =>
    | AthenaRawRequestContext
    | undefined
    | Promise<AthenaRawRequestContext | undefined>
): <T = unknown>(
  options: AthenaRequestOptions
) => Promise<AthenaRequestResponse<T>> {
  return async <T = unknown>(
    options: AthenaRequestOptions
  ): Promise<AthenaRequestResponse<T>> => {
    const context = await resolveContext();
    const method = options.method ?? "GET";
    const responseType = options.responseType ?? "json";
    const service = options.service ?? "db";
    const absoluteUrl = options.url?.trim();
    const baseUrlByService: Record<AthenaRequestService, string | undefined> = {
      auth: config.authUrl,
      chat: config.chatUrl,
      db: config.baseUrl,
      storage: config.storageUrl,
    };

    const queryString = toRequestQueryString(options.query);
    let targetUrl: string;
    if (absoluteUrl) {
      // Absolute URLs bypass gateway base-url normalization so query/hash are preserved
      // and auth-only / storage-only clients can still call arbitrary endpoints.
      try {
        const parsed = new URL(absoluteUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error("not http(s)");
        }
      } catch (error) {
        throw new Error(
          `client.request(...) url must be an absolute http(s) URL. Received ${JSON.stringify(options.url)}.`,
          { cause: error }
        );
      }
      targetUrl = `${absoluteUrl}${queryString}`;
    } else {
      const resolvedBaseUrl = baseUrlByService[service];
      if (!resolvedBaseUrl) {
        throw new Error(
          `Athena ${service} base URL is not configured. Pass createClient({ url }) for unified routing or set the service-specific URL first.`
        );
      }

      const normalizedBaseUrl = normalizeAthenaGatewayBaseUrl(resolvedBaseUrl, {
        label: `Athena ${service} base URL`,
      });
      const path = options.path?.trim();
      if (!path) {
        throw new Error(
          "client.request(...) requires either an absolute url or a non-empty path."
        );
      }
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      targetUrl = `${normalizedBaseUrl}${normalizedPath}${queryString}`;
    }

    const requestProfile =
      service === "auth"
        ? "auth"
        : service === "chat"
          ? "chat"
          : service === "storage"
            ? "storage"
            : "gateway";
    const headers = buildAthenaRequestHeaders({
      accept: service === "chat" ? "application/json" : undefined,
      apiKey: options.apiKey ?? config.apiKey,
      backend: config.backend,
      bearerToken: context?.bearerToken,
      callHeaders: options.headers,
      client: config.client,
      configHeaders: {
        ...(config.headers ?? {}),
        ...(context?.headers ?? {}),
      },
      contentType:
        service === "auth" || service === "db" || service === "storage"
          ? "application/json"
          : undefined,
      cookie: context?.cookie,
      forceNoCache: context?.forceNoCache,
      jdbcUrl: config.jdbcUrl,
      organizationId: context?.organizationId,
      pgUri: config.pgUri,
      profile: requestProfile,
      sdkHeaderValue: buildSdkHeaderValue(SDK_NAME),
      sessionToken: context?.sessionToken,
      stripNulls: service === "db" ? true : undefined,
      userId: context?.userId,
    });

    const shouldSendJsonBody = isJsonBody(options.body);
    if (shouldSendJsonBody && !hasHeaderIgnoreCase(headers, "Content-Type")) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(targetUrl, {
      body:
        options.body === undefined || options.body === null
          ? undefined
          : shouldSendJsonBody
            ? JSON.stringify(options.body)
            : (options.body as RequestInit["body"]),
      credentials: options.credentials,
      headers,
      method,
      signal: options.signal,
    });

    if (responseType === "response") {
      return {
        data: null,
        headers: response.headers,
        ok: response.ok,
        raw: response,
        status: response.status,
        statusText: response.statusText,
      };
    }

    const rawText = await response.text();
    const parsed =
      responseType === "text"
        ? rawText
        : parseArbitraryResponseBody(
            rawText,
            response.headers.get("content-type")
          );

    return {
      data: parsed as T | string | null,
      headers: response.headers,
      ok: response.ok,
      raw: response,
      status: response.status,
      statusText: response.statusText,
    };
  };
}
