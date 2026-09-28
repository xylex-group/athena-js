#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBootstrapSession } from "./bootstrap-logging.js";

const binPath = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(binPath), "..");

function resolveExistingPath(filePath) {
  try {
    return realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}
const cliEntrypointPath = path.resolve(packageRoot, "dist", "cli", "index.js");
const packageJsonPath = path.resolve(packageRoot, "package.json");

function getInstalledVersion() {
  try {
    const packageJsonRaw = readFileSync(packageJsonPath, "utf8");
    const packageJson = JSON.parse(packageJsonRaw);
    return typeof packageJson.version === "string"
      ? packageJson.version
      : "unknown";
  } catch {
    return "unknown";
  }
}

function isDebugEnabled(argv) {
  return (
    argv.includes("--debug") ||
    process.env.ATHENA_JS_DEBUG === "1" ||
    process.env.ATHENA_JS_DEBUG === "true" ||
    process.env.ATHENA_CLI_LOG === "debug"
  );
}

function printMissingEntrypointError() {
  const installedVersion = getInstalledVersion();
  console.error(
    [
      "Failed to start athena-js CLI: package install is missing the generated CLI entrypoint.",
      `Expected file: ${cliEntrypointPath}`,
      `Installed package version: ${installedVersion}`,
      "",
      "Fix by reinstalling the latest package:",
      "  pnpm add -g @xylex-group/athena@latest",
      "  # or in the project:",
      "  pnpm add @xylex-group/athena@latest",
    ].join("\n")
  );
}

function formatRuntimeError(error, debug) {
  if (error instanceof Error) {
    if (debug) {
      return error.stack ?? error.message;
    }
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error.";
}

function isAlreadyFormattedCliError(detail) {
  if (typeof detail !== "string") {
    return false;
  }
  return (
    detail.includes("Schema introspection failed") ||
    detail.includes("does not exist (code 3D000)") ||
    detail.includes("Unknown option") ||
    detail.includes("Diagnostics:") ||
    detail.includes("Generated ") ||
    detail.startsWith("[athena-js]")
  );
}

function isVersionArgv(argv) {
  if (argv.length === 0) {
    return false;
  }
  const head = argv[0];
  return (
    head === "-v" || head === "--version" || head === "version" || head === "v"
  );
}

function signalExitCode(signal) {
  return signal === "SIGINT" ? 130 : 143;
}

async function boundedFlush(session) {
  await Promise.race([
    session.flush(),
    new Promise((resolve) => {
      const timer = setTimeout(resolve, 250);
      timer.unref?.();
    }),
  ]);
}

export async function main(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const entrypointPath = options.cliEntrypointPath ?? cliEntrypointPath;
  const debug = isDebugEnabled(argv);
  const session = createBootstrapSession({
    argv,
    cwd: process.cwd(),
    noLog: argv.includes("--no-log"),
    packageVersion: getInstalledVersion(),
  });
  let effectiveExitCode = 0;
  let signalCode;
  let shutdownStarted = false;
  let finishPromise;

  const cleanup = () => {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    process.removeListener("unhandledRejection", onUnhandledRejection);
    process.removeListener("uncaughtException", onUncaughtException);
  };

  const finish = (outcome, exitCode, data) => {
    if (finishPromise) {
      return finishPromise;
    }
    finishPromise = (async () => {
      session.finish({
        data,
        exitCode,
        outcome,
      });
      await boundedFlush(session);
      cleanup();
    })();
    return finishPromise;
  };

  const onSignal = (signal) => {
    const code = signalExitCode(signal);
    if (shutdownStarted) {
      process.exit(code);
      return;
    }
    if (finishPromise) {
      return;
    }
    shutdownStarted = true;
    signalCode = code;
    session.record({
      data: { signal },
      kind: "process.signal",
      level: "warn",
      message: signal,
    });
    process.exitCode = code;
    void finish("cancelled", code, { signal }).then(
      () => process.exit(code),
      () => process.exit(code)
    );
  };
  const onUnhandledRejection = (reason) => {
    if (shutdownStarted) {
      process.exit(1);
      return;
    }
    if (finishPromise) {
      return;
    }
    shutdownStarted = true;
    session.error("Unhandled promise rejection.", undefined, reason);
    process.exitCode = 1;
    void finish("failure", 1, { fatal: "unhandledRejection" }).then(
      () => process.exit(1),
      () => process.exit(1)
    );
  };
  const onUncaughtException = (error) => {
    if (shutdownStarted) {
      process.exit(1);
      return;
    }
    if (finishPromise) {
      return;
    }
    shutdownStarted = true;
    session.error("Uncaught exception.", undefined, error);
    process.exitCode = 1;
    void finish("failure", 1, { fatal: "uncaughtException" }).then(
      () => process.exit(1),
      () => process.exit(1)
    );
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.once("unhandledRejection", onUnhandledRejection);
  process.once("uncaughtException", onUncaughtException);

  try {
    // Fast path: version works even when dist/cli is missing.
    if (isVersionArgv(argv)) {
      const short = argv.includes("--short") || argv.includes("-q");
      const version = getInstalledVersion();
      console.log(short ? version : `@xylex-group/athena ${version}`);
      return;
    }

    if (!existsSync(entrypointPath)) {
      session.error("Compiled CLI entrypoint is missing.", undefined, {
        path: entrypointPath,
      });
      printMissingEntrypointError();
      effectiveExitCode = 1;
      return;
    }

    try {
      const cliEntrypointUrl = pathToFileURL(entrypointPath).href;
      session.info("Loading compiled CLI entrypoint.", {
        path: entrypointPath,
      });
      const cliModule = await import(cliEntrypointUrl);
      if (typeof cliModule.runCLI !== "function") {
        throw new Error("CLI module does not export runCLI.");
      }
      const result = await cliModule.runCLI(argv, { session });
      effectiveExitCode =
        typeof result?.exitCode === "number"
          ? result.exitCode
          : (process.exitCode ?? 0);
    } catch (error) {
      const errorDetail = formatRuntimeError(error, debug);
      session.error("Failed to start athena-js CLI.", undefined, error);
      if (isAlreadyFormattedCliError(errorDetail)) {
        console.error(errorDetail);
      } else if (errorDetail.includes("\n")) {
        console.error(`Failed to start athena-js CLI:\n${errorDetail}`);
      } else {
        console.error(`Failed to start athena-js CLI: ${errorDetail}`);
      }
      if (
        debug &&
        error instanceof Error &&
        error.stack &&
        !String(errorDetail).includes(error.stack)
      ) {
        console.error(error.stack);
      }
      effectiveExitCode = 1;
    }
  } finally {
    if (shutdownStarted) {
      await finish("cancelled", signalCode ?? 1);
    } else {
      effectiveExitCode = signalCode ?? effectiveExitCode;
      process.exitCode = effectiveExitCode;
      await finish(
        signalCode
          ? "cancelled"
          : effectiveExitCode === 0
            ? "success"
            : "failure",
        effectiveExitCode
      );
    }
  }
}

if (
  process.argv[1] &&
  resolveExistingPath(process.argv[1]) === resolveExistingPath(binPath)
) {
  void main();
}
