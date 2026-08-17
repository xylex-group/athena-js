import type {
  AthenaGatewayEndpointPath,
  AthenaGatewayErrorCode,
  AthenaGatewayErrorDetails,
  AthenaGatewayMethod,
  AthenaGatewayResponse,
} from "./types.js";

export interface AthenaGatewayErrorInput {
  cause?: string;
  code: AthenaGatewayErrorCode;
  endpoint?: AthenaGatewayEndpointPath;
  /** Original thrown value for Error.cause (distinct from string `cause` detail). */
  errorCause?: unknown;
  hint?: string;
  message: string;
  method?: AthenaGatewayMethod;
  requestId?: string;
  status?: number;
}

/**
 * Canonical error for gateway failures.
 * Holds request context and machine-readable classification.
 */
export class AthenaGatewayError extends Error {
  readonly code: AthenaGatewayErrorCode;
  readonly status: number;
  readonly endpoint?: AthenaGatewayEndpointPath;
  readonly method?: AthenaGatewayMethod;
  readonly requestId?: string;
  readonly hint?: string;
  readonly causeDetail?: string;

  constructor(input: AthenaGatewayErrorInput) {
    super(
      input.message,
      input.errorCause === undefined ? undefined : { cause: input.errorCause }
    );
    this.name = "AthenaGatewayError";
    this.code = input.code;
    this.status = input.status ?? 0;
    this.endpoint = input.endpoint;
    this.method = input.method;
    this.requestId = input.requestId;
    this.hint = input.hint;
    this.causeDetail = input.cause;
  }

  toDetails(): AthenaGatewayErrorDetails {
    return {
      cause: this.causeDetail,
      code: this.code,
      endpoint: this.endpoint,
      hint: this.hint,
      message: this.message,
      method: this.method,
      requestId: this.requestId,
      status: this.status,
    };
  }

  static fromResponse<T>(
    response: AthenaGatewayResponse<T>,
    fallback: Omit<AthenaGatewayErrorInput, "code" | "message" | "status">
  ) {
    const details = response.errorDetails;
    if (details) {
      return new AthenaGatewayError({
        cause: details.cause,
        code: details.code,
        endpoint: details.endpoint ?? fallback.endpoint,
        hint: details.hint,
        message: details.message,
        method: details.method ?? fallback.method,
        requestId: details.requestId ?? fallback.requestId,
        status: details.status,
      });
    }

    return new AthenaGatewayError({
      code: "HTTP_ERROR",
      endpoint: fallback.endpoint,
      message: response.error ?? "Gateway request failed",
      method: fallback.method,
      requestId: fallback.requestId,
      status: response.status,
    });
  }
}

export function isAthenaGatewayError(
  error: unknown
): error is AthenaGatewayError {
  return error instanceof AthenaGatewayError;
}
