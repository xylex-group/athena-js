import type { CliCommand } from "../types.ts";
import type { CliGlobalFlags } from "./globals.ts";

function withJson<T extends object>(parsed: T, json: boolean): T {
  if (!(json && "json" in parsed)) {
    return parsed;
  }
  return { ...parsed, json: true };
}

function withPlain<T extends object>(parsed: T, plain: boolean): T {
  if (!(plain && "plain" in parsed)) {
    return parsed;
  }
  return { ...parsed, plain: true };
}

function withStrict<T extends object>(parsed: T, strict: boolean): T {
  if (!(strict && "strict" in parsed)) {
    return parsed;
  }
  return { ...parsed, strict: true };
}

function withConfig<T extends object>(
  parsed: T,
  configPath: string | undefined
): T {
  if (!(configPath && "configPath" in parsed)) {
    return parsed;
  }
  return { ...parsed, configPath };
}

/**
 * Merge peeled global flags onto the legacy `CliCommand` object so existing
 * command implementations keep reading `json` / `configPath` / `strict`.
 */
export function applyGlobalsToCommand(
  parsed: CliCommand,
  globals: CliGlobalFlags
): CliCommand {
  if (parsed.command === "help") {
    return parsed;
  }

  let next = parsed;
  const json = globals.output === "json";

  if (next.command === "commands") {
    if (json) {
      next = { ...next, format: "json" };
    } else if (globals.plain && next.format === "full") {
      next = { ...next, format: "plain" };
    }
  }

  next = withJson(next, json);
  next = withPlain(next, globals.plain);
  next = withStrict(next, globals.strict);
  next = withConfig(next, globals.configPath);
  return next;
}
