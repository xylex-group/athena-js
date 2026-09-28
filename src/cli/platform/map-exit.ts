import { MigrationError } from "../../migrations/types.ts";
import { AthenaCliError } from "../errors.ts";
import { CliExitCode } from "../exit-code.ts";

function isErrorWithCode(error: unknown): error is { code?: unknown } {
  return typeof error === "object" && error !== null && "code" in error;
}

function isNetworkError(error: unknown): boolean {
  if (!isErrorWithCode(error) || typeof error.code !== "string") {
    return false;
  }
  return (
    error.code === "ECONNRESET" ||
    error.code === "ECONNREFUSED" ||
    error.code === "ETIMEDOUT" ||
    error.code === "ENOTFOUND" ||
    error.code === "EAI_AGAIN" ||
    error.code === "EPIPE" ||
    error.code === "EHOSTUNREACH" ||
    error.code === "ENETUNREACH" ||
    error.code === "3D000"
  );
}

export function exitCodeForError(error: unknown): CliExitCode {
  if (error instanceof AthenaCliError) {
    return error.exitCode;
  }
  if (error instanceof MigrationError) {
    switch (error.code) {
      case "CONFIG":
      case "PROVIDER":
        return CliExitCode.Configuration;
      case "INTEGRITY":
      case "HISTORY":
      case "LEDGER":
      case "SEMANTIC":
        return CliExitCode.Conflict;
      case "LOCK":
      case "DISCOVERY":
        return CliExitCode.Runtime;
      case "EXECUTION":
        return CliExitCode.Unexpected;
      default: {
        const _exhaustive: never = error.code;
        return _exhaustive;
      }
    }
  }
  if (isErrorWithCode(error) && error.code === "3D000") {
    return CliExitCode.Configuration;
  }
  if (isNetworkError(error)) {
    return CliExitCode.Runtime;
  }
  if (error instanceof Error) {
    const message = error.message;
    if (
      message.startsWith("Unknown command ") ||
      message.startsWith("Unknown option ") ||
      message.startsWith("Missing value for ") ||
      message.startsWith("Invalid --") ||
      message.startsWith("Unexpected ")
    ) {
      return CliExitCode.Usage;
    }
  }
  return CliExitCode.Unexpected;
}
