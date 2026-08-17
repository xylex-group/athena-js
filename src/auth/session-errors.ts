import type { AthenaAuthErrorDetails } from "./types.ts";

export type AthenaSessionErrorCode =
  | "ATHENA_SESSION_UNAUTHENTICATED"
  | "ATHENA_SESSION_UPSTREAM"
  | "ATHENA_SESSION_CONFIGURATION"
  | "ATHENA_SESSION_PROTOCOL"
  | "ATHENA_SESSION_NO_ACCESSIBLE_ORGANIZATION";

export interface AthenaSessionErrorContext {
  cause?: unknown;
  code?: AthenaSessionErrorCode;
  details?: AthenaAuthErrorDetails | null;
  message?: string;
  requestId?: string;
  retryable?: boolean;
  status?: number;
}

/**
 * Base error for Next/server session helpers (`require*`, `OrNull` throws).
 */
export abstract class AthenaSessionError extends Error {
  readonly code: AthenaSessionErrorCode | string;
  readonly details?: AthenaAuthErrorDetails | null;
  readonly requestId?: string;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, context: AthenaSessionErrorContext = {}) {
    super(message, context.cause !== undefined ? { cause: context.cause } : undefined);
    this.name = new.target.name;
    this.code = context.code ?? "ATHENA_SESSION_UPSTREAM";
    this.status = context.status ?? context.details?.status;
    this.requestId = context.requestId ?? context.details?.requestId;
    this.details = context.details ?? null;
    this.retryable = context.retryable ?? false;
  }
}

export class AthenaUnauthenticatedError extends AthenaSessionError {
  constructor(message = "Not authenticated", context: AthenaSessionErrorContext = {}) {
    super(message, {
      ...context,
      code: "ATHENA_SESSION_UNAUTHENTICATED",
      retryable: false,
      status: context.status ?? 401,
    });
    this.name = "AthenaUnauthenticatedError";
  }
}

export class AthenaAuthUpstreamError extends AthenaSessionError {
  constructor(message = "Auth upstream failure", context: AthenaSessionErrorContext = {}) {
    const status = context.status ?? context.details?.status;
    const retryable =
      context.retryable ??
      (status === undefined || status === 0 || status >= 500 || status === 429);
    super(message, {
      ...context,
      code: context.code ?? "ATHENA_SESSION_UPSTREAM",
      retryable,
      status,
    });
    this.name = "AthenaAuthUpstreamError";
  }
}

export class AthenaAuthConfigurationError extends AthenaSessionError {
  constructor(
    message = "Session configuration error",
    context: AthenaSessionErrorContext = {}
  ) {
    super(message, {
      ...context,
      code: "ATHENA_SESSION_CONFIGURATION",
      retryable: false,
    });
    this.name = "AthenaAuthConfigurationError";
  }
}

export class AthenaAuthProtocolError extends AthenaSessionError {
  constructor(
    message = "Malformed session payload",
    context: AthenaSessionErrorContext = {}
  ) {
    super(message, {
      ...context,
      code: "ATHENA_SESSION_PROTOCOL",
      retryable: false,
      status: context.status ?? context.details?.status ?? 502,
    });
    this.name = "AthenaAuthProtocolError";
  }
}

export class AthenaSessionOrganizationError extends AthenaSessionError {
  constructor(
    message = "No accessible organization",
    context: AthenaSessionErrorContext = {}
  ) {
    super(message, {
      ...context,
      code: "ATHENA_SESSION_NO_ACCESSIBLE_ORGANIZATION",
      retryable: false,
    });
    this.name = "AthenaSessionOrganizationError";
  }
}

export type ToAthenaSessionErrorKind =
  | "unauthenticated"
  | "upstream"
  | "configuration"
  | "protocol"
  | "no_organization";

/**
 * Single conversion path from auth error details / context into thrown session errors.
 */
export function toAthenaSessionError(
  kind: ToAthenaSessionErrorKind,
  context: AthenaSessionErrorContext = {}
): AthenaSessionError {
  const message =
    context.message ??
    context.details?.message ??
    (kind === "unauthenticated"
      ? "Not authenticated"
      : kind === "configuration"
        ? "Session configuration error"
        : kind === "protocol"
          ? "Malformed session payload"
          : kind === "no_organization"
            ? "No accessible organization"
            : "Auth upstream failure");

  switch (kind) {
    case "unauthenticated":
      return new AthenaUnauthenticatedError(message, context);
    case "configuration":
      return new AthenaAuthConfigurationError(message, context);
    case "protocol":
      return new AthenaAuthProtocolError(message, context);
    case "no_organization":
      return new AthenaSessionOrganizationError(message, context);
    default:
      return new AthenaAuthUpstreamError(message, context);
  }
}

/** True when the value is a browser/Node abort signal rejection. */
export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = (error as { name?: string }).name;
  return name === "AbortError" || name === "TimeoutError";
}
