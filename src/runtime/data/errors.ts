import { AthenaConfigurationError } from "../../config/errors.ts";
import { AthenaGatewayError } from "../../gateway/errors.ts";
import type {
  AthenaGatewayEndpointPath,
  AthenaGatewayResponse,
} from "../../gateway/types.ts";
import { isCatalogErrorCode } from "../error/registry.ts";
import type { AthenaRuntimeErrorCode } from "./types.ts";

const ATHENA_RUNTIME_ERROR_CODES: ReadonlySet<string> = new Set<string>([
  "ATHENA_RUNTIME_UNAVAILABLE",
  "ATHENA_RUNTIME_UNSUPPORTED_OPERATION",
  "ATHENA_RUNTIME_CONFIG_INVALID",
  "ATHENA_RAW_SQL_FORBIDDEN",
  "ATHENA_RPC_FORBIDDEN",
  "ATHENA_RPC_NOT_EXPOSED",
  "ATHENA_AUTH_REQUIRED",
  "ATHENA_AUTH_INVALID_SESSION",
  "ATHENA_AUTH_SESSION_EXPIRED",
  "ATHENA_AUTH_PRINCIPAL_RESOLUTION_FAILED",
  "ATHENA_AUTH_ORG_NOT_ALLOWED",
  "ATHENA_AUTH_CONFIG_INVALID",
  "ATHENA_POLICY_DENIED",
  "ATHENA_POLICY_INVALID",
  "ATHENA_POLICY_UNRESOLVED",
  "ATHENA_POLICY_UNSUPPORTED_EXPRESSION",
  "ATHENA_POLICY_WRITE_CONFLICT",
  "ATHENA_POLICY_SUBJECT_MISSING",
  "ATHENA_MODEL_NOT_EXPOSED",
  "ATHENA_MODEL_UNKNOWN_FIELD",
  "ATHENA_MODEL_UNKNOWN_RELATION",
  "ATHENA_MODEL_INVALID_REGISTRY",
  "ATHENA_CSRF_REJECTED",
  "ATHENA_LIMIT_EXCEEDED",
  "ATHENA_UNBOUNDED_MUTATION",
] satisfies AthenaRuntimeErrorCode[]);

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

export function isAllowlistedRuntimePublicCode(code: string): boolean {
  return ATHENA_RUNTIME_ERROR_CODES.has(code) || isCatalogErrorCode(code);
}

export function readRuntimeErrorCode(
  response: AthenaGatewayResponse<unknown>
): string | undefined {
  const raw = response.raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const error = (raw as { error?: { code?: unknown } }).error;
    if (
      error &&
      typeof error === "object" &&
      typeof error.code === "string" &&
      isAllowlistedRuntimePublicCode(error.code)
    ) {
      return error.code;
    }
  }
}

export function readRuntimeErrorNumber(
  response: AthenaGatewayResponse<unknown>
): number | undefined {
  const raw = response.raw;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return;
  }
  const error = (raw as { error?: { errorNumber?: unknown } }).error;
  if (
    error &&
    typeof error === "object" &&
    typeof error.errorNumber === "number"
  ) {
    return error.errorNumber;
  }
}
