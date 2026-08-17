export type AthenaTransactionErrorCode =
  | "ATHENA_TRANSACTION_ATOMIC_UNSUPPORTED"
  | "ATHENA_TRANSACTION_INTERACTIVE_UNSUPPORTED"
  | "ATHENA_TRANSACTION_ISOLATION_UNSUPPORTED"
  | "ATHENA_TRANSACTION_OPTION_UNSUPPORTED"
  | "ATHENA_TRANSACTION_NESTING_UNSUPPORTED"
  | "ATHENA_TRANSACTION_SAVEPOINT_UNSUPPORTED"
  | "ATHENA_TRANSACTION_EMPTY"
  | "ATHENA_TRANSACTION_OPERATION_UNSUPPORTED"
  | "ATHENA_TRANSACTION_CONTEXT_OVERRIDE"
  | "ATHENA_TRANSACTION_DOOMED"
  | "ATHENA_TRANSACTION_TIMEOUT"
  | "ATHENA_TRANSACTION_ABORTED"
  | "ATHENA_TRANSACTION_FAILED";

export class AthenaTransactionError extends Error {
  readonly backend?: string;
  readonly code: AthenaTransactionErrorCode;
  readonly details: Record<string, unknown>;
  readonly operationId?: string;
  readonly operationIndex?: number;
  readonly requestId?: string;
  readonly transactionId?: string;

  constructor(
    code: AthenaTransactionErrorCode,
    message: string,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "AthenaTransactionError";
    this.code = code;
    this.details = details;
    this.backend =
      typeof details.backend === "string" ? details.backend : undefined;
    this.operationId =
      typeof details.operationId === "string" ? details.operationId : undefined;
    this.operationIndex =
      typeof details.operationIndex === "number"
        ? details.operationIndex
        : undefined;
    this.requestId =
      typeof details.requestId === "string" ? details.requestId : undefined;
    this.transactionId =
      typeof details.transactionId === "string"
        ? details.transactionId
        : undefined;
  }
}

export function isAthenaTransactionError(
  value: unknown
): value is AthenaTransactionError {
  return value instanceof AthenaTransactionError;
}
