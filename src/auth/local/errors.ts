import {
  ATHENA_AUTH_REQUEST_ID_HEADER,
  ATHENA_AUTH_TRACE_ID_HEADER,
  type AthenaAuthErrorBody,
} from "../contract/index.ts";
import { PACKAGE_VERSION } from "../../sdk-version.ts";

export class AthenaAuthRuntimeError extends Error {
  readonly code?: string;
  readonly publicMessage: string;
  readonly status: number;

  constructor(
    status: number,
    publicMessage: string,
    options?: { cause?: unknown; code?: string; internalMessage?: string }
  ) {
    super(options?.internalMessage ?? publicMessage, { cause: options?.cause });
    this.name = "AthenaAuthRuntimeError";
    this.status = status;
    this.publicMessage = publicMessage;
    this.code = options?.code;
  }

  static badRequest(message: string): AthenaAuthRuntimeError {
    return new AthenaAuthRuntimeError(400, message);
  }

  static invalidCredentials(): AthenaAuthRuntimeError {
    return new AthenaAuthRuntimeError(401, "Invalid credentials");
  }

  static unauthenticated(): AthenaAuthRuntimeError {
    return new AthenaAuthRuntimeError(401, "Authentication required");
  }

  static sessionNotFound(): AthenaAuthRuntimeError {
    return new AthenaAuthRuntimeError(401, "Session not found or expired");
  }

  static forbidden(message = "Insufficient permissions"): AthenaAuthRuntimeError {
    return new AthenaAuthRuntimeError(403, message);
  }

  static notFound(message = "Not found"): AthenaAuthRuntimeError {
    return new AthenaAuthRuntimeError(404, message);
  }

  static conflict(message: string): AthenaAuthRuntimeError {
    return new AthenaAuthRuntimeError(409, message);
  }

  static rateLimited(): AthenaAuthRuntimeError {
    return new AthenaAuthRuntimeError(429, "Too many requests");
  }

  static notImplemented(message: string): AthenaAuthRuntimeError {
    return new AthenaAuthRuntimeError(501, message);
  }

  static payloadTooLarge(): AthenaAuthRuntimeError {
    return new AthenaAuthRuntimeError(413, "Request body too large");
  }

  static internal(cause?: unknown): AthenaAuthRuntimeError {
    return new AthenaAuthRuntimeError(500, "Internal server error", {
      cause,
      code: "ATHENA_AUTH_INTERNAL",
      internalMessage:
        cause instanceof Error ? cause.message : "Internal server error",
    });
  }
}

export function createTraceId(): string {
  return crypto.randomUUID();
}

export function errorBody(
  error: AthenaAuthRuntimeError,
  traceId: string,
  version = PACKAGE_VERSION
): AthenaAuthErrorBody {
  const body: AthenaAuthErrorBody = {
    message: error.status >= 500 ? "Internal server error" : error.publicMessage,
    traceId,
    version,
  };
  if (error.code) {
    body.code = error.code;
  }
  return body;
}

export function jsonResponse(
  status: number,
  body: unknown,
  headers?: HeadersInit,
  traceId?: string
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  if (traceId) {
    responseHeaders.set(ATHENA_AUTH_TRACE_ID_HEADER, traceId);
    responseHeaders.set(ATHENA_AUTH_REQUEST_ID_HEADER, traceId);
  }
  return new Response(JSON.stringify(body), {
    headers: responseHeaders,
    status,
  });
}

export function errorResponse(
  error: unknown,
  traceId: string,
  version = PACKAGE_VERSION
): Response {
  const runtimeError =
    error instanceof AthenaAuthRuntimeError
      ? error
      : AthenaAuthRuntimeError.internal(error);
  if (runtimeError.status >= 500) {
    console.error("[athena-auth]", {
      code: runtimeError.code ?? "ATHENA_AUTH_INTERNAL",
      status: runtimeError.status,
      traceId,
      error: runtimeError.message,
    });
  }
  return jsonResponse(
    runtimeError.status,
    errorBody(runtimeError, traceId, version),
    undefined,
    traceId
  );
}
