export interface CliPresentationFlags {
  forceColor: boolean;
  noColor: boolean;
}

const COLOR_NEVER = new Set(["never", "false", "0", "off", "no"]);
const COLOR_ALWAYS = new Set(["always", "true", "1", "on", "yes"]);

function applyColorValue(value: string, flags: CliPresentationFlags): void {
  const normalized = value.trim().toLowerCase();
  if (normalized === "" || COLOR_ALWAYS.has(normalized)) {
    flags.forceColor = true;
    flags.noColor = false;
    return;
  }
  if (COLOR_NEVER.has(normalized)) {
    flags.noColor = true;
    flags.forceColor = false;
  }
}

/**
 * Pull global presentation flags out of argv so command parsers never see them.
 *
 * Supported:
 *   --no-color
 *   --color
 *   --force-color
 *   --color=always|never|auto
 */
export function peelPresentationFlags(argv: readonly string[]): {
  argv: string[];
  presentation: CliPresentationFlags;
} {
  const presentation: CliPresentationFlags = {
    forceColor: false,
    noColor: false,
  };
  const tokens: string[] = [];

  for (const token of argv) {
    if (token === "--no-color") {
      presentation.noColor = true;
      presentation.forceColor = false;
      continue;
    }
    if (token === "--color" || token === "--force-color") {
      presentation.forceColor = true;
      presentation.noColor = false;
      continue;
    }
    if (token.startsWith("--color=")) {
      applyColorValue(token.slice("--color=".length), presentation);
      continue;
    }
    tokens.push(token);
  }

  return { argv: tokens, presentation };
}

/**
 * Expand `--flag=value` into `--flag`, `value` (including empty `--prefix=`).
 * Leaves `--flag` and `--flag=`-style color tokens to {@link peelPresentationFlags}.
 */
export function expandEqualsArgv(argv: readonly string[]): string[] {
  const tokens: string[] = [];
  for (const token of argv) {
    if (!token.startsWith("--") || token === "--") {
      tokens.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    if (eq <= 2) {
      tokens.push(token);
      continue;
    }
    tokens.push(token.slice(0, eq), token.slice(eq + 1));
  }
  return tokens;
}

export function argvWantsHelp(argv: readonly string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

export function flagName(flag: string): string {
  const [head] = flag.split(/\s+/);
  return head ?? flag;
}
