import type { AthenaGatewayResponse } from "../../gateway/types.ts";
import {
  type AthenaFailureIR,
  classifyAthenaError,
  createAthenaErrorInstance,
} from "../error/index.ts";
import { dataErrorDescriptor } from "../error/registry.ts";
import {
  isAllowlistedRuntimePublicCode,
  readRuntimeErrorCode,
} from "./errors.ts";

export function tableNameFromAuthorizedPayload(
  payload: unknown
): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return;
  }
  const tableName = (payload as { table_name?: unknown }).table_name;
  if (typeof tableName !== "string") {
    return;
  }
  const trimmed = tableName.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeDataTransportFailure(
  response: AthenaGatewayResponse<unknown>,
  options: { tableName?: string } = {}
): AthenaGatewayResponse<unknown> {
  if (response.ok) {
    return response;
  }
  const existing = readRuntimeErrorCode(response);
  if (existing && isAllowlistedRuntimePublicCode(existing)) {
    return response;
  }

  const failure = dataFailureFromGatewayResponse(response);
  const ir = classifyAthenaError({ domain: "data", failure });
  const message = safeDataOccurrenceMessage(
    ir.code,
    ir.description,
    options.tableName
  );
  const instance = createAthenaErrorInstance(ir, {
    details: {
      phase: "execute",
      provider: "postgres",
      providerCode:
        "providerCode" in failure ? failure.providerCode : undefined,
      resource: options.tableName,
    },
    message,
  });
  const descriptor = dataErrorDescriptor(ir.code) ?? ir;

  return {
    ...response,
    error: instance.message,
    errorDetails: {
      cause: response.errorDetails?.cause,
      code: response.errorDetails?.code ?? "HTTP_ERROR",
      endpoint: response.errorDetails?.endpoint,
      hint: response.errorDetails?.hint,
      message: instance.message,
      method: response.errorDetails?.method,
      requestId: response.errorDetails?.requestId,
      status: descriptor.status,
    },
    ok: false,
    raw: {
      error: {
        code: descriptor.code,
        errorNumber: descriptor.errorNumber,
        kind: descriptor.kind,
        message: instance.message,
        retry: descriptor.retry,
        status: descriptor.status,
      },
    },
    status: descriptor.status,
    statusText:
      descriptor.status === 404
        ? "Not Found"
        : descriptor.status === 403
          ? "Forbidden"
          : descriptor.status === 409
            ? "Conflict"
            : descriptor.status === 503
              ? "Service Unavailable"
              : "Error",
  };
}

function dataFailureFromGatewayResponse(
  response: AthenaGatewayResponse<unknown>
): AthenaFailureIR {
  const hint = response.errorDetails?.hint;
  const message =
    (typeof response.error === "string" ? response.error : undefined) ??
    response.errorDetails?.message;
  const providerCode =
    typeof hint === "string" && /^[0-9A-Z]{5}$/.test(hint) ? hint : undefined;
  return {
    code: response.errorDetails?.code,
    details: hint ? { hint } : undefined,
    message,
    provider: "postgres",
    providerCode,
    source: "provider",
    status: response.status,
  };
}

function safeDataOccurrenceMessage(
  code: string,
  description: string,
  tableName: string | undefined
): string {
  if (code === "data_relation_not_found" && tableName) {
    return `Table "${tableName}" does not exist.`;
  }
  return description;
}
