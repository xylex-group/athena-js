export type AthenaErrorKind =
  | "unique_violation"
  | "not_found"
  | "validation"
  | "auth"
  | "rate_limit"
  | "transient"
  | "unknown";

export const AthenaErrorKind = {
  Auth: "auth",
  NotFound: "not_found",
  RateLimit: "rate_limit",
  Transient: "transient",
  UniqueViolation: "unique_violation",
  Unknown: "unknown",
  Validation: "validation",
} as const;

export type AthenaErrorCode =
  | "UNIQUE_VIOLATION"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "AUTH_UNAUTHORIZED"
  | "AUTH_FORBIDDEN"
  | "RATE_LIMITED"
  | "NETWORK_UNAVAILABLE"
  | "TRANSIENT_FAILURE"
  | "HTTP_FAILURE"
  | "UNKNOWN";

export const AthenaErrorCode = {
  AuthForbidden: "AUTH_FORBIDDEN",
  AuthUnauthorized: "AUTH_UNAUTHORIZED",
  HttpFailure: "HTTP_FAILURE",
  NetworkUnavailable: "NETWORK_UNAVAILABLE",
  NotFound: "NOT_FOUND",
  RateLimited: "RATE_LIMITED",
  TransientFailure: "TRANSIENT_FAILURE",
  UniqueViolation: "UNIQUE_VIOLATION",
  Unknown: "UNKNOWN",
  ValidationFailed: "VALIDATION_FAILED",
} as const satisfies Record<string, AthenaErrorCode>;

export type AthenaErrorCategory =
  | "transport"
  | "client"
  | "server"
  | "database"
  | "unknown";

export const AthenaErrorCategory = {
  Client: "client",
  Database: "database",
  Server: "server",
  Transport: "transport",
  Unknown: "unknown",
} as const satisfies Record<string, AthenaErrorCategory>;

export interface AthenaOperationContext {
  identity?: string | Record<string, unknown>;
  operation?: string;
  table?: string;
}

export interface NormalizedAthenaError {
  category: AthenaErrorCategory;
  code: AthenaErrorCode;
  constraint?: string;
  kind: AthenaErrorKind;
  message: string;
  operation?: string;
  raw: unknown;
  retryable: boolean;
  status?: number;
  table?: string;
}

export interface AthenaErrorInput {
  category: AthenaErrorCategory;
  code: AthenaErrorCode;
  context?: AthenaOperationContext;
  kind: AthenaErrorKind;
  message: string;
  raw?: unknown;
  requestId?: string;
  retryable?: boolean;
  status?: number;
}

export class AthenaError extends Error {
  readonly code: AthenaErrorCode;
  readonly kind: AthenaErrorKind;
  readonly category: AthenaErrorCategory;
  readonly status?: number;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly context?: AthenaOperationContext;
  readonly raw?: unknown;

  constructor(input: AthenaErrorInput) {
    super(input.message);
    this.name = "AthenaError";
    this.code = input.code;
    this.kind = input.kind;
    this.category = input.category;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
    this.requestId = input.requestId;
    this.context = input.context;
    this.raw = input.raw;
  }
}
