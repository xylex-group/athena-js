import { AUTHORIZATION_ASSIGNMENT_VERSION_CONFLICT } from "../../runtime/authorization/role-invariants.ts";
import type { AthenaAuthErrorDetails, AthenaAuthResult } from "../types.ts";

export class AthenaAuthOperationError extends Error {
  readonly code: string;
  readonly details: AthenaAuthErrorDetails | null;
  readonly retry: boolean;
  readonly status: number;

  constructor(input: {
    code: string;
    details?: AthenaAuthErrorDetails | null;
    message: string;
    retry?: boolean;
    status: number;
  }) {
    super(input.message);
    this.name = "AthenaAuthOperationError";
    this.code = input.code;
    this.details = input.details ?? null;
    this.retry = input.retry === true;
    this.status = input.status;
  }

  static fromResult(
    result: AthenaAuthResult<unknown>
  ): AthenaAuthOperationError {
    const details = result.errorDetails ?? null;
    const code = details?.code ?? "HTTP_ERROR";
    return new AthenaAuthOperationError({
      code,
      details,
      message: details?.message ?? result.error ?? "Auth operation failed",
      retry: isRetryableAuthFailure(result.status, code),
      status: details?.status ?? result.status,
    });
  }
}

export type AthenaAuthorizationAssignmentConflictError =
  AthenaAuthOperationError & {
    code: typeof AUTHORIZATION_ASSIGNMENT_VERSION_CONFLICT;
  };

export function requireAthenaAuthResult<T>(result: AthenaAuthResult<T>): T {
  if (!result.ok) {
    throw AthenaAuthOperationError.fromResult(result);
  }
  return result.data as T;
}

export function isAuthorizationAssignmentConflict(
  error: unknown
): error is AthenaAuthorizationAssignmentConflictError {
  if (error instanceof AthenaAuthOperationError) {
    return error.code === AUTHORIZATION_ASSIGNMENT_VERSION_CONFLICT;
  }
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code ===
      AUTHORIZATION_ASSIGNMENT_VERSION_CONFLICT
  );
}

function isRetryableAuthFailure(status: number, code: string): boolean {
  if (code === AUTHORIZATION_ASSIGNMENT_VERSION_CONFLICT) {
    return true;
  }
  return status === 429 || status >= 500;
}
