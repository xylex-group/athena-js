import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PACKAGE_VERSION } from "../sdk-version.ts";
import { expandEqualsArgv, peelPresentationFlags } from "./argv.ts";
import type { CommandContext } from "./command-context.ts";
import { renderUsage } from "./commands/help/index.ts";
import { CLI_COMMAND_REGISTRY } from "./commands/register.ts";
import { isDebugEnabled, withCliDebugContext } from "./debug.ts";
import { AthenaCliError, ensureCliErrorId } from "./errors.ts";
import {
  getCliExitCode,
  setCliExitCode,
  withCliExitCodeContext,
} from "./exit-code.ts";
import { formatGeneratorError, logCliError } from "./format-error.ts";
import {
  createCliLogger,
  createCliTraceContext,
  runCliAsyncContext,
  sanitizeCliArgv,
} from "./logging/index.ts";
import type { AthenaCliLogger, BootstrapHandoffV1 } from "./logging/types.ts";
import { parseCommandResolved } from "./parse-command.ts";
import {
  dispatchRegistered,
  encodeCliJsonFailure,
  exitCodeForError,
  peelGlobalFlags,
  sessionTitleFor,
  stringifyCliJson,
} from "./platform/index.ts";
import type { CliRunSummary, CliRuntime, HelpCommand } from "./types.ts";
import { resolveCliCapabilities } from "./ui/capabilities.ts";
import { colorizeTaggedLine } from "./ui/help.ts";
import { railBar, railEnd, railStart, usesRail } from "./ui/rail.ts";
import type { CliCapabilities } from "./ui/types.ts";

export {
  type CatalogHelpTopic,
  CLI_COMMAND_CATALOG,
  type CliCatalogFlag,
  type CliCommandEntry,
  type CommandsListFormat,
  catalogHelpTopic,
  catalogOptionFlags,
  catalogOptionHelpHint,
  catalogRootCommands,
  catalogSubcommands,
  formatCommandsCatalog,
  formatExpectedCommandsLine,
  listCliCommands,
} from "./commands-catalog.ts";
export { CliExitCode } from "./exit-code.ts";
export { logCliError } from "./format-error.ts";
export type {
  AthenaCliLogger,
  CliLogEvent,
  CliLogKind,
  CliLogLevel,
  CliLogMode,
  CliTraceContext,
} from "./logging/index.ts";
export {
  createCliLogger,
  createCliTraceContext,
} from "./logging/index.ts";
export { parseCommand } from "./parse-command.ts";
export {
  CLI_JSON_SCHEMA_VERSION,
  type CliJsonEnvelope,
  type CommandResult,
  defineCommand,
  type RegisteredCommand,
} from "./platform/index.ts";
export type { CliRunSummary, CliRuntime } from "./types.ts";

export function usage(
  topic: HelpCommand["topic"] = "root",
  capabilities?: CliCapabilities
): string {
  return renderUsage(topic, capabilities);
}

function resolveCwd(explicit?: string): string {
  if (explicit && explicit.length > 0) {
    return explicit;
  }
  const proc = (globalThis as { process?: { cwd?: () => string } }).process;
  return proc?.cwd?.() ?? ".";
}

function wantsNoLog(argv: readonly string[]): boolean {
  return argv.some((token) => token === "--no-log");
}

function wantsDebug(
  argv: readonly string[],
  env: Record<string, string | undefined>
): boolean {
  return (
    argv.includes("--debug") ||
    env.ATHENA_JS_DEBUG === "1" ||
    env.ATHENA_JS_DEBUG === "true"
  );
}

type BootstrapSession = AthenaCliLogger & {
  getBootstrapHandoff: () => BootstrapHandoffV1;
  adopt: (logger: AthenaCliLogger) => void;
};

function isBootstrapSession(
  logger: AthenaCliLogger | undefined
): logger is BootstrapSession {
  return (
    logger !== undefined &&
    "getBootstrapHandoff" in logger &&
    "adopt" in logger &&
    typeof logger.getBootstrapHandoff === "function" &&
    typeof logger.adopt === "function"
  );
}

/**
 * Run the CLI without letting logging alter terminal output or business exit
 * codes. A caller-provided logger is owned by the caller, such as the package
 * launcher; direct callers get a complete invocation session automatically.
 */
export async function runCLI(
  argv: string[],
  runtime: CliRuntime = {}
): Promise<CliRunSummary> {
  return withCliExitCodeContext(() => runCLIInternal(argv, runtime));
}

async function runCLIInternal(
  argv: string[],
  runtime: CliRuntime
): Promise<CliRunSummary> {
  const processState = globalThis as typeof globalThis & {
    process?: { exitCode?: number };
  };
  if (processState.process) {
    processState.process.exitCode = undefined;
  }

  const providedLogger = runtime.logger ?? runtime.session;
  const loggerEnv = runtime.env ?? process.env;
  let logger: AthenaCliLogger;
  if (isBootstrapSession(providedLogger) && providedLogger.mode !== "off") {
    const handoff = providedLogger.getBootstrapHandoff();
    if (handoff) {
      try {
        const canonical = createCliLogger({
          baseMetadata: {
            packageVersion: PACKAGE_VERSION,
            sanitizedArgv: handoff.sanitizedArgv,
          },
          cwd: runtime.cwd,
          env: loggerEnv,
          invocationId: handoff.invocationId,
          mode: providedLogger.mode,
          now: new Date(handoff.startedAt),
          skipStart: true,
          traceId: handoff.traceId,
        });
        providedLogger.adopt(canonical);
        logger = canonical;
      } catch (error) {
        providedLogger.warn(
          "Canonical logger adoption failed; using bootstrap fallback.",
          { error }
        );
        logger = providedLogger;
      }
    } else {
      logger = providedLogger;
    }
  } else {
    logger =
      providedLogger ??
      createCliLogger({
        baseMetadata: {
          packageVersion: PACKAGE_VERSION,
          sanitizedArgv: sanitizeCliArgv(argv),
        },
        cwd: runtime.cwd,
        env: loggerEnv,
        mode: wantsNoLog(argv)
          ? "off"
          : wantsDebug(argv, loggerEnv) && loggerEnv.ATHENA_CLI_LOG !== "off"
            ? "debug"
            : undefined,
      });
  }
  const ownsLogger = providedLogger === undefined;
  const trace = createCliTraceContext(logger);
  const { argv: peeled, presentation } = peelPresentationFlags(argv);
  let globals: ReturnType<typeof peelGlobalFlags>["globals"] | undefined;
  let finalCommandId: string | undefined;
  let exitCode = 0;
  let outcome: CliRunSummary["outcome"] = "success";
  let captured: string[] = [];
  let writingFile = false;
  let cwd = resolveCwd(runtime.cwd);

  logger.record({
    data: { presentation, sanitizedArgv: sanitizeCliArgv(peeled) },
    kind: "parse.start",
    level: "debug",
  });

  const setFailure = (error: unknown, code = exitCodeForError(error)) => {
    exitCode = code;
    outcome = "failure";
    setCliExitCode(code);
    const errorId = ensureCliErrorId(error);
    if (!logger.hasReportedError?.(errorId)) {
      logger.record({
        data: { phase: "cli" },
        error,
        errorId,
        kind: "error",
        level: "error",
      });
    }
  };

  try {
    try {
      globals = peelGlobalFlags(expandEqualsArgv(peeled)).globals;
    } catch (error) {
      setFailure(error);
      logger.record({
        data: { errorId: ensureCliErrorId(error) },
        exitCode,
        kind: "parse.finish",
        level: "error",
        outcome: "failure",
      });
      const earlyErrorLog = (message: string) => {
        (runtime.errorLog ?? console.error)(message);
        logger.record({ kind: "stderr", level: "error", message });
      };
      logCliError(formatGeneratorError(error), earlyErrorLog);
    }

    if (globals) {
      const flags = globals;
      const debugEnv = runtime.env ?? process.env;
      await withCliDebugContext(
        flags.debug ||
          debugEnv.ATHENA_JS_DEBUG === "1" ||
          debugEnv.ATHENA_JS_DEBUG === "true",
        async () => {
          const json = flags.output === "json" || flags.output === "ndjson";
          writingFile = Boolean(flags.outputPath);
          const capabilities = resolveCliCapabilities({
            forceColor: writingFile ? false : presentation.forceColor,
            isTty: writingFile
              ? false
              : (runtime.isTty ??
                (runtime.log === undefined ? undefined : false)),
            json,
            noColor: writingFile || presentation.noColor,
            plain: flags.plain || presentation.noColor || writingFile,
            quiet: flags.verbosity === "quiet",
            verbose:
              flags.verbosity === "verbose" || flags.verbosity === "debug",
          });
          captured = [];
          const capture = (message: string) => {
            if (!writingFile) {
              return;
            }
            captured.push(message.endsWith("\n") ? message : `${message}\n`);
          };
          const emit = runtime.log ?? console.log;
          const emitErr = runtime.errorLog ?? console.error;
          let sessionActive = false;
          const logRaw = (message: string) => {
            emit(message);
            logger.record({ kind: "stdout", level: "info", message });
            capture(message);
          };
          const errorLog = (message: string) => {
            emitErr(message);
            logger.record({ kind: "stderr", level: "error", message });
            capture(message);
          };
          const log = (message: string) => {
            if (json || !sessionActive) {
              logRaw(
                json ? message : colorizeTaggedLine(message, capabilities)
              );
              return;
            }
            for (const part of message.split("\n")) {
              logRaw(
                railBar(colorizeTaggedLine(part, capabilities), capabilities)
              );
            }
          };
          const beginSession = (title: string) => {
            if (json || !usesRail(capabilities)) {
              return;
            }
            sessionActive = true;
            logRaw(railStart(title, capabilities));
          };
          const endSession = () => {
            if (!sessionActive) {
              return;
            }
            sessionActive = false;
            logRaw(railEnd("", capabilities));
          };

          cwd = resolveCwd(flags.cwd ?? runtime.cwd);
          try {
            let parsed: ReturnType<typeof parseCommandResolved>["value"];
            let resolved: ReturnType<typeof parseCommandResolved> | undefined;
            try {
              resolved = parseCommandResolved(argv);
              parsed = resolved.value;
              finalCommandId = resolved.registration.id;
              logger.record({
                commandId: finalCommandId,
                data: { commandId: finalCommandId },
                kind: "parse.finish",
                level: "info",
              });
            } catch (error) {
              setFailure(error);
              logger.record({
                data: { errorId: ensureCliErrorId(error) },
                exitCode,
                kind: "parse.finish",
                level: "error",
                outcome: "failure",
              });
              if (json) {
                const code =
                  error instanceof AthenaCliError ? error.code : "CLI001";
                const message =
                  error instanceof Error ? error.message : "Unknown CLI error.";
                logRaw(
                  stringifyCliJson(
                    encodeCliJsonFailure("athena-js", {
                      code,
                      details:
                        error instanceof AthenaCliError
                          ? error.metadata
                          : undefined,
                      hint:
                        error instanceof AthenaCliError
                          ? error.hint
                          : undefined,
                      message,
                    })
                  )
                );
              } else {
                logCliError(
                  formatGeneratorError(error),
                  errorLog,
                  capabilities
                );
              }
              parsed = undefined as never;
            }

            if (parsed && resolved) {
              const sessionTitle = sessionTitleFor(
                resolved.registration,
                parsed
              );
              if (sessionTitle) {
                beginSession(sessionTitle);
              }

              const ctx: CommandContext = {
                capabilities,
                cwd,
                errorLog,
                globals: flags,
                log,
                logger,
                logRaw,
                output: flags.output,
                presentation,
                reportError: (error, metadata) => {
                  logger.record({
                    data: metadata,
                    error,
                    kind: "error",
                    level: "error",
                  });
                },
                runtime: {
                  ...runtime,
                  cwd,
                  logger,
                  session: logger,
                },
                trace,
                verbosity: flags.verbosity,
              };

              try {
                const result = await runCliAsyncContext(
                  {
                    commandId: resolved.registration.id,
                    debugEnabled: isDebugEnabled(),
                    invocationId: logger.invocationId,
                    traceId: logger.traceId,
                  },
                  () => dispatchRegistered(CLI_COMMAND_REGISTRY, ctx, resolved)
                );
                const commandExitCode =
                  result?.exitCode ?? getCliExitCode() ?? 0;
                exitCode = commandExitCode;
                if (exitCode !== 0) {
                  outcome = "failure";
                }
              } catch (error) {
                setFailure(error);
                if (json) {
                  const code =
                    error instanceof AthenaCliError ? error.code : "CLI001";
                  const message =
                    error instanceof Error
                      ? error.message
                      : "Unknown CLI error.";
                  logRaw(
                    stringifyCliJson(
                      encodeCliJsonFailure(finalCommandId ?? "athena-js", {
                        code,
                        details:
                          error instanceof AthenaCliError
                            ? error.metadata
                            : undefined,
                        hint:
                          error instanceof AthenaCliError
                            ? error.hint
                            : undefined,
                        message,
                      })
                    )
                  );
                } else {
                  logCliError(
                    formatGeneratorError(error),
                    errorLog,
                    capabilities
                  );
                }
              } finally {
                endSession();
              }
            }
          } catch (error) {
            setFailure(error);
            (runtime.errorLog ?? console.error)(
              formatGeneratorError(error).message
            );
          }
        }
      );
    }
  } finally {
    if (globals?.outputPath) {
      try {
        const dest = resolve(cwd, globals.outputPath);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, captured.join(""), "utf8");
        logger.record({
          data: { operation: "output.write", path: dest },
          kind: "diagnostic",
          level: "info",
        });
      } catch (error) {
        setFailure(error);
        logger.record({
          data: { operation: "output.write" },
          error,
          kind: "error",
          level: "error",
        });
      }
    }
    if (ownsLogger) {
      logger.finish({
        commandId: finalCommandId,
        data: { outputPath: globals?.outputPath },
        exitCode,
        outcome,
      });
    }
    await logger.flush();
    const contextualExitCode = getCliExitCode();
    if (
      (contextualExitCode !== undefined || exitCode !== 0) &&
      processState.process
    ) {
      processState.process.exitCode = exitCode;
    }
  }

  return {
    commandId: finalCommandId,
    exitCode,
    loggingFailed: logger.loggingFailed,
    logPath: logger.logPath,
    outcome,
  };
}
