import {
  type AthenaFailureIR,
  athenaErrorResult,
  classifyAthenaError,
  createAthenaErrorInstance,
  failureFromUnknown,
  messageFromUnknown,
} from "../../runtime/error/index.ts";
import {
  isStorageObjectOp,
  type StorageObjectOp,
  type StorageObjectResult,
} from "./types.ts";

export class AthenaStorageError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly errorNumber: number;
  readonly status: number;

  constructor(input: {
    code: string;
    details?: unknown;
    errorNumber: number;
    message: string;
    status: number;
  }) {
    super(input.message);
    this.name = "AthenaStorageError";
    this.code = input.code;
    this.errorNumber = input.errorNumber;
    this.status = input.status;
    this.details = input.details;
  }
}

export class AthenaStorageAuthorizationError extends AthenaStorageError {
  readonly missing: readonly string[];
  readonly operation: StorageObjectOp;

  constructor(input: {
    missing: readonly string[];
    operation: StorageObjectOp;
  }) {
    super({
      code: "storage_authorization_denied",
      details: {
        missing: input.missing,
        operation: input.operation,
      },
      errorNumber: 3003,
      message:
        input.missing.length === 0
          ? `Storage operation ${input.operation} denied`
          : `Storage operation ${input.operation} denied (missing ${input.missing.join(", ")})`,
      status: 403,
    });
    this.name = "AthenaStorageAuthorizationError";
    this.missing = input.missing;
    this.operation = input.operation;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function isAthenaStorageAuthorizationError(
  error: unknown
): error is AthenaStorageAuthorizationError {
  if (error instanceof AthenaStorageAuthorizationError) {
    return true;
  }
  if (!isRecord(error)) {
    return false;
  }
  return (
    error.code === "storage_authorization_denied" &&
    Array.isArray(error.missing) &&
    isStorageObjectOp(error.operation)
  );
}

export function storageErrorResult(
  failure: AthenaFailureIR | unknown
): StorageObjectResult;
/**
 * Compatibility overload for existing provider tests and internal adapters.
 * New call sites must pass a Failure IR (or an unknown occurrence) so the
 * classifier owns canonical identity.
 */
export function storageErrorResult(
  errorNumber: number,
  code: string,
  message: string,
  status: number
): StorageObjectResult;
export function storageErrorResult(
  failureOrErrorNumber: AthenaFailureIR | unknown | number,
  code?: string,
  message?: string,
  status?: number
): StorageObjectResult {
  const failure =
    typeof failureOrErrorNumber === "number"
      ? failureFromUnknown(
          "runtime",
          new Error(message ?? "storage request failed"),
          {
            code,
            status,
          }
        )
      : failureOrErrorNumber;
  const error = classifyAthenaError({ domain: "storage", failure });
  const instance = createAthenaErrorInstance(error, {
    details: occurrenceDetails(failure),
    message:
      typeof failureOrErrorNumber === "number"
        ? (message ?? error.description)
        : messageFromUnknownFailure(failure),
  });
  const result = athenaErrorResult(instance);
  const explicitCode =
    typeof code === "string" && code.trim() ? code.trim() : undefined;

  // Pre-Error-Spine wire aliases. Keep them narrow so HTTP principal
  // failures still classify with Direct (unknown codes → storage_internal).
  if (explicitCode === "storage_unauthenticated" && status === 401) {
    return {
      error: {
        code: "storage_unauthenticated",
        errorNumber: 3003,
        message: result.error.message,
      },
      ok: false,
      status: 401,
    };
  }

  if (failure instanceof AthenaStorageAuthorizationError) {
    return {
      error: {
        code: failure.code,
        errorNumber: failure.errorNumber,
        message: failure.message,
        missing: failure.missing,
        operation: failure.operation,
      },
      ok: false,
      status: failure.status,
    };
  }

  const resolvedCode =
    result.error.code === "storage_provider_unavailable"
      ? "storage_unavailable"
      : result.error.code;
  const operation = isStorageObjectOp(result.error.operation)
    ? result.error.operation
    : undefined;
  const missing = Array.isArray(result.error.missing)
    ? result.error.missing
    : undefined;

  return {
    error: {
      code: resolvedCode,
      errorNumber: result.error.errorNumber,
      message: result.error.message,
      ...(missing === undefined ? {} : { missing }),
      ...(operation === undefined ? {} : { operation }),
    },
    ok: false,
    status: result.status,
  };
}

function occurrenceDetails(failure: unknown): unknown {
  if (failure instanceof AthenaStorageAuthorizationError) {
    return {
      missing: failure.missing,
      operation: failure.operation,
    };
  }
  if (isRecord(failure) && failure.details !== undefined) {
    return failure.details;
  }
}

export function storageOkResult(
  data: unknown,
  status = 200
): StorageObjectResult {
  return { data, ok: true, status };
}

export function mapProviderFailure(error: unknown): StorageObjectResult {
  return storageErrorResult({
    ...providerFailureFields(error),
    source: "provider",
  });
}

function messageFromUnknownFailure(failure: unknown): string {
  if (failure && typeof failure === "object") {
    const message = (failure as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return messageFromUnknown(failure);
}

function providerFailureFields(error: unknown): {
  cause: unknown;
  message: string;
  providerCode?: string;
  status?: number;
} {
  if (!error || typeof error !== "object") {
    return { cause: error, message: messageFromUnknown(error) };
  }
  const record = error as {
    $metadata?: { httpStatusCode?: unknown };
    Code?: unknown;
    code?: unknown;
    message?: unknown;
    name?: unknown;
    status?: unknown;
  };
  const providerCode =
    typeof record.Code === "string"
      ? record.Code
      : typeof record.code === "string"
        ? record.code
        : typeof record.name === "string"
          ? record.name
          : undefined;
  const status =
    typeof record.status === "number"
      ? record.status
      : typeof record.$metadata?.httpStatusCode === "number"
        ? record.$metadata.httpStatusCode
        : undefined;
  return {
    cause: error,
    message:
      typeof record.message === "string" ? record.message : String(error),
    providerCode,
    status,
  };
}
