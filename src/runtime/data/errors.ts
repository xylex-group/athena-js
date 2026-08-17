import { AthenaConfigurationError } from "../../config/errors.ts";
import { AthenaGatewayError } from "../../gateway/errors.ts";
import type {
  AthenaGatewayEndpointPath,
  AthenaGatewayResponse,
} from "../../gateway/types.ts";
import type { AthenaRuntimeErrorCode } from "./types.ts";

export class AthenaRuntimeError extends Error {
  readonly runtimeCode: AthenaRuntimeErrorCode;
  readonly status: number;

  constructor(
    runtimeCode: AthenaRuntimeErrorCode,
    message: string,
    status = 403
  ) {
    super(message);
    this.name = "AthenaRuntimeError";
    this.runtimeCode = runtimeCode;
    this.status = status;
  }
}

export function runtimeConfigError(message: string): AthenaConfigurationError {
  return new AthenaConfigurationError(
    "ATHENA_RUNTIME_CONFIG_INVALID",
    message,
    "db"
  );
}

export function runtimeDeniedResponse(
  runtimeCode: AthenaRuntimeErrorCode,
  message: string,
  endpoint: AthenaGatewayEndpointPath,
  status = 403
): AthenaGatewayResponse<unknown> {
  const error = new AthenaGatewayError({
    code: "HTTP_ERROR",
    endpoint,
    hint: runtimeCode,
    message,
    method: "POST",
    status,
  });
  return {
    count: null,
    data: null,
    error: error.message,
    errorDetails: error.toDetails(),
    ok: false,
    raw: {
      error: {
        code: runtimeCode,
        message,
        status,
      },
    },
    status,
    statusText:
      status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Error",
  };
}

export function readRuntimeErrorCode(
  response: AthenaGatewayResponse<unknown>
): string | undefined {
  const raw = response.raw;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return response.errorDetails?.hint;
  }
  const error = (raw as { error?: { code?: unknown } }).error;
  if (error && typeof error.code === "string") {
    return error.code;
  }
  return response.errorDetails?.hint;
}
