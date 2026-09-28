export type PostgresClientDisposition = "release" | "destroy";

const POSTGRES_DEADLINE_EXCEEDED = "ATHENA_POSTGRES_DEADLINE_EXCEEDED";
const AUTH_DATABASE_TIMEOUT = "ATHENA_AUTH_DATABASE_TIMEOUT";

type ErrorLike = {
  cause?: unknown;
  code?: unknown;
  message?: unknown;
  name?: unknown;
};

function errorLike(error: unknown): ErrorLike | undefined {
  return error !== null && typeof error === "object"
    ? (error as ErrorLike)
    : undefined;
}

function errorCode(error: unknown): string | undefined {
  const code = errorLike(error)?.code;
  return typeof code === "string" ? code : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : "";
}

function isDeadlineTimeout(error: unknown, seen = new Set<object>()): boolean {
  const record = errorLike(error);
  if (!record || seen.has(record)) {
    return false;
  }
  seen.add(record);

  if (
    record.code === POSTGRES_DEADLINE_EXCEEDED ||
    record.code === AUTH_DATABASE_TIMEOUT
  ) {
    return true;
  }
  return isDeadlineTimeout(record.cause, seen);
}

/**
 * Decide whether a leased client may return to the pool.
 * Timed-out, reset, protocol-broken, or rollback-failed sessions are destroyed.
 * Ordinary SQL/transaction failures can be released after a successful ROLLBACK.
 */
export function classifyPostgresClientPoison(
  error: unknown
): PostgresClientDisposition {
  const code = errorCode(error);
  const message = errorMessage(error);

  if (
    isDeadlineTimeout(error) ||
    code === "57014" ||
    code === "ETIMEDOUT" ||
    /statement timeout|query_timeout|connection timeout|deadline exceeded/i.test(
      message
    )
  ) {
    return "destroy";
  }

  if (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "EPIPE" ||
    code === "ENOTCONN" ||
    code === "57P01" ||
    code === "57P02" ||
    code === "57P03" ||
    /connection terminated|server closed the connection|network reset/i.test(
      message
    )
  ) {
    return "destroy";
  }

  if (
    code === "08P01" ||
    code === "08P02" ||
    code === "08000" ||
    code === "08003" ||
    code === "08006" ||
    /protocol error|client_encoding|unexpected message/i.test(message)
  ) {
    return "destroy";
  }

  if (/rollback/i.test(message) && /fail/i.test(message)) {
    return "destroy";
  }

  return "release";
}
