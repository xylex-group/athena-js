/**
 * Shared Athena storage error types and factory.
 *
 * Extracted from `module.ts` so `backup.ts` (and other storage submodules) can
 * throw real {@link AthenaStorageError} instances with `onError` observers
 * without a circular import against the storage module surface.
 */

import type {
  AthenaErrorCategory,
  AthenaErrorCode,
  AthenaErrorKind,
  NormalizedAthenaError,
} from "../auxiliaries.ts";
import { normalizeAthenaError } from "../auxiliaries.ts";
import type {
  AthenaGatewayEndpointPath,
  AthenaGatewayErrorCode,
  AthenaGatewayMethod,
} from "../gateway/types.ts";

export type AthenaStorageErrorHandler = (
  error: AthenaStorageError
) => void | Promise<void>;

export type AthenaStorageErrorCode =
  | "INVALID_URL"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "INVALID_JSON"
  | "INVALID_ATHENA_ENVELOPE"
  | "UNKNOWN_ERROR";

export const AthenaStorageErrorCode = {
  HttpError: "HTTP_ERROR",
  InvalidAthenaEnvelope: "INVALID_ATHENA_ENVELOPE",
  InvalidJson: "INVALID_JSON",
  InvalidUrl: "INVALID_URL",
  NetworkError: "NETWORK_ERROR",
  UnknownError: "UNKNOWN_ERROR",
} as const satisfies Record<string, AthenaStorageErrorCode>;

export interface AthenaStorageErrorDetails {
  athenaCode: AthenaErrorCode;
  category: AthenaErrorCategory;
  cause?: string;
  code: AthenaStorageErrorCode;
  endpoint: AthenaGatewayEndpointPath;
  hint?: string;
  kind: AthenaErrorKind;
  message: string;
  method: AthenaGatewayMethod;
  raw: unknown;
  requestId?: string;
  retryable: boolean;
  status: number;
}

export interface AthenaStorageErrorInput {
  cause?: unknown;
  code: AthenaStorageErrorCode;
  endpoint: AthenaGatewayEndpointPath;
  hint?: string;
  message: string;
  method: AthenaGatewayMethod;
  raw?: unknown;
  requestId?: string;
  status: number;
}

/** Minimal runtime knobs needed to notify error observers. */
export interface AthenaStorageErrorRuntimeOptions {
  onError?: AthenaStorageErrorHandler;
}

/** Route row used only for normalized-error `operation` labels. */
export interface StorageErrorRouteRef {
  method: string;
  name: string;
  path: string;
}

let storageErrorRoutes: readonly StorageErrorRouteRef[] = [];

/**
 * Bind storage SDK route names so normalized errors can resolve
 * `operation` (e.g. `listStorageFiles`). Called once from `module.ts`
 * after `storageSdkManifest` is defined.
 */
export function bindStorageErrorRoutes(
  routes: readonly StorageErrorRouteRef[]
): void {
  storageErrorRoutes = routes;
}

function causeToString(cause: unknown): string | undefined {
  if (cause === undefined || cause === null) {
    return;
  }
  if (typeof cause === "string") {
    return cause;
  }
  if (cause instanceof Error && cause.message.trim()) {
    return cause.message.trim();
  }
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

function storageGatewayCode(
  code: AthenaStorageErrorCode
): AthenaGatewayErrorCode {
  if (code === "INVALID_URL") {
    return "INVALID_URL";
  }
  if (code === "NETWORK_ERROR") {
    return "NETWORK_ERROR";
  }
  if (code === "INVALID_JSON" || code === "INVALID_ATHENA_ENVELOPE") {
    return "INVALID_JSON";
  }
  if (code === "HTTP_ERROR") {
    return "HTTP_ERROR";
  }
  return "UNKNOWN_ERROR";
}

function storageOperationFromEndpoint(
  endpoint: AthenaGatewayEndpointPath,
  method: AthenaGatewayMethod
): string {
  const endpointPath = String(endpoint).split("?")[0];
  for (const candidate of storageErrorRoutes) {
    if (candidate.method !== method) {
      continue;
    }
    const pattern = `^${candidate.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{[^/]+\\\}/g, "[^/]+")}$`;
    if (new RegExp(pattern).test(endpointPath)) {
      return candidate.name;
    }
  }
  return `storage:${method.toLowerCase()}`;
}

function normalizeStorageErrorInput(
  input: AthenaStorageErrorInput
): NormalizedAthenaError {
  return normalizeAthenaError(
    {
      data: null,
      error: {
        gatewayCode: storageGatewayCode(input.code),
        message: input.message,
        raw: input.raw ?? input.cause ?? null,
        status: input.status,
      },
      errorDetails: {
        cause: causeToString(input.cause),
        code: storageGatewayCode(input.code),
        endpoint: input.endpoint,
        hint: input.hint,
        message: input.message,
        method: input.method,
        requestId: input.requestId,
        status: input.status,
      },
      raw: input.raw ?? input.cause ?? null,
      status: input.status,
    },
    { operation: storageOperationFromEndpoint(input.endpoint, input.method) }
  );
}

export class AthenaStorageError extends Error {
  readonly code: AthenaStorageErrorCode;
  readonly athenaCode: AthenaErrorCode;
  readonly kind: AthenaErrorKind;
  readonly category: AthenaErrorCategory;
  readonly retryable: boolean;
  readonly status: number;
  readonly endpoint: AthenaGatewayEndpointPath;
  readonly method: AthenaGatewayMethod;
  readonly requestId?: string;
  readonly hint?: string;
  readonly causeDetail?: string;
  readonly raw: unknown;
  readonly normalized: NormalizedAthenaError;
  readonly __athenaNormalizedError: NormalizedAthenaError;

  constructor(input: AthenaStorageErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "AthenaStorageError";
    this.code = input.code;
    this.status = input.status;
    this.endpoint = input.endpoint;
    this.method = input.method;
    this.requestId = input.requestId;
    this.hint = input.hint;
    this.causeDetail = causeToString(input.cause);
    this.raw = input.raw ?? null;
    this.normalized = normalizeStorageErrorInput(input);
    this.__athenaNormalizedError = this.normalized;
    this.athenaCode = this.normalized.code;
    this.kind = this.normalized.kind;
    this.category = this.normalized.category;
    this.retryable = this.normalized.retryable;
    Object.defineProperty(this, "__athenaNormalizedError", {
      configurable: false,
      enumerable: false,
      value: this.normalized,
      writable: false,
    });
  }

  toDetails(): AthenaStorageErrorDetails {
    return {
      athenaCode: this.athenaCode,
      category: this.category,
      cause: this.causeDetail,
      code: this.code,
      endpoint: this.endpoint,
      hint: this.hint,
      kind: this.kind,
      message: this.message,
      method: this.method,
      raw: this.raw,
      requestId: this.requestId,
      retryable: this.retryable,
      status: this.status,
    };
  }
}

export function createAthenaStorageError(
  input: AthenaStorageErrorInput
): AthenaStorageError {
  return new AthenaStorageError(input);
}

function readOnErrorHandler(
  source: unknown
): AthenaStorageErrorHandler | undefined {
  if (!source || typeof source !== "object") {
    return;
  }
  const handler = (source as { onError?: unknown }).onError;
  return typeof handler === "function"
    ? (handler as AthenaStorageErrorHandler)
    : undefined;
}

/**
 * Notify runtime + per-call `onError` observers.
 * `options` is intentionally wide so gateway-resolved call options
 * (without `onError`) remain assignable at call sites.
 */
export async function notifyStorageError(
  error: AthenaStorageError,
  options: unknown,
  runtimeOptions: AthenaStorageErrorRuntimeOptions | undefined
): Promise<void> {
  const handlers = [
    runtimeOptions?.onError,
    readOnErrorHandler(options),
  ].filter(
    (handler): handler is AthenaStorageErrorHandler =>
      typeof handler === "function"
  );
  for (const handler of handlers) {
    try {
      await handler(error);
    } catch {
      // Error observers must not mask the original storage failure.
    }
  }
}

export async function rejectStorageError(
  input: AthenaStorageErrorInput,
  options: unknown,
  runtimeOptions: AthenaStorageErrorRuntimeOptions | undefined
): Promise<never> {
  const error = createAthenaStorageError(input);
  await notifyStorageError(error, options, runtimeOptions);
  throw error;
}
