import type { AthenaGatewayResponse } from "../types.ts";
import { readRuntimeErrorCode } from "../../runtime/data/errors.ts";
import { publicRuntimeErrorMessage } from "../../runtime/data/redact.ts";

function encodeBinaryAsPgHex(bytes: Uint8Array): string {
  return `\\x${Buffer.from(bytes).toString("hex")}`;
}

/** JSON-safe Athena values: bytea becomes PostgreSQL `\x` hex, not Node Buffer JSON. */
export function jsonSafeAthenaData(value: unknown): unknown {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return encodeBinaryAsPgHex(value);
  }
  if (value instanceof Uint8Array) {
    return encodeBinaryAsPgHex(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => jsonSafeAthenaData(entry));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = jsonSafeAthenaData(entry);
    }
    return out;
  }
  return value;
}

export function encodeAthenaGatewaySuccess(
  result: AthenaGatewayResponse<unknown>,
  requestId: string
): Response {
  return new Response(
    JSON.stringify({
      count: result.count ?? null,
      data: jsonSafeAthenaData(result.data),
      ok: true,
    }),
    {
      headers: gatewayResponseHeaders(requestId),
      status: result.status || 200,
    }
  );
}

export function encodeAthenaGatewayFailure(options: {
  code: string;
  message: string;
  requestId: string;
  status: number;
}): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: options.code,
        message: publicRuntimeErrorMessage(options.message),
        status: options.status,
      },
      ok: false,
    }),
    {
      headers: gatewayResponseHeaders(options.requestId),
      status: options.status,
    }
  );
}

export function encodeAthenaGatewayResult(
  result: AthenaGatewayResponse<unknown>,
  requestId: string
): Response {
  if (result.ok) {
    return encodeAthenaGatewaySuccess(result, requestId);
  }
  const code =
    readRuntimeErrorCode(result) ??
    result.errorDetails?.code ??
    "ATHENA_RUNTIME_UNAVAILABLE";
  return encodeAthenaGatewayFailure({
    code,
    message: publicRuntimeErrorMessage(
      result.error ?? "Athena Local Runtime request failed."
    ),
    requestId,
    status: result.status || 500,
  });
}

function gatewayResponseHeaders(requestId: string): Headers {
  return new Headers({
    "content-type": "application/json; charset=utf-8",
    "x-athena-request-id": requestId,
    "x-athena-runtime": "local",
    "x-request-id": requestId,
  });
}
