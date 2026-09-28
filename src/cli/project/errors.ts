import { AthenaConfigurationError } from "../../config/errors.ts";
import { AthenaCliError } from "../errors.ts";
import { CliExitCode } from "../exit-code.ts";

export const CLI_PROJECT_CONFIG_IMPORT_FAILED =
  "ATHENA_CLI_PROJECT_CONFIG_IMPORT_FAILED";
export const CLI_PROJECT_CONFIG_NOT_FOUND =
  "ATHENA_CLI_PROJECT_CONFIG_NOT_FOUND";

export function wrapCliProjectLoadError(error: unknown): AthenaCliError {
  if (error instanceof AthenaCliError) {
    return error;
  }
  if (error instanceof AthenaConfigurationError) {
    return new AthenaCliError({
      cause: error,
      code:
        error.code === "ATHENA_CONFIG_IMPORT_FAILED"
          ? CLI_PROJECT_CONFIG_IMPORT_FAILED
          : error.code,
      exitCode: CliExitCode.Configuration,
      message: error.message,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  const notFound = /No (Athena|generator) config found/i.test(message);
  return new AthenaCliError({
    cause: error instanceof Error ? error : undefined,
    code: notFound
      ? CLI_PROJECT_CONFIG_NOT_FOUND
      : CLI_PROJECT_CONFIG_IMPORT_FAILED,
    exitCode: CliExitCode.Configuration,
    message,
  });
}
