import { parseHttpResponseBody as parseResponseBody } from "../../http/parse-response-body.ts";
import {
  isHtmlErrorPage,
  UPSTREAM_UNAVAILABLE_CODE,
  UPSTREAM_UNAVAILABLE_HINT,
  UPSTREAM_UNAVAILABLE_MESSAGE,
} from "../../http/upstream-html-error.ts";
import type { AthenaAuthResult } from "../types.ts";
import {
  type AuthRequestContext,
  resolveErrorCode,
  resolveErrorMessage,
  resolveRequestId,
  toErrorDetails,
} from "./errors.ts";

export function parseAuthTransportResponse<T>(input: {
  context: AuthRequestContext;
  rawText: string;
  response: Response;
}): AthenaAuthResult<T> {
  const { context, rawText, response } = input;
  const requestId = resolveRequestId(response.headers);
  const parsedBody = parseResponseBody(
    rawText ?? "",
    response.headers.get("content-type")
  );

  if (isHtmlErrorPage(rawText ?? "", response.headers.get("content-type"))) {
    const details = toErrorDetails({
      cause: (rawText ?? "").slice(0, 200),
      code: UPSTREAM_UNAVAILABLE_CODE,
      endpoint: context.endpoint,
      hint: UPSTREAM_UNAVAILABLE_HINT,
      message: UPSTREAM_UNAVAILABLE_MESSAGE,
      method: context.method,
      requestId,
      status: response.status || 503,
    });
    return {
      data: null,
      error: details.message,
      errorDetails: details,
      ok: false,
      raw: null,
      status: details.status,
    };
  }

  if (parsedBody.parseFailed) {
    const details = toErrorDetails({
      cause: rawText.slice(0, 300),
      code: "INVALID_JSON",
      endpoint: context.endpoint,
      hint: "Verify the auth endpoint response body is valid JSON.",
      message: "Auth server returned malformed JSON",
      method: context.method,
      requestId,
      status: response.status,
    });
    return {
      data: null,
      error: details.message,
      errorDetails: details,
      ok: false,
      raw: parsedBody.parsed,
      status: response.status,
    };
  }

  const parsed = parsedBody.parsed;

  if (!response.ok) {
    const details = toErrorDetails({
      code: resolveErrorCode(parsed),
      endpoint: context.endpoint,
      message: resolveErrorMessage(
        parsed,
        `Auth endpoint ${context.method} ${context.endpoint} failed with status ${response.status}`
      ),
      method: context.method,
      requestId,
      status: response.status,
    });
    return {
      data: null,
      error: details.message,
      errorDetails: details,
      ok: false,
      raw: parsed,
      status: response.status,
    };
  }

  return {
    data: (parsed as T) ?? null,
    error: null,
    errorDetails: null,
    ok: true,
    raw: parsed,
    status: response.status,
  };
}
