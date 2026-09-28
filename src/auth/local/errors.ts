import { PACKAGE_VERSION } from "../../sdk-version.ts";
import {
  ATHENA_AUTH_REQUEST_ID_HEADER,
  ATHENA_AUTH_TRACE_ID_HEADER,
  type AthenaAuthErrorBody,
} from "../contract/index.ts";
import { AthenaAuthRuntimeError } from "../runtime-error.ts";
import { currentAuthRequestTiming } from "./request-timing.ts";

export { AthenaAuthRuntimeError } from "../runtime-error.ts";

export function createTraceId(): string {
  return crypto.randomUUID();
}

export function errorBody(
  error: AthenaAuthRuntimeError,
  traceId: string,
  version = PACKAGE_VERSION
): AthenaAuthErrorBody {
  const body: AthenaAuthErrorBody = {
    message:
      error.status >= 500 ? "Internal server error" : error.publicMessage,
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
  const serializeStarted = performance.now();
  const bodyText = JSON.stringify(body);
  currentAuthRequestTiming()?.addSpan(
    "serialize",
    performance.now() - serializeStarted
  );
  return new Response(bodyText, {
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
      error: runtimeError.message,
      status: runtimeError.status,
      traceId,
    });
  }
  return jsonResponse(
    runtimeError.status,
    errorBody(runtimeError, traceId, version),
    undefined,
    traceId
  );
}
