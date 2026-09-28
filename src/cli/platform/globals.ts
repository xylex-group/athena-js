import type { CliOutputFormat, CliVerbosity } from "./constants.ts";

export interface CliGlobalFlags {
  configPath?: string;
  cwd?: string;
  debug: boolean;
  noLog: boolean;
  output: CliOutputFormat;
  /** When set, CLI report lines are also written to this path (cwd-relative). */
  outputPath?: string;
  plain: boolean;
  profile?: string;
  strict: boolean;
  verbosity: CliVerbosity;
}

export interface PeeledGlobals {
  argv: string[];
  globals: CliGlobalFlags;
}

const OUTPUT_VALUES = new Set<CliOutputFormat>(["text", "json", "ndjson"]);

function takeValue(
  tokens: readonly string[],
  index: number,
  flag: string
): { nextIndex: number; value: string } {
  const nextValue = tokens[index + 1];
  if (nextValue === undefined || nextValue.startsWith("-")) {
    throw new Error(`Missing value for ${flag} option.`);
  }
  return { nextIndex: index + 2, value: nextValue };
}

/**
 * Pull global execution flags so command parsers never re-solve them.
 *
 * Compatibility:
 * - `-v` / `-q` stay version (`--version` / `--short`).
 * - `-C` stays the `commands` inventory alias (use `--cwd` for directory).
 * Use `--verbose` / `--quiet` for verbosity (not `-v` / `-q`).
 */
export function peelGlobalFlags(argv: readonly string[]): PeeledGlobals {
  const globals: CliGlobalFlags = {
    debug: false,
    noLog: false,
    output: "text",
    plain: false,
    strict: false,
    verbosity: "normal",
  };
  const tokens: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json" || token === "-j") {
      globals.output = "json";
      continue;
    }
    if (token === "--plain") {
      globals.plain = true;
      continue;
    }
    if (token === "--quiet") {
      globals.verbosity = "quiet";
      continue;
    }
    if (token === "--verbose") {
      globals.verbosity = "verbose";
      continue;
    }
    if (token === "--debug") {
      globals.debug = true;
      globals.verbosity = "debug";
      continue;
    }
    if (token === "--no-log") {
      globals.noLog = true;
      continue;
    }
    if (token === "--strict") {
      globals.strict = true;
      continue;
    }
    if (token === "--out-file") {
      const taken = takeValue(argv, index, "--out-file");
      globals.outputPath = taken.value;
      index = taken.nextIndex - 1;
      continue;
    }
    if (token === "--output" || token === "-o") {
      const taken = takeValue(argv, index, "--output");
      if (OUTPUT_VALUES.has(taken.value as CliOutputFormat)) {
        globals.output = taken.value as CliOutputFormat;
      } else {
        globals.outputPath = taken.value;
      }
      index = taken.nextIndex - 1;
      continue;
    }
    if (token === "--cwd") {
      const taken = takeValue(argv, index, "--cwd");
      globals.cwd = taken.value;
      index = taken.nextIndex - 1;
      continue;
    }
    if (token === "--config" || token === "-c") {
      const taken = takeValue(argv, index, "--config");
      globals.configPath = taken.value;
      index = taken.nextIndex - 1;
      continue;
    }
    if (token === "--profile") {
      const taken = takeValue(argv, index, "--profile");
      globals.profile = taken.value;
      index = taken.nextIndex - 1;
      continue;
    }
    tokens.push(token);
  }

  return { argv: tokens, globals };
}
