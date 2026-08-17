#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const binPath = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(binPath), "..");
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

function isDebugEnabled() {
  return (
    process.env.ATHENA_JS_DEBUG === "1" ||
    process.env.ATHENA_JS_DEBUG === "true"
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

function formatRuntimeError(error) {
  if (error instanceof Error) {
    if (isDebugEnabled()) {
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
    head === "-v" ||
    head === "--version" ||
    head === "version" ||
    head === "v"
  );
}

async function main() {
  const argv = process.argv.slice(2);

  // Fast path: version works even when dist/cli is missing (still report package.json).
  if (isVersionArgv(argv)) {
    const short = argv.includes("--short") || argv.includes("-q");
    const version = getInstalledVersion();
    console.log(short ? version : `@xylex-group/athena ${version}`);
    return;
  }

  if (!existsSync(cliEntrypointPath)) {
    printMissingEntrypointError();
    process.exit(1);
    return;
  }

  try {
    const cliEntrypointUrl = pathToFileURL(cliEntrypointPath).href;
    const cliModule = await import(cliEntrypointUrl);
    if (typeof cliModule.runCLI !== "function") {
      throw new Error("CLI module does not export runCLI.");
    }
    await cliModule.runCLI(argv);
    if (typeof process.exitCode === "number" && process.exitCode !== 0) {
      process.exit(process.exitCode);
    }
  } catch (err) {
    const errorDetail = formatRuntimeError(err);
    if (isAlreadyFormattedCliError(errorDetail)) {
      console.error(errorDetail);
    } else if (errorDetail.includes("\n")) {
      console.error(`Failed to start athena-js CLI:\n${errorDetail}`);
    } else {
      console.error(`Failed to start athena-js CLI: ${errorDetail}`);
    }
    if (
      isDebugEnabled() &&
      err instanceof Error &&
      err.stack &&
      !String(errorDetail).includes(err.stack)
    ) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

void main();
