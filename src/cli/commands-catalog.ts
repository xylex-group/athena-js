/**
 * Full athena-js CLI command inventory (SSOT for `--commands` / `commands`).
 */

import { PACKAGE_VERSION } from "../sdk-version.ts";

export interface CliCommandEntry {
  /** Canonical invocation path, e.g. `api-key create`. */
  command: string;
  /** Short summary. */
  description: string;
  /** Notable flags (not exhaustive when `…` used). */
  flags?: string[];
  /** Alternate spellings that parse to the same command. */
  aliases?: string[];
  /** Grouping label for human output. */
  group:
    | "global"
    | "project"
    | "generator"
    | "migrations"
    | "env"
    | "gateway-admin"
    | "local-secrets";
  /** Help topic for `athena-js help <topic>`. */
  helpTopic?: string;
}

export const CLI_COMMAND_CATALOG: readonly CliCommandEntry[] = [
  {
    aliases: ["-h", "--help", "help"],
    command: "help",
    description: "Show root help (or help <topic>)",
    flags: ["[<topic>]"],
    group: "global",
    helpTopic: "root",
  },
  {
    aliases: ["-v", "--version", "v", "version"],
    command: "version",
    description: "Print @xylex-group/athena package version",
    flags: ["--short", "-q"],
    group: "global",
    helpTopic: "version",
  },
  {
    aliases: [
      "-C",
      "--commands",
      "--list-commands",
      "--cmds",
      "commands",
      "list-commands",
      "cmds",
    ],
    command: "commands",
    description: "List every CLI command, alias, and common flags",
    flags: ["--json", "--plain", "--groups"],
    group: "global",
    helpTopic: "commands",
  },
  {
    command: "init",
    description: "Create or surgically update athena.config.ts",
    flags: [
      "--config <path>",
      "--mode direct|gateway|auto",
      "--force",
      "--dry-run",
      "--no-discover-schemas",
      "-h",
    ],
    group: "project",
    helpTopic: "init",
  },
  {
    command: "generate",
    description: "Introspect schema and write models/registry artifacts",
    flags: [
      "--config <path>",
      "--dry-run",
      "--no-write-config",
      "--write-config",
      "--no-discover-schemas",
      "-h",
    ],
    group: "generator",
    helpTopic: "generate",
  },
  {
    command: "migrate",
    description: "Apply pending SQL migrations (direct Postgres)",
    flags: ["--config <path>", "--dry-run", "-h"],
    group: "migrations",
    helpTopic: "migrate",
  },
  {
    command: "migrate status",
    description: "Show applied/pending/conflict migration rows",
    flags: ["--config <path>", "-h"],
    group: "migrations",
    helpTopic: "migrate-status",
  },
  {
    command: "migrate plan",
    description: "Plan migrations; fail closed on history conflicts",
    flags: ["--config <path>", "-h"],
    group: "migrations",
    helpTopic: "migrate",
  },
  {
    aliases: ["env", "env validate"],
    command: "env check",
    description: "Validate .env / .env.local keys and URLs",
    flags: [
      "--file <path>",
      "-f <path>",
      "--mode auto|direct|gateway",
      "--strict",
      "--json",
      "-h",
    ],
    group: "env",
    helpTopic: "env",
  },
  {
    aliases: ["key generate", "api-key gen", "api-key new"],
    command: "api-key generate",
    description: "Generate a local offline ATHENA_API_KEY secret (no network)",
    flags: [
      "--bytes <n>",
      "--prefix <str>",
      "--write",
      "--env-file <path>",
      "--env-key <name>",
      "--force",
      "-h",
    ],
    group: "local-secrets",
    helpTopic: "api-key",
  },
  {
    aliases: ["key create"],
    command: "api-key create",
    description:
      "Create gateway API key via POST /admin/api-keys (static admin key)",
    flags: [
      "--name <name>",
      "--rights a,b",
      "--client-name <c>",
      "--description <d>",
      "--expires-at <iso>",
      "--url <gateway>",
      "--admin-key <secret>",
      "--write",
      "--env-file <path>",
      "--env-key <name>",
      "--force",
      "--json",
      "-h",
    ],
    group: "gateway-admin",
    helpTopic: "api-key",
  },
  {
    aliases: ["key list", "api-key ls", "key ls"],
    command: "api-key list",
    description: "List gateway API keys via GET /admin/api-keys",
    flags: ["--url <gateway>", "--admin-key <secret>", "--json", "-h"],
    group: "gateway-admin",
    helpTopic: "api-key",
  },
  {
    aliases: ["rights ls"],
    command: "rights list",
    description: "List dynamic API key rights (GET /admin/api-key-rights)",
    flags: ["--url <gateway>", "--admin-key <secret>", "--json", "-h"],
    group: "gateway-admin",
    helpTopic: "rights",
  },
  {
    aliases: ["rights all"],
    command: "rights catalog",
    description:
      "Unified native + dynamic rights catalog (GET /admin/rights/catalog)",
    flags: ["--url <gateway>", "--admin-key <secret>", "--json", "-h"],
    group: "gateway-admin",
    helpTopic: "rights",
  },
  {
    command: "rights create",
    description: "Bootstrap a right (POST /admin/api-key-rights)",
    flags: [
      "--name <right>",
      "--description <text>",
      "--url <gateway>",
      "--admin-key <secret>",
      "--json",
      "-h",
    ],
    group: "gateway-admin",
    helpTopic: "rights",
  },
] as const;

const GROUP_TITLES: Record<CliCommandEntry["group"], string> = {
  env: "Environment",
  generator: "Generator",
  global: "Global",
  "gateway-admin": "Gateway admin (ATHENA_KEY_12)",
  "local-secrets": "Local secrets",
  migrations: "Migrations",
  project: "Project config",
};

export type CommandsListFormat = "full" | "json" | "plain" | "groups";

export interface CommandsListOptions {
  format?: CommandsListFormat;
  /** Override catalog (tests). */
  catalog?: readonly CliCommandEntry[];
}

export function listCliCommands(
  options: CommandsListOptions = {}
): readonly CliCommandEntry[] {
  return options.catalog ?? CLI_COMMAND_CATALOG;
}

export function formatCommandsCatalog(
  options: CommandsListOptions = {}
): string {
  const catalog = [...listCliCommands(options)];
  const format = options.format ?? "full";

  if (format === "json") {
    return JSON.stringify(
      {
        commands: catalog,
        count: catalog.length,
        sdkVersion: PACKAGE_VERSION,
      },
      null,
      2
    );
  }

  if (format === "plain") {
    const paths = new Set<string>();
    for (const entry of catalog) {
      paths.add(entry.command);
      for (const alias of entry.aliases ?? []) {
        // Skip pure flag aliases in plain path mode when they start with -
        if (!alias.startsWith("-")) {
          paths.add(alias);
        }
      }
    }
    return [...paths].sort((a, b) => a.localeCompare(b)).join("\n");
  }

  if (format === "groups") {
    const byGroup = new Map<string, string[]>();
    for (const entry of catalog) {
      const title = GROUP_TITLES[entry.group];
      const bucket = byGroup.get(title) ?? [];
      bucket.push(entry.command);
      byGroup.set(title, bucket);
    }
    const lines = [`athena-js commands (sdk ${PACKAGE_VERSION})`, ""];
    for (const [title, commands] of byGroup.entries()) {
      lines.push(`${title}:`);
      for (const command of commands) {
        lines.push(`  ${command}`);
      }
      lines.push("");
    }
    return lines.join("\n").trimEnd();
  }

  // full
  const lines = [
    `athena-js command catalog (sdk ${PACKAGE_VERSION})`,
    `commands: ${catalog.length}`,
    "",
    "Global discovery:",
    "  athena-js --help | -h | help",
    "  athena-js --version | -v | version | v [--short|-q]",
    "  athena-js --commands | -C | commands [--json|--plain|--groups]",
    "  athena-js help <topic>",
    "",
  ];

  let currentGroup: CliCommandEntry["group"] | undefined;
  for (const entry of catalog) {
    if (entry.group !== currentGroup) {
      currentGroup = entry.group;
      lines.push(GROUP_TITLES[currentGroup]);
    }
    lines.push(`  ${entry.command}`);
    lines.push(`    ${entry.description}`);
    if (entry.aliases && entry.aliases.length > 0) {
      lines.push(`    aliases: ${entry.aliases.join(", ")}`);
    }
    if (entry.flags && entry.flags.length > 0) {
      lines.push(`    flags: ${entry.flags.join(" ")}`);
    }
    if (entry.helpTopic) {
      lines.push(`    help: athena-js help ${entry.helpTopic}`);
    }
    lines.push("");
  }

  lines.push("Tips:");
  lines.push("  athena-js <command> --help     detailed flags for one command");
  lines.push("  athena-js commands --json      machine-readable inventory");
  lines.push("  athena-js commands --plain     one path per line (scripting)");
  return lines.join("\n").trimEnd();
}

export function isCommandsToken(token: string | undefined): boolean {
  if (!token) {
    return false;
  }
  return (
    token === "--commands" ||
    token === "--list-commands" ||
    token === "--cmds" ||
    token === "-C" ||
    token === "commands" ||
    token === "list-commands" ||
    token === "cmds"
  );
}