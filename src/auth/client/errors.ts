import { sanitizeAuthErrorMessage } from "../../http/upstream-html-error.ts";
import type {
  AthenaAuthEndpointPath,
  AthenaAuthErrorCode,
  AthenaAuthErrorDetails,
  AthenaAuthMethod,
} from "../types.ts";

export interface AuthRequestContext {
  endpoint: AthenaAuthEndpointPath;
  method: AthenaAuthMethod;
}

export type InternalErrorInput = AuthRequestContext & {
  code: AthenaAuthErrorCode;
  status: number;
  message: string;
  requestId?: string;
  hint?: string;
  cause?: string;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function looksLikeUnsafeAuthTransportBody(value: string): boolean {
  const trimmed = value.trimStart();
  return (
    /^<!doctype\s+html/i.test(trimmed) ||
    /^<\?xml/i.test(trimmed) ||
    /^<html(?:\s|>)/i.test(trimmed) ||
    /<(?:head|body|script|style)(?:\s|>)/i.test(value) ||
    value.length > 2000
  );
}

export function resolveErrorMessage(
  payload: unknown,
  fallback: string
): string {
  if (isRecord(payload)) {
    const messageCandidates = [payload.error, payload.message, payload.details];
    for (const candidate of messageCandidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        const text = candidate.trim();
        if (!looksLikeUnsafeAuthTransportBody(text)) {
          return text;
        }
      }
    }
  }

  if (typeof payload === "string" && payload.trim().length > 0) {
    const text = payload.trim();
    if (looksLikeUnsafeAuthTransportBody(text)) {
      return fallback;
    }
    return sanitizeAuthErrorMessage(text, fallback);
  }

  return fallback;
}

export function resolveErrorCode(payload: unknown): AthenaAuthErrorCode {
  if (!isRecord(payload)) {
    return "HTTP_ERROR";
  }
  if (typeof payload.code === "string" && payload.code.trim()) {
    return payload.code.trim();
  }
  const nested = isRecord(payload.error) ? payload.error : undefined;
  if (nested && typeof nested.code === "string" && nested.code.trim()) {
    return nested.code.trim();
  }
  return "HTTP_ERROR";
}

export function toErrorDetails(
  input: InternalErrorInput
): AthenaAuthErrorDetails {
  return {
    cause: input.cause,
    code: input.code,
    endpoint: input.endpoint,
    hint: input.hint,
    message: input.message,
    method: input.method,
    requestId: input.requestId,
    status: input.status,
  };
}

export function resolveRequestId(headers: Headers): string | undefined {
  return (
    headers.get("x-request-id") ??
    headers.get("x-correlation-id") ??
    headers.get("x-athena-request-id") ??
    undefined
  );
}
