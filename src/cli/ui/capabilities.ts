import type { CliCapabilities, CliOutputMode } from "./types.ts";

export interface ResolveCliCapabilitiesOptions {
  /** Explicit --json */
  json?: boolean;
  /** Explicit --plain */
  plain?: boolean;
  /** Explicit --no-color */
  noColor?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  /** Injectable stdout TTY detection (tests). */
  isTty?: boolean;
  env?: Record<string, string | undefined>;
}

function readEnv(
  env: Record<string, string | undefined> | undefined
): Record<string, string | undefined> {
  if (env) {
    return env;
  }
  return (
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env ?? {}
  );
}

export function resolveCliOutputMode(
  options: ResolveCliCapabilitiesOptions = {}
): CliOutputMode {
  if (options.json) {
    return "json";
  }
  if (options.plain || options.noColor) {
    return "plain";
  }
  const env = readEnv(options.env);
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") {
    return "plain";
  }
  if (env.ATHENA_JS_PLAIN === "1" || env.ATHENA_JS_PLAIN === "true") {
    return "plain";
  }
  if (env.ATHENA_JS_JSON === "1" || env.ATHENA_JS_JSON === "true") {
    return "json";
  }
  const isTty =
    options.isTty ??
    Boolean(
      (globalThis as { process?: { stdout?: { isTTY?: boolean } } }).process
        ?.stdout?.isTTY
    );
  if (!isTty) {
    return "plain";
  }
  if (env.TERM === "dumb") {
    return "plain";
  }
  return "interactive";
}

export function resolveCliCapabilities(
  options: ResolveCliCapabilitiesOptions = {}
): CliCapabilities {
  const env = readEnv(options.env);
  const mode = resolveCliOutputMode(options);
  const isTty =
    options.isTty ??
    Boolean(
      (globalThis as { process?: { stdout?: { isTTY?: boolean } } }).process
        ?.stdout?.isTTY
    );
  const color =
    mode === "interactive" &&
    !options.noColor &&
    !(env.NO_COLOR !== undefined && env.NO_COLOR !== "") &&
    env.FORCE_COLOR !== "0";

  return {
    mode,
    color,
    isTty,
    quiet: Boolean(options.quiet),
    verbose: Boolean(options.verbose),
  };
}
