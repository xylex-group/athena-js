import { AthenaTransactionError } from "./errors.ts";
import type {
  AthenaResolvedTransactionOptions,
  AthenaTransactionIsolationLevel,
} from "./types.ts";

const ISOLATION_SQL: Record<AthenaTransactionIsolationLevel, string> = {
  read_committed: "READ COMMITTED",
  repeatable_read: "REPEATABLE READ",
  serializable: "SERIALIZABLE",
};

/**
 * Compile PostgreSQL BEGIN from resolved options.
 * Isolation tokens are mapped exhaustively — never interpolated from caller text.
 */
export function buildPostgresBeginStatement(
  options?: Partial<
    Pick<
      AthenaResolvedTransactionOptions,
      "deferrable" | "isolationLevel" | "readOnly"
    >
  >
): string {
  const parts = ["BEGIN"];
  if (options?.isolationLevel) {
    const mapped = ISOLATION_SQL[options.isolationLevel];
    if (!mapped) {
      throw new AthenaTransactionError(
        "ATHENA_TRANSACTION_ISOLATION_UNSUPPORTED",
        `Unsupported PostgreSQL isolation level: ${String(options.isolationLevel)}`,
        { isolationLevel: options.isolationLevel }
      );
    }
    parts.push("ISOLATION LEVEL", mapped);
  }
  if (options?.readOnly) {
    parts.push("READ ONLY");
  }
  if (options?.deferrable) {
    if (!options.readOnly || options.isolationLevel !== "serializable") {
      throw new AthenaTransactionError(
        "ATHENA_TRANSACTION_OPTION_UNSUPPORTED",
        "DEFERRABLE requires READ ONLY SERIALIZABLE",
        {
          deferrable: true,
          isolationLevel: options.isolationLevel ?? null,
          readOnly: Boolean(options.readOnly),
        }
      );
    }
    parts.push("DEFERRABLE");
  }
  return parts.join(" ");
}

export function nextInternalSavepointName(index: number): string {
  if (!Number.isInteger(index) || index < 1) {
    throw new AthenaTransactionError(
      "ATHENA_TRANSACTION_OPTION_UNSUPPORTED",
      "Savepoint index must be a positive integer"
    );
  }
  return `athena_sp_${index}`;
}
