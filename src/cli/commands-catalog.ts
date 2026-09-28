/**
 * Full athena-js CLI command inventory (assembled from `commands/<name>/catalog.ts`).
 */

import { ATHENA_MIGRATE_STATUS_COMMAND } from "../migrations/commands.ts";
import { PACKAGE_VERSION } from "../sdk-version.ts";
import { apiKeyCatalog } from "./commands/api-key/catalog.ts";
import { authCatalog } from "./commands/auth/catalog.ts";
import { billingCatalog } from "./commands/billing/catalog.ts";
import { commandsCatalog } from "./commands/commands/catalog.ts";
import { dbCatalog } from "./commands/db/catalog.ts";
import { doctorCatalog } from "./commands/doctor/catalog.ts";
import { envCatalog } from "./commands/env/catalog.ts";
import { generateCatalog } from "./commands/generate/catalog.ts";
import { helpCatalog } from "./commands/help/catalog.ts";
import { initCatalog } from "./commands/init/catalog.ts";
import { logsCatalog } from "./commands/logs/catalog.ts";
import { migrateCatalog } from "./commands/migrate/catalog.ts";
import { policyCatalog } from "./commands/policy/catalog.ts";
import { rightsCatalog } from "./commands/rights/catalog.ts";
import { schemaCatalog } from "./commands/schema/catalog.ts";
import { validateCatalog } from "./commands/validate/catalog.ts";
import { versionCatalog } from "./commands/version/catalog.ts";
import { resolveCliCapabilities } from "./ui/capabilities.ts";
import { paint } from "./ui/colors.ts";
import { styleHelpText } from "./ui/help.ts";
import type { CliCapabilities } from "./ui/types.ts";

/** Canonical `athena-js billing reconcile-subjects` inventory token. */
export const BILLING_RECONCILE_SUBJECTS_COMMAND = "billing reconcile-subjects";

/** Documented flag tokens in `CLI_COMMAND_CATALOG` (help / `commands` inventory). */
export type CliCatalogFlag =
  | "-f <path>"
  | "-h"
  | "-q"
  | "--admin-key <secret>"
  | "--allow-dirty-migrations"
  | "--apply"
  | "--bytes <n>"
  | "--client-name <c>"
  | "--config <path>"
  | "--description <d>"
  | "--description <text>"
  | "--dry-run"
  | "--env-file <path>"
  | "--env-key <name>"
  | "--expires-at <iso>"
  | "--file <path>"
  | "--force"
  | "--groups"
  | "--include-latest-log"
  | "--invocation <id>"
  | "--json"
  | `--mode ${string}`
  | "--name <name>"
  | "--name <right>"
  | "--no-discover-schemas"
  | "--no-log"
  | "--no-write-config"
  | "--plain"
  | "--prefix <str>"
  | "--rights a,b"
  | "--short"
  | "--skip-runtime"
  | "--strict"
  | "--url <gateway>"
  | "--write"
  | "--write-env"
  | "--write-config"
  | "--yes"
  | "--from <path>"
  | "--out <path>"
  | "--migration"
  | "--check"
  | "--limit <n>"
  | "--older-than <duration>"
  | "--errors"
  | "--id <id>"
  | "--action <name>"
  | "--resource <name>"
  | "--row"
  | "--row <json>"
  | "--format ir"
  | "--policy-impact"
  | "--connection <id>"
  | "--subject <id>"
  | "--provider <name>"
  | "--customer <id>"
  | "--cursor <cursor>"
  | "--classify-only"
  | "--include-ambiguous"
  | "--max-pages <n>"
  | "--max-customers <n>"
  | "--max-duration <ms>"
  | "[<topic>]";

export interface CliCommandEntry {
  /** Alternate spellings that parse to the same command. */
  aliases?: string[];
  /** Canonical invocation path, e.g. `api-key create`. */
  command: string;
  /** Short summary. */
  description: string;
  /** Example invocations (`athena-js …` or env-prefixed). */
  examples?: readonly string[];
  /** Notable flags (not exhaustive when `…` used). */
  flags?: readonly CliCatalogFlag[];
  /** Grouping label for human output. */
  group:
    | "global"
    | "project"
    | "generator"
    | "schema"
    | "migrations"
    | "auth"
    | "env"
    | "runtime"
    | "gateway-admin"
    | "local-secrets"
    | "policy";
  /** Help topic for `athena-js help <topic>`. */
  helpTopic?: CatalogHelpTopic;
  /** Extra help paragraphs after Options. */
  notes?: readonly string[];
}

export type CatalogHelpTopic =
  | "root"
  | "generate"
  | "init"
  | "migrate"
  | "migrate-status"
  | "env"
  | "api-key"
  | "rights"
  | "version"
  | "commands"
  | "validate"
  | "doctor"
  | "logs"
  | "schema"
  | "auth"
  | "policy"
  | "billing"
  | "db";

export const CLI_COMMAND_CATALOG: readonly CliCommandEntry[] = [
  ...helpCatalog,
  ...versionCatalog,
  ...commandsCatalog,
  ...initCatalog,
  ...generateCatalog,
  ...schemaCatalog,
  ...policyCatalog,
  ...billingCatalog,
  ...migrateCatalog,
  ...authCatalog,
  ...envCatalog,
  ...validateCatalog,
  ...doctorCatalog,
  ...dbCatalog,
  ...logsCatalog,
  ...apiKeyCatalog,
  ...rightsCatalog,
];

const GROUP_TITLES: Record<CliCommandEntry["group"], string> = {
  auth: "Auth",
  env: "Environment",
  "gateway-admin": "Gateway admin (ATHENA_KEY_12)",
  generator: "Generator",
  global: "Global",
  "local-secrets": "Local secrets",
  migrations: "Migrations",
  policy: "Policy",
  project: "Project config",
  runtime: "Local runtime",
  schema: "Schema",
};

export type CommandsListFormat = "full" | "json" | "plain" | "groups";

export interface CommandsListOptions {
  /** Color the human catalog. Defaults to TTY detection. Ignored for json/plain. */
  capabilities?: CliCapabilities;
  /** Override catalog (tests). */
  catalog?: readonly CliCommandEntry[];
  format?: CommandsListFormat;
}

export function listCliCommands(
  options: CommandsListOptions = {}
): readonly CliCommandEntry[] {
  return options.catalog ?? CLI_COMMAND_CATALOG;
}

function firstPathToken(path: string): string | undefined {
  const token = path.split(" ")[0];
  return token && token.length > 0 ? token : undefined;
}

function tokenAfterParent(path: string, parent: string): string | undefined {
  if (path === parent) {
    return;
  }
  const prefix = `${parent} `;
  if (!path.startsWith(prefix)) {
    return;
  }
  return firstPathToken(path.slice(prefix.length));
}

function uniqueInCatalogOrder(
  catalog: readonly CliCommandEntry[],
  pick: (entry: CliCommandEntry) => string | undefined
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of catalog) {
    const name = pick(entry);
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}

function catalogPathMatches(
  entryCommand: string,
  commandPath: string
): boolean {
  return (
    entryCommand === commandPath ||
    entryCommand.startsWith(`${commandPath} `) ||
    commandPath.startsWith(`${entryCommand} `)
  );
}

function optionFlagToken(flag: string): string | undefined {
  const token = flag.split(/\s+/)[0];
  return token?.startsWith("-") ? token : undefined;
}

/** Dash flags declared on catalog entries for `commandPath`, plus `--help` / `-h`. */
export function catalogOptionFlags(
  commandPath: string,
  catalog: readonly CliCommandEntry[] = CLI_COMMAND_CATALOG
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (name: string | undefined) => {
    if (!name || seen.has(name)) {
      return;
    }
    seen.add(name);
    names.push(name);
  };
  for (const entry of catalog) {
    if (!catalogPathMatches(entry.command, commandPath)) {
      continue;
    }
    for (const flag of entry.flags ?? []) {
      add(optionFlagToken(flag));
    }
  }
  add("--help");
  add("-h");
  return names;
}

export function catalogHelpTopic(
  command: string,
  rest: readonly string[] = [],
  catalog: readonly CliCommandEntry[] = CLI_COMMAND_CATALOG
): CatalogHelpTopic | undefined {
  const tokens = command.startsWith("-")
    ? [command]
    : [command, ...rest.filter((token) => !token.startsWith("-"))];
  for (let length = tokens.length; length >= 1; length -= 1) {
    const candidate = tokens.slice(0, length).join(" ");
    const topic = matchCatalogHelpTopic(candidate, catalog);
    if (topic) {
      return topic;
    }
  }
}

function matchCatalogHelpTopic(
  candidate: string,
  catalog: readonly CliCommandEntry[]
): CatalogHelpTopic | undefined {
  for (const entry of catalog) {
    if (entry.helpTopic && entry.command === candidate) {
      return entry.helpTopic;
    }
    for (const alias of entry.aliases ?? []) {
      if (entry.helpTopic && alias === candidate) {
        return entry.helpTopic;
      }
    }
  }
  for (const entry of catalog) {
    if (entry.helpTopic && firstPathToken(entry.command) === candidate) {
      return entry.helpTopic;
    }
    for (const alias of entry.aliases ?? []) {
      if (entry.helpTopic && firstPathToken(alias) === candidate) {
        return entry.helpTopic;
      }
    }
  }
}

export function catalogOptionHelpHint(
  commandPath: string,
  catalog: readonly CliCommandEntry[] = CLI_COMMAND_CATALOG
): string {
  if (!commandPath) {
    return "Run `athena-js --help` for usage.";
  }
  const topic = catalogHelpTopic(commandPath, [], catalog);
  if (topic && topic !== "root") {
    return `Run \`athena-js help ${topic}\` for flags.`;
  }
  return `Run \`athena-js ${commandPath} --help\` for flags.`;
}

/** Canonical top-level verbs (`generate`, `api-key`, …) in catalog order. */
export function catalogRootCommands(
  catalog: readonly CliCommandEntry[] = CLI_COMMAND_CATALOG
): string[] {
  return uniqueInCatalogOrder(catalog, (entry) =>
    firstPathToken(entry.command)
  );
}

/** Canonical subcommands of `parent` (`api-key create` → `create`). */
export function catalogSubcommands(
  parent: string,
  catalog: readonly CliCommandEntry[] = CLI_COMMAND_CATALOG
): string[] {
  return uniqueInCatalogOrder(catalog, (entry) =>
    tokenAfterParent(entry.command, parent)
  );
}

/**
 * Suggestion tokens for an unknown subcommand: canonical names plus
 * non-flag alias tails under the same parent (`api-key gen` → `gen`).
 */
export function catalogSubcommandTokens(
  parent: string,
  catalog: readonly CliCommandEntry[] = CLI_COMMAND_CATALOG
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (path: string) => {
    const name = tokenAfterParent(path, parent);
    if (!name || seen.has(name)) {
      return;
    }
    seen.add(name);
    names.push(name);
  };
  for (const entry of catalog) {
    add(entry.command);
    for (const alias of entry.aliases ?? []) {
      if (!alias.startsWith("-")) {
        add(alias);
      }
    }
  }
  return names;
}

/** `"a"`, `"a" or "b"`, or `"a", "b", or "c"`. */
export function formatQuotedOrList(items: readonly string[]): string {
  if (items.length === 0) {
    return "";
  }
  if (items.length === 1) {
    return `"${items[0]}"`;
  }
  const quoted = items.map((item) => `"${item}"`);
  if (quoted.length === 2) {
    return `${quoted[0]} or ${quoted[1]}`;
  }
  const last = quoted.at(-1);
  return `${quoted.slice(0, -1).join(", ")}, or ${last}`;
}

export function formatExpectedCommandsLine(items: readonly string[]): string {
  const list = formatQuotedOrList(items);
  return list.length > 0 ? `Expected ${list}.` : "";
}

const HELP_COLUMN = 24;

function formatHelpColumn(left: string, description: string): string {
  const body = left.startsWith("  ") ? left : `  ${left}`;
  if (body.length >= HELP_COLUMN) {
    return `${body} ${description}`;
  }
  return `${body}${" ".repeat(HELP_COLUMN - body.length)}${description}`;
}

function usageFlags(flags: readonly CliCatalogFlag[] | undefined): string {
  const visible = (flags ?? []).filter((flag) => flag !== "-h");
  return visible.length > 0 ? ` ${visible.join(" ")}` : "";
}

function dashAliases(entry: CliCommandEntry): string[] {
  return (entry.aliases ?? []).filter((alias) => alias.startsWith("-"));
}

/** One invocation line: `athena-js generate --dry-run …`. */
export function formatCatalogInvocation(entry: CliCommandEntry): string {
  return `athena-js ${entry.command}${usageFlags(entry.flags)}`;
}

function catalogGroupsInOrder(
  catalog: readonly CliCommandEntry[]
): CliCommandEntry["group"][] {
  const groups: CliCommandEntry["group"][] = [];
  const seen = new Set<CliCommandEntry["group"]>();
  for (const entry of catalog) {
    if (seen.has(entry.group)) {
      continue;
    }
    seen.add(entry.group);
    groups.push(entry.group);
  }
  return groups;
}

function familySectionLines(
  catalog: readonly CliCommandEntry[],
  render: (entry: CliCommandEntry) => string | undefined
): string[] {
  const lines: string[] = [];
  for (const group of catalogGroupsInOrder(catalog)) {
    const rendered: string[] = [];
    for (const entry of catalog) {
      if (entry.group !== group || entry.command === "help") {
        continue;
      }
      const line = render(entry);
      if (line) {
        rendered.push(line);
      }
    }
    if (rendered.length === 0) {
      continue;
    }
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(`${GROUP_TITLES[group]}:`);
    lines.push(...rendered);
  }
  return lines;
}

function rootCommandRows(catalog: readonly CliCommandEntry[]): Array<{
  description: string;
  group: CliCommandEntry["group"];
  name: string;
}> {
  const rows: Array<{
    description: string;
    group: CliCommandEntry["group"];
    name: string;
  }> = [];
  const seen = new Set<string>();
  for (const entry of catalog) {
    const name = firstPathToken(entry.command);
    if (!name || name === "help" || seen.has(name)) {
      continue;
    }
    seen.add(name);
    const exact = catalog.find((candidate) => candidate.command === name);
    rows.push({
      description: exact?.description ?? entry.description,
      group: exact?.group ?? entry.group,
      name,
    });
  }
  return rows;
}

function groupedRootCommandLines(
  catalog: readonly CliCommandEntry[]
): string[] {
  const rows = rootCommandRows(catalog);
  const lines: string[] = [];
  for (const group of catalogGroupsInOrder(catalog)) {
    const groupRows = rows.filter((row) => row.group === group);
    if (groupRows.length === 0) {
      continue;
    }
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(`${GROUP_TITLES[group]}:`);
    for (const row of groupRows) {
      lines.push(formatHelpColumn(row.name, row.description));
    }
  }
  return lines;
}

function globalOptionRows(catalog: readonly CliCommandEntry[]): string[] {
  const rows: string[] = [];
  for (const entry of catalog) {
    if (entry.group !== "global" || entry.command === "help") {
      continue;
    }
    const flags = dashAliases(entry);
    if (flags.length === 0) {
      continue;
    }
    rows.push(
      formatHelpColumn(flags.slice(0, 2).join(", "), entry.description)
    );
    for (const extra of flags.slice(2)) {
      rows.push(
        formatHelpColumn(extra, `Alias of ${flags[1] ?? entry.command}`)
      );
    }
  }
  const help = catalog.find((entry) => entry.command === "help");
  if (help) {
    const flags = dashAliases(help);
    rows.unshift(
      formatHelpColumn(
        flags.length > 0 ? flags.join(", ") : "-h, --help",
        `${help.description} (also: athena-js --help <command>)`
      )
    );
  }
  rows.push(
    formatHelpColumn(
      "--color",
      "Force ANSI color (--color=always, or FORCE_COLOR=1)"
    )
  );
  rows.push(
    formatHelpColumn(
      "--no-color",
      "Disable ANSI color (--color=never, or NO_COLOR=1)"
    )
  );
  rows.push(
    formatHelpColumn(
      "-o, --output <format|file>",
      "Format text|json|ndjson, or a report file path (e.g. -o strict.txt)"
    )
  );
  rows.push(formatHelpColumn("-j, --json", "Alias of --output json"));
  rows.push(
    formatHelpColumn(
      "--out-file <path>",
      "Write the CLI report to a file (combine with --json for JSON)"
    )
  );
  rows.push(formatHelpColumn("--plain", "Disable rails and color"));
  rows.push(formatHelpColumn("--quiet", "Reduce informational text"));
  rows.push(
    formatHelpColumn("--verbose", "Print timings and extra diagnostics")
  );
  rows.push(
    formatHelpColumn(
      "--cwd <path>",
      "Working directory (use --cwd; -C remains commands)"
    )
  );
  rows.push(formatHelpColumn("-c, --config <path>", "athena.config path"));
  rows.push(formatHelpColumn("--profile <name>", "Named CLI profile"));
  rows.push(
    formatHelpColumn("--strict", "Promote configured warnings to errors")
  );
  rows.push(
    formatHelpColumn("--debug", "Debug verbosity (also ATHENA_JS_DEBUG=1)")
  );
  rows.push(
    formatHelpColumn(
      "--no-log",
      "Disable persistent CLI logging for this invocation"
    )
  );
  return rows;
}

/** Root `athena-js --help` text from the command catalog. */
export function formatRootUsage(
  catalog: readonly CliCommandEntry[] = CLI_COMMAND_CATALOG
): string {
  const usageLines = familySectionLines(
    catalog,
    (entry) => `  ${formatCatalogInvocation(entry)}`
  );
  const commandLines = groupedRootCommandLines(catalog);
  const exampleLines = familySectionLines(
    catalog,
    (entry) => `  athena-js ${entry.command}`
  );

  return [
    `athena-js  ${PACKAGE_VERSION}`,
    "",
    "Schema, Auth, and environment CLI for @xylex-group/athena.",
    "",
    "Usage:",
    ...usageLines,
    "",
    "Commands:",
    ...commandLines,
    "",
    "Global options:",
    ...globalOptionRows(catalog),
    "",
    "Examples:",
    ...exampleLines,
    "  athena-js --help",
    "  athena-js <command> --help",
  ].join("\n");
}

/** Topic help (`athena-js help generate`, `help migrate`, …) from catalog entries. */
export function formatCatalogTopicUsage(
  topic: CatalogHelpTopic,
  catalog: readonly CliCommandEntry[] = CLI_COMMAND_CATALOG
): string {
  if (topic === "root") {
    return formatRootUsage(catalog);
  }

  const exact = catalog.filter((entry) => entry.helpTopic === topic);
  const rootName = topic.includes("-") ? undefined : topic;
  const entries =
    rootName === undefined
      ? exact
      : catalog.filter((entry) => firstPathToken(entry.command) === rootName);
  const pages = entries.length > 0 ? entries : exact;
  const primary = pages[0];
  if (!primary) {
    return `athena-js ${topic}`;
  }

  const titleRoot = firstPathToken(primary.command) ?? primary.command;
  const title =
    topic === "migrate-status"
      ? ATHENA_MIGRATE_STATUS_COMMAND
      : `athena-js ${titleRoot}`;

  const invocations = new Set<string>();
  for (const entry of pages) {
    invocations.add(`  ${formatCatalogInvocation(entry)}`);
    for (const alias of entry.aliases ?? []) {
      if (alias.startsWith("-") && !alias.startsWith("--")) {
        invocations.add(`  athena-js ${alias}`);
        continue;
      }
      invocations.add(`  athena-js ${alias}${usageFlags(entry.flags)}`);
    }
  }

  const optionFlags: string[] = [];
  const seenFlags = new Set<string>();
  const addFlag = (flag: string) => {
    if (seenFlags.has(flag)) {
      return;
    }
    seenFlags.add(flag);
    optionFlags.push(flag);
  };
  for (const entry of pages) {
    for (const flag of entry.flags ?? []) {
      if (flag === "-h") {
        continue;
      }
      addFlag(flag);
    }
  }
  addFlag("-h, --help");

  const notes: string[] = [];
  const examples: string[] = [];
  const seenNote = new Set<string>();
  for (const entry of pages) {
    notes.push(entry.description);
    for (const note of entry.notes ?? []) {
      if (seenNote.has(note)) {
        continue;
      }
      seenNote.add(note);
      notes.push(note);
    }
    for (const example of entry.examples ?? []) {
      examples.push(example.startsWith("  ") ? example : `  ${example}`);
    }
  }
  if (examples.length === 0) {
    for (const entry of pages) {
      examples.push(`  athena-js ${entry.command}`);
    }
  }

  return [
    title,
    "",
    "Usage:",
    ...invocations,
    "",
    "Options:",
    ...optionFlags.map((flag) => `  ${flag}`),
    "",
    ...notes,
    "",
    "Examples:",
    ...examples,
  ].join("\n");
}

/** Topic help for a single catalog command name (e.g. `version`). */
export function formatCatalogCommandUsage(
  commandName: string,
  catalog: readonly CliCommandEntry[] = CLI_COMMAND_CATALOG
): string {
  const primary =
    catalog.find((entry) => entry.command === commandName) ??
    catalog.find((entry) => firstPathToken(entry.command) === commandName);
  const topic = primary?.helpTopic;
  if (!topic || topic === "root") {
    return formatRootUsage(catalog);
  }
  return formatCatalogTopicUsage(topic, catalog);
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

  const capabilities =
    options.capabilities ??
    resolveCliCapabilities({
      plain: true,
    });

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
      lines.push(`${paint(`${title}:`, "cyan", capabilities)}`);
      for (const command of commands) {
        lines.push(`  ${command}`);
      }
      lines.push("");
    }
    return styleHelpText(lines.join("\n").trimEnd(), capabilities);
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
      lines.push(`${GROUP_TITLES[currentGroup]}:`);
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
  return styleHelpText(lines.join("\n").trimEnd(), capabilities);
}
