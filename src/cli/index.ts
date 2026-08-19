import { ensureGeneratorConfigFile } from "../generator/config-file.ts";
import { runSchemaGenerator } from "../generator/pipeline.ts";
import { runMigrations } from "../migrations/runner.ts";
import type { MigrationCommandMode } from "../migrations/types.ts";
import { MigrationError } from "../migrations/types.ts";
import { PACKAGE_VERSION } from "../sdk-version.ts";
import {
  generateApiKey,
  writeApiKeyToEnvFile,
} from "./api-key.ts";
import {
  createGatewayApiKey,
  createGatewayApiKeyRight,
  formatApiKeyRecords,
  formatApiKeyRights,
  formatCreatedApiKey,
  formatRightsCatalog,
  listGatewayApiKeyRights,
  listGatewayApiKeys,
  listGatewayRightsCatalog,
  resolveGatewayAdminCredentials,
} from "./gateway-admin.ts";
import {
  type CommandsListFormat,
  formatCommandsCatalog,
  isCommandsToken,
} from "./commands-catalog.ts";
import {
  type EnvCheckMode,
  formatEnvCheckReport,
  validateProjectEnv,
} from "./project-env.ts";

export {
  CLI_COMMAND_CATALOG,
  formatCommandsCatalog,
  listCliCommands,
  type CliCommandEntry,
  type CommandsListFormat,
} from "./commands-catalog.ts";

function setCliExitCode(code: number): void {
  const proc = (globalThis as { process?: { exitCode?: number } }).process;
  if (proc) {
    proc.exitCode = code;
  }
}

interface GenerateCommand {
  command: "generate";
  configPath?: string;
  /** When false, skip live schema discovery. Default true. */
  discoverSchemas: boolean;
  dryRun: boolean;
  /** When false, never write/update athena.config.ts. Default true. */
  writeConfig: boolean;
}

interface InitCommand {
  command: "init";
  configPath?: string;
  discoverSchemas: boolean;
  dryRun: boolean;
  force: boolean;
  mode: "direct" | "gateway" | "auto";
}

interface MigrateCommand {
  command: "migrate";
  configPath?: string;
  dryRun: boolean;
  json?: boolean;
  mode: Exclude<MigrationCommandMode, "dry-run"> | "dry-run" | "repair";
  plain?: boolean;
  yes?: boolean;
}

interface HelpCommand {
  command: "help";
  topic:
    | "root"
    | "generate"
    | "init"
    | "migrate"
    | "migrate-status"
    | "env"
    | "api-key"
    | "rights"
    | "version"
    | "commands";
}

interface VersionCommand {
  command: "version";
  /** When true, print only the semver (no package name prefix). */
  short: boolean;
}

interface CommandsCommand {
  command: "commands";
  format: CommandsListFormat;
}

interface EnvCommand {
  command: "env";
  /** Env files to inspect (relative or absolute). Empty = default project load order. */
  files: string[];
  json: boolean;
  mode: EnvCheckMode;
  strict: boolean;
}

interface GatewayAdminFlags {
  adminKey?: string;
  json: boolean;
  url?: string;
}

interface ApiKeyGenerateCommand {
  command: "api-key-generate";
  bytes: number;
  /** When set, write the key into this env file (default `.env.local` if --write). */
  envFile?: string;
  envKey: string;
  force: boolean;
  prefix: string;
  write: boolean;
}

interface ApiKeyListCommand extends GatewayAdminFlags {
  command: "api-key-list";
}

interface ApiKeyCreateCommand extends GatewayAdminFlags {
  command: "api-key-create";
  clientName?: string;
  description?: string;
  envFile?: string;
  envKey: string;
  expiresAt?: string;
  force: boolean;
  name: string;
  rights: string[];
  write: boolean;
}

interface RightsListCommand extends GatewayAdminFlags {
  command: "rights-list";
}

interface RightsCatalogCommand extends GatewayAdminFlags {
  command: "rights-catalog";
}

interface RightsCreateCommand extends GatewayAdminFlags {
  command: "rights-create";
  description?: string;
  name: string;
}

type CliCommand =
  | GenerateCommand
  | InitCommand
  | MigrateCommand
  | HelpCommand
  | VersionCommand
  | CommandsCommand
  | EnvCommand
  | ApiKeyGenerateCommand
  | ApiKeyListCommand
  | ApiKeyCreateCommand
  | RightsListCommand
  | RightsCatalogCommand
  | RightsCreateCommand;

export interface CliRuntime {
  ensureConfig?: typeof ensureGeneratorConfigFile;
  /** Defaults to `console.error`. */
  errorLog?: (message: string) => void;
  /** Inject fetch for gateway admin commands (tests). */
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  runGenerator?: typeof runSchemaGenerator;
  runMigrations?: typeof runMigrations;
  /** Override cwd for env / api-key file operations (tests). */
  cwd?: string;
}

interface ErrorWithCode {
  address?: unknown;
  cause?: unknown;
  code?: unknown;
  errno?: unknown;
  hostname?: unknown;
  message?: unknown;
  port?: unknown;
  stack?: unknown;
  syscall?: unknown;
}

function isDebugEnabled(): boolean {
  const value = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env?.ATHENA_JS_DEBUG;
  return value === "1" || value === "true";
}

function rootUsage(): string {
  return [
    "athena-js CLI",
    "",
    "Usage:",
    "  athena-js generate [--config <path>] [--dry-run] [--no-write-config] [--no-discover-schemas]",
    "  athena-js init [--config <path>] [--mode direct|gateway] [--force] [--dry-run] [--no-discover-schemas]",
    "  athena-js migrate [--config <path>] [--dry-run] [--json] [--plain]",
    "  athena-js migrate status|plan [--config <path>] [--json] [--plain]",
    "  athena-js migrate repair [--config <path>] [--yes] [--dry-run] [--json]",
    "  athena-js env check [--file <path>]... [--mode auto|direct|gateway] [--strict] [--json]",
    "  athena-js api-key generate|create|list …",
    "  athena-js rights list|catalog|create …",
    "  athena-js version | -v | --version",
    "  athena-js commands | --commands | -C",
    "",
    "Global options:",
    "  -h, --help              Show help",
    "  -v, --version           Print CLI / package version",
    "  -C, --commands          List every command, alias, and common flags",
    "  --list-commands         Alias of --commands",
    "",
    "Examples:",
    "  athena-js init",
    "  athena-js generate",
    "  athena-js migrate",
    "  athena-js migrate status",
    "  athena-js env check",
    "  athena-js env check --file .env.local --mode gateway",
    "  athena-js rights catalog",
    "  athena-js rights list",
    "  athena-js api-key create --name app --rights gateway.query --write",
    "  athena-js api-key list",
    "  athena-js api-key generate --write",
    "  athena-js --version",
    "  athena-js --commands",
    "  athena-js commands --json",
    "  DATABASE_URL=******127.0.0.1:5432/app_db athena-js generate --dry-run",
    "  ATHENA_URL=https://athena.example.com ATHENA_API_KEY=secret athena-js init --mode gateway",
    "  athena-js generate --config ./athena.config.ts --dry-run",
    "  athena-js generate --help",
    "  athena-js migrate --help",
  ].join("\n");
}

function versionUsage(): string {
  return [
    "athena-js version",
    "",
    "Usage:",
    "  athena-js version",
    "  athena-js v",
    "  athena-js -v",
    "  athena-js --version",
    "",
    "Options:",
    "  --short, -q             Print only the semver (no package name)",
    "",
    "Prints the installed @xylex-group/athena package version.",
  ].join("\n");
}

function commandsUsage(): string {
  return [
    "athena-js commands",
    "",
    "Usage:",
    "  athena-js commands [--json|--plain|--groups]",
    "  athena-js --commands [--json|--plain|--groups]",
    "  athena-js -C",
    "  athena-js list-commands",
    "  athena-js cmds",
    "  athena-js --list-commands",
    "  athena-js --cmds",
    "",
    "Options:",
    "  --json                  Machine-readable full catalog",
    "  --plain                 One command path / alias per line",
    "  --groups                Compact group → command list",
    "",
    "Prints the full athena-js command inventory (SSOT).",
    "Use `athena-js <command> --help` for detailed flags on one command.",
  ].join("\n");
}

function parseCommandsFormat(rest: string[]): CommandsListFormat {
  let format: CommandsListFormat = "full";
  for (const token of rest) {
    if (token === "--help" || token === "-h") {
      // Caller maps help via dedicated path; keep format default.
      continue;
    }
    if (token === "--json") {
      format = "json";
      continue;
    }
    if (token === "--plain") {
      format = "plain";
      continue;
    }
    if (token === "--groups") {
      format = "groups";
      continue;
    }
    throw new Error(
      `Unknown option "${token}" for commands. Expected --json, --plain, or --groups.`
    );
  }
  return format;
}

function envUsage(): string {
  return [
    "athena-js env",
    "",
    "Usage:",
    "  athena-js env check [--file <path>]... [--mode auto|direct|gateway] [--strict] [--json]",
    "  athena-js env validate   (alias of check)",
    "  athena-js env            (alias of check)",
    "",
    "Options:",
    "  --file <path>           Inspect a specific env file (repeatable). Default: .env, .env.local, .env.<NODE_ENV>*",
    "  --mode auto|direct|gateway  Expected connection mode (default: auto)",
    "  --strict                Promote soft warnings (e.g. short keys) to errors",
    "  --json                  Emit machine-readable JSON",
    "  -h, --help              Show help for env",
    "",
    "Validates Athena-related keys and URLs from project env files and process env:",
    "  - gateway: ATHENA_URL / ATHENA_GATEWAY_URL + ATHENA_API_KEY (http(s) URL, non-placeholder secret)",
    "  - direct:  DATABASE_URL / PG_URL / POSTGRES_URL (postgres connection string)",
    "  - optional: ATHENA_CLIENT, ATHENA_AUTH_URL",
    "",
    "Exit codes:",
    "  0  no errors (warnings allowed unless you treat CI logs as fail)",
    "  1  one or more validation errors",
    "",
    "Examples:",
    "  athena-js env check",
    "  athena-js env check --file .env.local --mode gateway",
    "  athena-js env validate --json",
  ].join("\n");
}

function apiKeyUsage(): string {
  return [
    "athena-js api-key",
    "",
    "Usage:",
    "  athena-js api-key generate [--bytes <n>] [--prefix <str>] [--write] [--env-file <path>] [--env-key <name>] [--force]",
    "  athena-js api-key create --name <name> [--rights a,b] [--client-name <c>] [--description <d>] [--expires-at <iso>]",
    "                          [--url <gateway>] [--admin-key <secret>] [--write] [--env-file <path>] [--force] [--json]",
    "  athena-js api-key list [--url <gateway>] [--admin-key <secret>] [--json]",
    "  athena-js key …         (alias of api-key)",
    "",
    "Local generate options:",
    "  --bytes <n>             Entropy bytes before base64url (16–64, default 32)",
    "  --prefix <str>          Key prefix (default: ath_ ; use --prefix \"\" for none)",
    "  --write                 Write the key into an env file (default path: .env.local)",
    "  --env-file <path>       Target env file when using --write (implies --write)",
    "  --env-key <name>        Env var name to set (default: ATHENA_API_KEY)",
    "  --force                 Overwrite an existing env key",
    "",
    "Gateway create/list options (static admin key required):",
    "  --name <name>           Key display name (create, required)",
    "  --rights <list>         Comma-separated rights (must exist in api_key_rights)",
    "  --client-name <name>    Bind key to X-Athena-Client value",
    "  --description <text>    Optional description",
    "  --expires-at <iso>      Optional expiration timestamp",
    "  --url <gateway>         Gateway base URL (else ATHENA_URL / ATHENA_GATEWAY_URL)",
    "  --admin-key <secret>    Static admin secret (else ATHENA_KEY_12 / ATHENA_P12_KEY / ATHENA_ADMIN_KEY)",
    "  --json                  Machine-readable JSON",
    "  -h, --help              Show help for api-key",
    "",
    "Notes:",
    "  - generate: local secret only (no network) — useful for offline scaffolding",
    "  - create/list: POST/GET /admin/api-keys via gateway admin (ATHENA_KEY_12)",
    "  - Auth user keys remain client.auth.apiKey.* (POST /api-key/create) — different surface",
    "  - create plaintext is returned once; use --write to save as ATHENA_API_KEY",
    "",
    "Examples:",
    "  athena-js api-key generate --write",
    "  athena-js rights list",
    "  athena-js api-key create --name analytics --rights gateway.query --client-name analytics --write",
    "  athena-js api-key list --json",
  ].join("\n");
}

function rightsUsage(): string {
  return [
    "athena-js rights",
    "",
    "Usage:",
    "  athena-js rights list [--url <gateway>] [--admin-key <secret>] [--json]",
    "  athena-js rights catalog [--url <gateway>] [--admin-key <secret>] [--json]",
    "  athena-js rights create --name <right> [--description <text>] [--url <gateway>] [--admin-key <secret>] [--json]",
    "",
    "Options:",
    "  --name <right>          Right name for create (e.g. gateway.query)",
    "  --description <text>    Optional description when creating a right",
    "  --url <gateway>         Gateway base URL (else ATHENA_URL / ATHENA_GATEWAY_URL)",
    "  --admin-key <secret>    Static admin secret (else ATHENA_KEY_12 / ATHENA_P12_KEY / ATHENA_ADMIN_KEY)",
    "  --json                  Machine-readable JSON",
    "  -h, --help              Show help for rights",
    "",
    "Routes:",
    "  list     → GET /admin/api-key-rights   (dynamic rights store)",
    "  catalog  → GET /admin/rights/catalog   (native + dynamic unified catalog)",
    "  create   → POST /admin/api-key-rights  (bootstrap a right before key grants)",
    "",
    "Examples:",
    "  athena-js rights catalog",
    "  athena-js rights list",
    "  athena-js rights create --name gateway.query --description \"Run /gateway/query\"",
  ].join("\n");
}

function migrateUsage(): string {
  return [
    "athena-js migrate",
    "",
    "Usage:",
    "  athena-js migrate [--config <path>] [--dry-run] [--json] [--plain]",
    "  athena-js migrate status [--config <path>] [--json] [--plain]",
    "  athena-js migrate plan [--config <path>] [--json] [--plain]",
    "  athena-js migrate repair [--config <path>] [--yes] [--dry-run] [--json]",
    "",
    "Options:",
    "  --config <path>         Explicit path to athena.config.ts or athena-js.config.ts",
    "  --dry-run               Show pending migrations without applying them",
    "  --yes                   Confirm repair without an interactive prompt (required in CI)",
    "  --json                  Machine-readable structured output",
    "  --plain                 Disable interactive styling",
    "  -h, --help              Show help for migrate",
    "",
    "Behavior:",
    "  - discovers ordered SQL files under athena/migrations (or config.migrations.directory)",
    "  - applies embedded Auth schema migrations (athena.auth_schema_migrations) in the same command",
    "  - detects ledger-applied Auth migrations whose physical schema has drifted",
    "  - fails closed on drift during normal migrate; use migrate repair to fix",
    "  - requires provider.kind=postgres and provider.mode=direct",
    "  - applies each pending migration in its own transaction with SHA-256 checksum ledger",
    "  - uses a PostgreSQL session advisory lock against concurrent deploys",
    "  - refuses checksum changes and database-ahead history conflicts (fail closed)",
    "",
    "Examples:",
    "  athena-js migrate",
    "  athena-js migrate --dry-run",
    "  athena-js migrate status",
    "  athena-js migrate plan",
    "  athena-js migrate repair --yes",
    "  athena-js migrate --config ./athena.config.ts",
  ].join("\n");
}

function migrateStatusUsage(): string {
  return [
    "athena-js migrate status",
    "",
    "Usage:",
    "  athena-js migrate status [--config <path>]",
    "",
    "Options:",
    "  --config <path>         Explicit path to athena.config.ts or athena-js.config.ts",
    "  -h, --help              Show help for migrate status",
    "",
    "Prints applied/pending/conflict rows from the local files + athena.schema_migrations ledger.",
    "Does not apply migrations.",
  ].join("\n");
}
function generateUsage(): string {
  return [
    "athena-js generate",
    "",
    "Usage:",
    "  athena-js generate [--config <path>] [--dry-run] [--no-write-config] [--no-discover-schemas]",
    "",
    "Options:",
    "  --config <path>         Explicit path to athena.config.ts or athena-js.config.ts",
    "  --dry-run               Build generated files in memory without writing them to disk and print mode/target hints",
    "  --no-write-config       Do not create/update athena.config.ts (env-only CI mode)",
    "  --no-discover-schemas   Skip live schema discovery; use only configured/env schemas",
    "  -h, --help              Show help for generate",
    "",
    "Config resolution:",
    "  - uses athena.config.* discovery first",
    "  - falls back to env-only direct mode when DATABASE_URL/PG_URL is present",
    "  - falls back to env-only gateway mode when ATHENA_URL + ATHENA_API_KEY are present",
    "  - by default creates/updates athena.config.ts intelligently (schemas auto-fill, no override when current)",
    "",
    "Examples:",
    "  athena-js generate",
    "  DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/app_db athena-js generate --dry-run",
    "  athena-js generate --config ./athena.config.ts --dry-run",
    "  athena-js generate --no-write-config",
  ].join("\n");
}

function initUsage(): string {
  return [
    "athena-js init",
    "",
    "Usage:",
    "  athena-js init [--config <path>] [--mode direct|gateway] [--force] [--dry-run] [--no-discover-schemas]",
    "",
    "Options:",
    "  --config <path>         Target path (default: athena.config.ts in cwd)",
    "  --mode direct|gateway   Force provider mode (default: auto from env)",
    "  --force                 Rewrite the full modern template even if a config already exists",
    "  --dry-run               Print the planned action without writing",
    "  --no-discover-schemas   Skip live schema discovery; keep public (or existing) schemas",
    "  -h, --help              Show help for init",
    "",
    "Behavior:",
    "  - missing file → write modern athena-direct config with generatorEnv-backed secrets",
    "  - existing file → only patch provider.schemas when discovery finds new schemas",
    "  - skips write when schemas already match (safe for typecheck / CI)",
    "  - gateway mode works fully via ATHENA_URL + ATHENA_API_KEY env fallbacks",
    "",
    "Examples:",
    "  athena-js init",
    "  athena-js init --mode gateway",
    "  athena-js init --dry-run",
    "  athena-js init --force",
  ].join("\n");
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

function isLegacyConfigRegistryTarget(target: string): boolean {
  const path = normalizePath(target);
  return (
    path === "athena/config.ts" ||
    path === "athena/registry.generated.ts" ||
    path.startsWith("athena/")
  );
}

function isFlatSchemaTarget(target: string): boolean {
  return normalizePath(target) === "athena/schema.ts";
}

function isCanonicalRegistryTarget(target: string): boolean {
  return (
    normalizePath(target) === "src/lib/athena/generated/registry.ts"
  );
}

function formatProviderLine(
  result: Awaited<ReturnType<typeof runSchemaGenerator>>
): string {
  const { provider } = result.config;
  if (provider.kind === "postgres") {
    const schemaList = Array.isArray(provider.schemas)
      ? provider.schemas.join(",")
      : typeof provider.schemas === "string"
        ? provider.schemas
        : "public";
    const database = provider.database ? ` database=${provider.database}` : "";
    const backend =
      provider.mode === "gateway" && provider.backend
        ? ` backend=${provider.backend}`
        : "";
    return `[provider] kind=${provider.kind} mode=${provider.mode}${database}${backend} schemas=${schemaList}`;
  }

  const datacenter = provider.datacenter
    ? ` datacenter=${provider.datacenter}`
    : "";
  return `[provider] kind=${provider.kind} mode=${provider.mode} keyspace=${provider.keyspace} contactPoints=${provider.contactPoints.join(",")}${datacenter}`;
}

function formatFilterLine(
  result: Awaited<ReturnType<typeof runSchemaGenerator>>
): string | undefined {
  const { includeTables, excludeTables } = result.config.filter;
  if (includeTables.length === 0 && excludeTables.length === 0) {
    return;
  }

  return `[filter] include=${includeTables.length > 0 ? includeTables.join(",") : "-"} exclude=${excludeTables.length > 0 ? excludeTables.join(",") : "-"}`;
}

function formatGeneratorModeLines(
  result: Awaited<ReturnType<typeof runSchemaGenerator>>
): string[] {
  const lines = [
    `[mode] preset=${result.config.output.preset} format=${result.config.output.format} modelTarget=${result.config.output.targets.model}`,
    formatProviderLine(result),
    `[targets] schema=${result.config.output.targets.schema} database=${result.config.output.targets.database} registry=${result.config.output.targets.registry}`,
  ];
  const filterLine = formatFilterLine(result);
  if (filterLine) {
    lines.push(filterLine);
  }

  if (result.config.output.format === "define-model") {
    lines.push(
      '[note] Legacy define-model compatibility output is active. Set output.format="table-builder" or ATHENA_GENERATOR_OUTPUT_FORMAT=table-builder to emit table(...).schema(...).columns(...).primaryKey(...).'
    );
  }

  if (result.config.output.preset === "legacy") {
    lines.push(
      '[note] Legacy (N-1) preset is active — root athena/* output. Prefer output.preset="athena-direct" for Architecture 4.0 src/lib/athena/generated/*.'
    );
  }

  lines.push(
    "[note] Default generator mode is preset=athena-direct + format=table-builder → src/lib/athena/generated/. findManyAst only affects runtime findMany(...) transport and does not enable generator table output."
  );

  if (
    isLegacyConfigRegistryTarget(result.config.output.targets.registry) &&
    !isCanonicalRegistryTarget(result.config.output.targets.registry)
  ) {
    lines.push(
      '[warn] Registry target is outside src/lib/athena/generated/registry.ts (N-1 layout). Prefer output.preset="athena-direct" or migrate with create-athena-app migrate --to 4.'
    );
  }

  if (isFlatSchemaTarget(result.config.output.targets.schema)) {
    lines.push(
      "[warn] Schema target points at athena/schema.ts. Prefer schema-scoped output under src/lib/athena/generated/schema/{schema_kebab}.ts."
    );
  }

  return lines;
}

export function usage(topic: HelpCommand["topic"] = "root"): string {
  if (topic === "generate") {
    return generateUsage();
  }
  if (topic === "init") {
    return initUsage();
  }
  if (topic === "migrate") {
    return migrateUsage();
  }
  if (topic === "migrate-status") {
    return migrateStatusUsage();
  }
  if (topic === "env") {
    return envUsage();
  }
  if (topic === "api-key") {
    return apiKeyUsage();
  }
  if (topic === "rights") {
    return rightsUsage();
  }
  if (topic === "version") {
    return versionUsage();
  }
  if (topic === "commands") {
    return commandsUsage();
  }
  return rootUsage();
}

function parseCsvList(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseGatewayAdminFlags(
  rest: string[],
  startIndex: number
): {
  adminKey?: string;
  index: number;
  json: boolean;
  consumed: Record<string, string | boolean | string[] | undefined>;
  url?: string;
} {
  let index = startIndex;
  let json = false;
  let url: string | undefined;
  let adminKey: string | undefined;
  const consumed: Record<string, string | boolean | string[] | undefined> = {};

  for (; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--url") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --url option.");
      }
      url = nextValue;
      index += 1;
      continue;
    }
    if (token === "--admin-key") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --admin-key option.");
      }
      adminKey = nextValue;
      index += 1;
      continue;
    }

    // Leave specialized flags to the caller by stopping at unknown tokens
    // only when caller wants — here we collect common + pass unknown via index.
    break;
  }

  consumed.json = json;
  consumed.url = url;
  consumed.adminKey = adminKey;
  return { adminKey, consumed, index, json, url };
}

function isVersionToken(token: string | undefined): boolean {
  return (
    token === "-v" ||
    token === "--version" ||
    token === "version" ||
    token === "v"
  );
}

function parseEnvCommand(rest: string[]): CliCommand {
  let mode: EnvCheckMode = "auto";
  let strict = false;
  let json = false;
  const files: string[] = [];

  // Allow bare `env`, `env check`, `env validate`
  let index = 0;
  if (rest[0] === "check" || rest[0] === "validate") {
    index = 1;
  } else if (rest[0] === "help") {
    return { command: "help", topic: "env" };
  }

  for (; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--help" || token === "-h") {
      return { command: "help", topic: "env" };
    }
    if (token === "--strict") {
      strict = true;
      continue;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--mode") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error(
          "Missing value for --mode option. Expected auto, direct, or gateway."
        );
      }
      if (
        nextValue !== "auto" &&
        nextValue !== "direct" &&
        nextValue !== "gateway"
      ) {
        throw new Error(
          `Invalid --mode value "${nextValue}". Expected auto, direct, or gateway.`
        );
      }
      mode = nextValue;
      index += 1;
      continue;
    }
    if (token === "--file" || token === "-f") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --file option.");
      }
      files.push(nextValue);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option "${token}".`);
  }

  return {
    command: "env",
    files,
    json,
    mode,
    strict,
  };
}

function parseApiKeyGenerateFlags(rest: string[], startIndex: number): CliCommand {
  let index = startIndex;
  let bytes = 32;
  let prefix = "ath_";
  let write = false;
  let force = false;
  let envFile: string | undefined;
  let envKey = "ATHENA_API_KEY";

  for (; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--help" || token === "-h") {
      return { command: "help", topic: "api-key" };
    }
    if (token === "--write") {
      write = true;
      continue;
    }
    if (token === "--force") {
      force = true;
      continue;
    }
    if (token === "--bytes") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --bytes option.");
      }
      const parsed = Number(nextValue);
      if (!Number.isInteger(parsed)) {
        throw new Error(`Invalid --bytes value "${nextValue}".`);
      }
      bytes = parsed;
      index += 1;
      continue;
    }
    if (token === "--prefix") {
      const nextValue = rest[index + 1];
      if (nextValue === undefined || nextValue.startsWith("-")) {
        if (nextValue === "") {
          prefix = "";
          index += 1;
          continue;
        }
        throw new Error("Missing value for --prefix option.");
      }
      prefix = nextValue;
      index += 1;
      continue;
    }
    if (token === "--env-file") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --env-file option.");
      }
      envFile = nextValue;
      write = true;
      index += 1;
      continue;
    }
    if (token === "--env-key") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --env-key option.");
      }
      envKey = nextValue;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option "${token}".`);
  }

  return {
    command: "api-key-generate",
    bytes,
    envFile,
    envKey,
    force,
    prefix,
    write,
  };
}

function parseApiKeyCreateFlags(rest: string[], startIndex: number): CliCommand {
  let index = startIndex;
  let name: string | undefined;
  let clientName: string | undefined;
  let description: string | undefined;
  let expiresAt: string | undefined;
  let rights: string[] = [];
  let write = false;
  let force = false;
  let envFile: string | undefined;
  let envKey = "ATHENA_API_KEY";
  let json = false;
  let url: string | undefined;
  let adminKey: string | undefined;

  for (; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--help" || token === "-h") {
      return { command: "help", topic: "api-key" };
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--write") {
      write = true;
      continue;
    }
    if (token === "--force") {
      force = true;
      continue;
    }
    if (token === "--name") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --name option.");
      }
      name = nextValue;
      index += 1;
      continue;
    }
    if (token === "--client-name") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --client-name option.");
      }
      clientName = nextValue;
      index += 1;
      continue;
    }
    if (token === "--description") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --description option.");
      }
      description = nextValue;
      index += 1;
      continue;
    }
    if (token === "--expires-at") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --expires-at option.");
      }
      expiresAt = nextValue;
      index += 1;
      continue;
    }
    if (token === "--rights") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --rights option.");
      }
      rights = parseCsvList(nextValue);
      index += 1;
      continue;
    }
    if (token === "--url") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --url option.");
      }
      url = nextValue;
      index += 1;
      continue;
    }
    if (token === "--admin-key") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --admin-key option.");
      }
      adminKey = nextValue;
      index += 1;
      continue;
    }
    if (token === "--env-file") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --env-file option.");
      }
      envFile = nextValue;
      write = true;
      index += 1;
      continue;
    }
    if (token === "--env-key") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --env-key option.");
      }
      envKey = nextValue;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option "${token}".`);
  }

  if (!name) {
    throw new Error(
      'api-key create requires --name <name>. Example: athena-js api-key create --name app --rights gateway.query'
    );
  }

  return {
    command: "api-key-create",
    adminKey,
    clientName,
    description,
    envFile,
    envKey,
    expiresAt,
    force,
    json,
    name,
    rights,
    url,
    write,
  };
}

function parseApiKeyListFlags(rest: string[], startIndex: number): CliCommand {
  const common = parseGatewayAdminFlags(rest, startIndex);
  let index = common.index;
  for (; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--help" || token === "-h") {
      return { command: "help", topic: "api-key" };
    }
    throw new Error(`Unknown option "${token}".`);
  }
  return {
    command: "api-key-list",
    adminKey: common.adminKey,
    json: common.json,
    url: common.url,
  };
}

function parseApiKeyCommand(rest: string[]): CliCommand {
  if (
    rest.length === 0 ||
    rest[0] === "help" ||
    rest[0] === "--help" ||
    rest[0] === "-h"
  ) {
    return { command: "help", topic: "api-key" };
  }

  const sub = rest[0];
  if (sub === "generate" || sub === "gen" || sub === "new") {
    return parseApiKeyGenerateFlags(rest, 1);
  }
  if (sub === "create") {
    return parseApiKeyCreateFlags(rest, 1);
  }
  if (sub === "list" || sub === "ls") {
    return parseApiKeyListFlags(rest, 1);
  }
  if (sub.startsWith("-")) {
    // `api-key --write` shorthand → local generate
    return parseApiKeyGenerateFlags(rest, 0);
  }

  throw new Error(
    `Unknown api-key subcommand "${sub}". Expected "generate", "create", or "list".`
  );
}

function parseRightsCommand(rest: string[]): CliCommand {
  if (
    rest.length === 0 ||
    rest[0] === "help" ||
    rest[0] === "--help" ||
    rest[0] === "-h"
  ) {
    return { command: "help", topic: "rights" };
  }

  const sub = rest[0];
  if (sub === "list" || sub === "ls") {
    const common = parseGatewayAdminFlags(rest, 1);
    let index = common.index;
    for (; index < rest.length; index += 1) {
      const token = rest[index];
      if (token === "--help" || token === "-h") {
        return { command: "help", topic: "rights" };
      }
      throw new Error(`Unknown option "${token}".`);
    }
    return {
      command: "rights-list",
      adminKey: common.adminKey,
      json: common.json,
      url: common.url,
    };
  }

  if (sub === "catalog" || sub === "all") {
    const common = parseGatewayAdminFlags(rest, 1);
    let index = common.index;
    for (; index < rest.length; index += 1) {
      const token = rest[index];
      if (token === "--help" || token === "-h") {
        return { command: "help", topic: "rights" };
      }
      throw new Error(`Unknown option "${token}".`);
    }
    return {
      command: "rights-catalog",
      adminKey: common.adminKey,
      json: common.json,
      url: common.url,
    };
  }

  if (sub === "create") {
    let index = 1;
    let name: string | undefined;
    let description: string | undefined;
    let json = false;
    let url: string | undefined;
    let adminKey: string | undefined;

    for (; index < rest.length; index += 1) {
      const token = rest[index];
      if (token === "--help" || token === "-h") {
        return { command: "help", topic: "rights" };
      }
      if (token === "--json") {
        json = true;
        continue;
      }
      if (token === "--name") {
        const nextValue = rest[index + 1];
        if (!nextValue || nextValue.startsWith("-")) {
          throw new Error("Missing value for --name option.");
        }
        name = nextValue;
        index += 1;
        continue;
      }
      if (token === "--description") {
        const nextValue = rest[index + 1];
        if (!nextValue || nextValue.startsWith("-")) {
          throw new Error("Missing value for --description option.");
        }
        description = nextValue;
        index += 1;
        continue;
      }
      if (token === "--url") {
        const nextValue = rest[index + 1];
        if (!nextValue || nextValue.startsWith("-")) {
          throw new Error("Missing value for --url option.");
        }
        url = nextValue;
        index += 1;
        continue;
      }
      if (token === "--admin-key") {
        const nextValue = rest[index + 1];
        if (!nextValue || nextValue.startsWith("-")) {
          throw new Error("Missing value for --admin-key option.");
        }
        adminKey = nextValue;
        index += 1;
        continue;
      }
      throw new Error(`Unknown option "${token}".`);
    }

    if (!name) {
      throw new Error(
        'rights create requires --name <right>. Example: athena-js rights create --name gateway.query'
      );
    }

    return {
      command: "rights-create",
      adminKey,
      description,
      json,
      name,
      url,
    };
  }

  throw new Error(
    `Unknown rights subcommand "${sub}". Expected "list", "catalog", or "create".`
  );
}

function parseMigrateCommand(rest: string[]): CliCommand {
  let configPath: string | undefined;
  let dryRun = false;
  let json = false;
  let plain = false;
  let yes = false;
  let mode: MigrateCommand["mode"] = "apply";

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--help" || token === "-h") {
      if (mode === "status") {
        return { command: "help", topic: "migrate-status" };
      }
      return { command: "help", topic: "migrate" };
    }

    if (token === "status") {
      if (mode !== "apply" || dryRun) {
        throw new Error(
          'Unexpected "status" subcommand placement. Use: athena-js migrate status'
        );
      }
      mode = "status";
      continue;
    }

    if (token === "plan") {
      if (mode !== "apply" || dryRun) {
        throw new Error(
          'Unexpected "plan" subcommand placement. Use: athena-js migrate plan'
        );
      }
      mode = "plan";
      continue;
    }

    if (token === "repair") {
      if (mode !== "apply" || dryRun) {
        throw new Error(
          'Unexpected "repair" subcommand placement. Use: athena-js migrate repair'
        );
      }
      mode = "repair";
      continue;
    }

    if (token === "--dry-run") {
      if (mode === "status" || mode === "plan") {
        throw new Error(
          `--dry-run cannot be combined with migrate ${mode}.`
        );
      }
      dryRun = true;
      if (mode !== "repair") {
        mode = "dry-run";
      }
      continue;
    }

    if (token === "--yes" || token === "-y") {
      yes = true;
      continue;
    }

    if (token === "--json") {
      json = true;
      continue;
    }

    if (token === "--plain" || token === "--no-color") {
      plain = true;
      continue;
    }

    if (token === "--config") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --config option.");
      }
      configPath = nextValue;
      index += 1;
      continue;
    }

    throw new Error(`Unknown option "${token}".`);
  }

  return {
    command: "migrate",
    configPath,
    dryRun: mode === "dry-run" || (mode === "repair" && dryRun),
    json,
    mode,
    plain,
    yes,
  };
}

export function parseCommand(argv: string[]): CliCommand {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { command: "help", topic: "root" };
  }

  // Global version flags / aliases anywhere as sole arg, or leading.
  if (isVersionToken(argv[0])) {
    if (argv[1] === "--help" || argv[1] === "-h") {
      return { command: "help", topic: "version" };
    }
    if (argv.length > 1 && argv[0] !== "-v" && argv[0] !== "--version") {
      // `version --short` style
      const short = argv.includes("--short") || argv.includes("-q");
      return { command: "version", short };
    }
    return {
      command: "version",
      short: argv.includes("--short") || argv.includes("-q"),
    };
  }

  // Full command inventory: --commands | -C | commands | list-commands | cmds
  if (isCommandsToken(argv[0])) {
    if (argv.includes("--help") || argv.includes("-h")) {
      return { command: "help", topic: "commands" };
    }
    return {
      command: "commands",
      format: parseCommandsFormat(argv.slice(1)),
    };
  }

  if (argv[0] === "help") {
    if (argv.length === 1) {
      return { command: "help", topic: "root" };
    }

    if (argv[1] === "generate") {
      return { command: "help", topic: "generate" };
    }

    if (argv[1] === "init") {
      return { command: "help", topic: "init" };
    }

    if (argv[1] === "migrate") {
      if (argv[2] === "status") {
        return { command: "help", topic: "migrate-status" };
      }
      return { command: "help", topic: "migrate" };
    }

    if (argv[1] === "env") {
      return { command: "help", topic: "env" };
    }

    if (argv[1] === "api-key" || argv[1] === "key") {
      return { command: "help", topic: "api-key" };
    }

    if (argv[1] === "rights") {
      return { command: "help", topic: "rights" };
    }

    if (argv[1] === "version" || argv[1] === "v") {
      return { command: "help", topic: "version" };
    }

    if (
      argv[1] === "commands" ||
      argv[1] === "list-commands" ||
      argv[1] === "cmds"
    ) {
      return { command: "help", topic: "commands" };
    }

    throw new Error(`Unknown command "${argv[1]}".`);
  }

  const [command, ...rest] = argv;

  if (command === "env") {
    return parseEnvCommand(rest);
  }

  if (command === "api-key" || command === "key") {
    return parseApiKeyCommand(rest);
  }

  if (command === "rights") {
    return parseRightsCommand(rest);
  }

  if (
    command !== "generate" &&
    command !== "init" &&
    command !== "migrate"
  ) {
    throw new Error(
      `Unknown command "${command}". Expected "generate", "init", "migrate", "env", "api-key", "rights", "version", or "commands".`
    );
  }

  if (command === "migrate") {
    return parseMigrateCommand(rest);
  }

  if (command === "init") {
    let configPath: string | undefined;
    let dryRun = false;
    let force = false;
    let mode: InitCommand["mode"] = "auto";
    let discoverSchemas = true;

    for (let index = 0; index < rest.length; index += 1) {
      const token = rest[index];
      if (token === "--help" || token === "-h") {
        return { command: "help", topic: "init" };
      }

      if (token === "--dry-run") {
        dryRun = true;
        continue;
      }

      if (token === "--force") {
        force = true;
        continue;
      }

      if (token === "--no-discover-schemas") {
        discoverSchemas = false;
        continue;
      }

      if (token === "--mode") {
        const nextValue = rest[index + 1];
        if (!nextValue || nextValue.startsWith("-")) {
          throw new Error(
            "Missing value for --mode option. Expected direct or gateway."
          );
        }
        if (
          nextValue !== "direct" &&
          nextValue !== "gateway" &&
          nextValue !== "auto"
        ) {
          throw new Error(
            `Invalid --mode value "${nextValue}". Expected direct, gateway, or auto.`
          );
        }
        mode = nextValue;
        index += 1;
        continue;
      }

      if (token === "--config") {
        const nextValue = rest[index + 1];
        if (!nextValue || nextValue.startsWith("-")) {
          throw new Error("Missing value for --config option.");
        }
        configPath = nextValue;
        index += 1;
        continue;
      }

      throw new Error(`Unknown option "${token}".`);
    }

    return {
      command: "init",
      configPath,
      discoverSchemas,
      dryRun,
      force,
      mode,
    };
  }

  let configPath: string | undefined;
  let dryRun = false;
  let writeConfig = true;
  let discoverSchemas = true;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--help" || token === "-h") {
      return { command: "help", topic: "generate" };
    }

    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (token === "--no-write-config") {
      writeConfig = false;
      continue;
    }

    if (token === "--write-config") {
      writeConfig = true;
      continue;
    }

    if (token === "--no-discover-schemas") {
      discoverSchemas = false;
      continue;
    }

    if (token === "--config") {
      const nextValue = rest[index + 1];
      if (!nextValue || nextValue.startsWith("-")) {
        throw new Error("Missing value for --config option.");
      }
      configPath = nextValue;
      index += 1;
      continue;
    }

    throw new Error(`Unknown option "${token}".`);
  }

  return {
    command: "generate",
    configPath,
    discoverSchemas,
    dryRun,
    writeConfig,
  };
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown generator error.";
}

function extractMissingDatabaseName(message: string): string | undefined {
  const match = message.match(/database "([^"]+)" does not exist/i);
  return match?.[1];
}

function isErrorWithCode(error: unknown): error is ErrorWithCode {
  return typeof error === "object" && error !== null && "code" in error;
}

function isNetworkConnectionError(error: unknown): boolean {
  if (!isErrorWithCode(error)) {
    return false;
  }
  const code = typeof error.code === "string" ? error.code : "";
  if (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "EPIPE" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH"
  ) {
    return true;
  }
  const message = normalizeErrorMessage(error).toLowerCase();
  return (
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("connection terminated") ||
    message.includes("connection refused") ||
    message.includes("timeout expired")
  );
}

function collectErrorDiagnostics(error: unknown): string[] {
  const lines: string[] = [];
  if (!(isErrorWithCode(error) || error instanceof Error)) {
    return lines;
  }

  const code =
    isErrorWithCode(error) && error.code !== undefined
      ? String(error.code)
      : undefined;
  if (code) {
    lines.push(`  code: ${code}`);
  }

  const errno =
    isErrorWithCode(error) && error.errno !== undefined
      ? String(error.errno)
      : undefined;
  if (errno) {
    lines.push(`  errno: ${errno}`);
  }

  const syscall =
    isErrorWithCode(error) && typeof error.syscall === "string"
      ? error.syscall
      : undefined;
  if (syscall) {
    lines.push(`  syscall: ${syscall}`);
  }

  const address =
    isErrorWithCode(error) && typeof error.address === "string"
      ? error.address
      : undefined;
  const port =
    isErrorWithCode(error) && error.port !== undefined
      ? String(error.port)
      : undefined;
  if (address || port) {
    lines.push(`  remote: ${address ?? "?"}${port ? `:${port}` : ""}`);
  }

  const hostname =
    isErrorWithCode(error) && typeof error.hostname === "string"
      ? error.hostname
      : undefined;
  if (hostname) {
    lines.push(`  hostname: ${hostname}`);
  }

  let cause: unknown =
    error instanceof Error
      ? error.cause
      : isErrorWithCode(error)
        ? error.cause
        : undefined;
  let depth = 0;
  while (cause && depth < 4) {
    const causeMessage = normalizeErrorMessage(cause);
    const causeCode =
      isErrorWithCode(cause) && cause.code !== undefined
        ? String(cause.code)
        : undefined;
    lines.push(
      `  cause[${depth}]: ${causeCode ? `${causeCode} — ` : ""}${causeMessage}`
    );
    cause =
      cause instanceof Error
        ? cause.cause
        : isErrorWithCode(cause)
          ? cause.cause
          : undefined;
    depth += 1;
  }

  return lines;
}

function formatGeneratorError(error: unknown, configPath?: string): Error {
  const diagnostics = collectErrorDiagnostics(error);
  const diagnosticsBlock =
    diagnostics.length > 0 ? ["", "Diagnostics:", ...diagnostics] : [];

  if (isErrorWithCode(error) && error.code === "3D000") {
    const message = normalizeErrorMessage(error);
    const databaseName = extractMissingDatabaseName(message);
    const databaseLabel = databaseName
      ? `PostgreSQL database "${databaseName}" does not exist`
      : "The target PostgreSQL database does not exist";
    const configLabel = configPath
      ? `config "${configPath}"`
      : "the resolved athena config";

    return new Error(
      [
        `${databaseLabel} (code 3D000).`,
        `Update provider.connectionString (and provider.database, if set) in ${configLabel}, or create that database before running generate.`,
        ...diagnosticsBlock,
        "",
        "Hint: ATHENA_JS_DEBUG=1 pnpm exec athena-js generate",
      ].join("\n")
    );
  }

  if (isNetworkConnectionError(error)) {
    const message = normalizeErrorMessage(error);
    const configLabel = configPath
      ? `config "${configPath}"`
      : "the resolved athena config";
    const code =
      isErrorWithCode(error) && typeof error.code === "string"
        ? error.code
        : "network";

    return new Error(
      [
        `Schema introspection failed: database connection was reset or unreachable (${code}: ${message}).`,
        `The CLI started correctly; generate could not finish talking to Postgres for ${configLabel}.`,
        ...diagnosticsBlock,
        "",
        "Check:",
        "  1. DATABASE_URL / provider.connectionString is reachable from this machine (VPN, Railway proxy, firewall).",
        '  2. The database is running and accepts connections (try `psql "$DATABASE_URL" -c "select 1"`).',
        "  3. SSL settings match the host (Railway/public proxy often needs `?sslmode=require`).",
        "  4. Retry once — ECONNRESET is often a transient proxy drop mid-introspection.",
        "",
        "For a full stack: ATHENA_JS_DEBUG=1 pnpm exec athena-js generate",
      ].join("\n")
    );
  }

  if (error instanceof Error) {
    if (diagnostics.length === 0 && !isDebugEnabled()) {
      return error;
    }
    const base = error.message || normalizeErrorMessage(error);
    return new Error(
      [
        base,
        ...diagnosticsBlock,
        ...(isDebugEnabled() && error.stack
          ? ["", "Stack:", error.stack]
          : ["", "Hint: ATHENA_JS_DEBUG=1 pnpm exec athena-js generate"]),
      ].join("\n")
    );
  }

  return new Error(normalizeErrorMessage(error));
}

/**
 * Print a CLI error to stderr with optional stack when `ATHENA_JS_DEBUG=1`.
 */
export function logCliError(
  error: unknown,
  errorLog: (message: string) => void = console.error
): void {
  const message =
    error instanceof Error ? error.message : normalizeErrorMessage(error);
  errorLog(message);

  if (isDebugEnabled() && error instanceof Error && error.stack) {
    // Avoid duplicating the message line already printed above.
    const stackOnly = error.stack.startsWith(error.message)
      ? error.stack.slice(error.message.length).replace(/^\n/, "")
      : error.stack;
    if (stackOnly) {
      errorLog(stackOnly);
    }
  }
}

function formatSkippedArtifactLine(
  artifact: Awaited<
    ReturnType<typeof runSchemaGenerator>
  >["skippedFiles"][number]
): string {
  if (artifact.reason === "protected-existing-file") {
    return ` [skip] ${artifact.path} (existing ${artifact.kind} artifacts are protected from overwrite; set output.artifactWrite.${artifact.kind}="merge"|"overwrite" or delete/retarget the file)`;
  }

  if (artifact.reason === "already-current") {
    const custom =
      artifact.preservedCustom && artifact.preservedCustom.length > 0
        ? `; preserves ${artifact.preservedCustom.length} non-generated unit(s)`
        : "";
    return ` [ok] ${artifact.path} (already current${custom})`;
  }

  if (artifact.reason === "merge-conflict") {
    return ` [skip] ${artifact.path} (merge conflict: ${artifact.detail ?? "see conflicts"}; file left unchanged)`;
  }

  if (artifact.reason === "merge-lint-failed") {
    return ` [skip] ${artifact.path} (merge lint failed: ${artifact.detail ?? "invalid merged TypeScript"}; file left unchanged)`;
  }

  if (artifact.reason === "merge-unparseable") {
    return ` [skip] ${artifact.path} (existing ${artifact.kind} artifact is not mergeable; delete, retarget, or set output.artifactWrite.${artifact.kind}="overwrite")`;
  }

  return ` [skip] ${artifact.path}`;
}

function formatWrittenArtifactLine(
  artifact: Awaited<
    ReturnType<typeof runSchemaGenerator>
  >["writtenDetails"][number]
): string {
  if (artifact.reason === "merged") {
    const added =
      artifact.added && artifact.added.length > 0
        ? ` +${artifact.added.length}: ${artifact.added.slice(0, 4).join(", ")}${artifact.added.length > 4 ? "…" : ""}`
        : "";
    const custom =
      artifact.preservedCustom && artifact.preservedCustom.length > 0
        ? `; preserves ${artifact.preservedCustom.length} non-generated unit(s)`
        : "";
    return ` [merge] ${artifact.path}${added}${custom}`;
  }

  if (artifact.reason === "overwritten") {
    return ` [write] ${artifact.path} (overwritten)`;
  }

  return ` - ${artifact.path}`;
}

function formatCustomPreserveWarnings(
  result: Awaited<ReturnType<typeof runSchemaGenerator>>
): string[] {
  const lines: string[] = [];
  for (const artifact of result.writtenDetails) {
    if (artifact.preservedCustom && artifact.preservedCustom.length > 0) {
      lines.push(
        ` [warn] ${artifact.path} preserves non-generated unit(s): ${artifact.preservedCustom.slice(0, 3).join("; ")}${artifact.preservedCustom.length > 3 ? "…" : ""}`
      );
    }
  }
  for (const artifact of result.skippedFiles) {
    if (
      artifact.reason === "already-current" &&
      artifact.preservedCustom &&
      artifact.preservedCustom.length > 0
    ) {
      lines.push(
        ` [warn] ${artifact.path} preserves non-generated unit(s): ${artifact.preservedCustom.slice(0, 3).join("; ")}${artifact.preservedCustom.length > 3 ? "…" : ""}`
      );
    }
  }
  return lines;
}

/**
 * CLI entrypoint used by `bin/athena-js.js`.
 *
 * Generator failures are logged with diagnostics (code, remote, cause chain)
 * and exit with code `1` instead of only throwing a bare message.
 */
function formatConfigEnsureLines(
  result: Awaited<ReturnType<typeof runSchemaGenerator>>
): string[] {
  if (!result.configEnsure) {
    return [];
  }

  const { action, path, schemas, reason, changes } = result.configEnsure;
  const lines = [
    `[config] ${action} ${path} schemas=${schemas.join(",") || "-"}`,
  ];
  if (reason) {
    lines.push(`[config] reason: ${reason}`);
  }
  if (changes.length > 0 && action !== "unchanged") {
    lines.push(
      `[config] changes: ${changes.slice(0, 4).join("; ")}${changes.length > 4 ? "…" : ""}`
    );
  }
  return lines;
}

export async function runCLI(
  argv: string[],
  runtime: CliRuntime = {}
): Promise<void> {
  const log = runtime.log ?? console.log;
  const errorLog = runtime.errorLog ?? console.error;
  const runGenerator = runtime.runGenerator ?? runSchemaGenerator;
  const ensureConfig = runtime.ensureConfig ?? ensureGeneratorConfigFile;
  const runMigrate = runtime.runMigrations ?? runMigrations;

  let parsed: CliCommand;
  try {
    parsed = parseCommand(argv);
  } catch (error) {
    logCliError(formatGeneratorError(error), errorLog);
    setCliExitCode(1);
    return;
  }

  if (parsed.command === "help") {
    log(usage(parsed.topic));
    return;
  }

  if (parsed.command === "version") {
    if (parsed.short) {
      log(PACKAGE_VERSION);
    } else {
      log(`@xylex-group/athena ${PACKAGE_VERSION}`);
    }
    return;
  }

  if (parsed.command === "commands") {
    log(formatCommandsCatalog({ format: parsed.format }));
    return;
  }

  if (parsed.command === "env") {
    try {
      const result = validateProjectEnv({
        cwd: runtime.cwd,
        files: parsed.files.length > 0 ? parsed.files : undefined,
        mode: parsed.mode,
        strict: parsed.strict,
      });
      if (parsed.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        log(formatEnvCheckReport(result));
      }
      if (result.errorCount > 0) {
        setCliExitCode(1);
      }
    } catch (error) {
      logCliError(formatGeneratorError(error), errorLog);
      setCliExitCode(1);
    }
    return;
  }

  if (parsed.command === "api-key-generate") {
    try {
      const generated = generateApiKey({
        bytes: parsed.bytes,
        prefix: parsed.prefix,
      });
      if (parsed.write) {
        const written = writeApiKeyToEnvFile({
          cwd: runtime.cwd,
          envKey: parsed.envKey,
          filePath: parsed.envFile,
          force: parsed.force,
          key: generated.key,
        });
        log(
          `API key ${written.action} in ${written.absolutePath} (${written.envKey})`
        );
        log(
          "Store this secret securely. It will not be shown again if you only keep the file."
        );
      } else {
        log(generated.key);
        log(
          "Tip: athena-js api-key generate --write  # saves to .env.local as ATHENA_API_KEY"
        );
      }
    } catch (error) {
      logCliError(formatGeneratorError(error), errorLog);
      setCliExitCode(1);
    }
    return;
  }

  if (
    parsed.command === "api-key-list" ||
    parsed.command === "api-key-create" ||
    parsed.command === "rights-list" ||
    parsed.command === "rights-catalog" ||
    parsed.command === "rights-create"
  ) {
    try {
      const credentials = resolveGatewayAdminCredentials({
        adminKey: parsed.adminKey,
        baseUrl: parsed.url,
        cwd: runtime.cwd,
      });
      const clientOptions = {
        ...credentials,
        fetchImpl: runtime.fetchImpl,
      };

      if (parsed.command === "api-key-list") {
        const records = await listGatewayApiKeys(clientOptions);
        if (parsed.json) {
          log(JSON.stringify({ api_keys: records }, null, 2));
        } else {
          log(
            `[admin] url=${credentials.urlSource} key=${credentials.adminKeySource}`
          );
          log(formatApiKeyRecords(records));
        }
        return;
      }

      if (parsed.command === "api-key-create") {
        const created = await createGatewayApiKey({
          ...clientOptions,
          input: {
            client_name: parsed.clientName,
            description: parsed.description,
            expires_at: parsed.expiresAt,
            name: parsed.name,
            rights: parsed.rights,
          },
        });
        if (parsed.write && created.api_key) {
          const written = writeApiKeyToEnvFile({
            cwd: runtime.cwd,
            envKey: parsed.envKey,
            filePath: parsed.envFile,
            force: parsed.force,
            key: created.api_key,
          });
          if (parsed.json) {
            log(
              JSON.stringify(
                {
                  ...created,
                  envWrite: written,
                },
                null,
                2
              )
            );
          } else {
            log(formatCreatedApiKey(created));
            log(
              `Saved plaintext to ${written.absolutePath} as ${written.envKey} (${written.action})`
            );
          }
        } else if (parsed.json) {
          log(JSON.stringify(created, null, 2));
        } else {
          log(formatCreatedApiKey(created));
          if (parsed.write && !created.api_key) {
            log(
              "Warning: response had no plaintext api_key; nothing written to env file."
            );
          }
        }
        return;
      }

      if (parsed.command === "rights-list") {
        const rights = await listGatewayApiKeyRights(clientOptions);
        if (parsed.json) {
          log(JSON.stringify({ rights }, null, 2));
        } else {
          log(
            `[admin] url=${credentials.urlSource} key=${credentials.adminKeySource}`
          );
          log(formatApiKeyRights(rights));
        }
        return;
      }

      if (parsed.command === "rights-catalog") {
        const catalog = await listGatewayRightsCatalog(clientOptions);
        if (parsed.json) {
          log(JSON.stringify(catalog, null, 2));
        } else {
          log(
            `[admin] url=${credentials.urlSource} key=${credentials.adminKeySource}`
          );
          log(formatRightsCatalog(catalog));
        }
        return;
      }

      if (parsed.command === "rights-create") {
        const right = await createGatewayApiKeyRight({
          ...clientOptions,
          input: {
            description: parsed.description,
            name: parsed.name,
          },
        });
        if (parsed.json) {
          log(JSON.stringify({ right }, null, 2));
        } else {
          log(
            `Created API key right name=${right.name}${right.id ? ` id=${right.id}` : ""}`
          );
          if (right.description) {
            log(`description: ${right.description}`);
          }
        }
      }
    } catch (error) {
      logCliError(formatGeneratorError(error), errorLog);
      setCliExitCode(1);
    }
    return;
  }

  if (parsed.command === "migrate") {
    try {
      if (isDebugEnabled()) {
        errorLog(
          `[athena-js] migrate starting (mode=${parsed.mode} dryRun=${parsed.dryRun}${parsed.configPath ? ` config=${parsed.configPath}` : ""})`
        );
      }
      await runMigrate({
        configPath: parsed.configPath,
        dryRun: parsed.dryRun || parsed.mode === "dry-run",
        json: parsed.json,
        log,
        mode:
          parsed.mode === "dry-run"
            ? "dry-run"
            : parsed.mode === "status"
              ? "status"
              : parsed.mode === "plan"
                ? "plan"
                : parsed.mode === "repair"
                  ? "repair"
                  : "apply",
        plain: parsed.plain,
        yes: parsed.yes,
      });
    } catch (error) {
      if (error instanceof MigrationError) {
        logCliError(error, errorLog);
      } else {
        logCliError(formatGeneratorError(error, parsed.configPath), errorLog);
      }
      setCliExitCode(1);
    }
    return;
  }

  if (parsed.command === "init") {
    try {
      if (isDebugEnabled()) {
        errorLog(
          `[athena-js] init starting (dryRun=${parsed.dryRun} force=${parsed.force} mode=${parsed.mode}${parsed.configPath ? ` config=${parsed.configPath}` : ""})`
        );
      }
      const result = await ensureConfig({
        configPath: parsed.configPath,
        discoverSchemas: parsed.discoverSchemas,
        dryRun: parsed.dryRun,
        force: parsed.force,
        mode: parsed.mode,
      });
      const prefix = parsed.dryRun ? "[dry-run] " : "";
      const provenance = result.schemaProvenance ?? "configured";
      log(
        `${prefix}Config ${result.action}: ${result.path} (mode=${result.mode} schemas=${result.schemas.join(",") || "-"} provenance=${provenance})`
      );
      if (result.reason) {
        log(`${prefix}reason: ${result.reason}`);
      }
      for (const change of result.changes) {
        // Fallback messages are multi-line prose; print without a leading dash.
        if (provenance === "fallback" && !change.startsWith("created-") && !change.startsWith("force-")) {
          log(`${prefix}${change}`);
        } else {
          log(`${prefix}- ${change}`);
        }
      }
      if (parsed.dryRun && result.content && result.action !== "unchanged") {
        log(`${prefix}--- planned content ---`);
        log(result.content);
      }
    } catch (error) {
      const formatted = formatGeneratorError(error, parsed.configPath);
      logCliError(formatted, errorLog);
      setCliExitCode(1);
    }
    return;
  }

  let result: Awaited<ReturnType<typeof runSchemaGenerator>>;
  try {
    if (isDebugEnabled()) {
      errorLog(
        `[athena-js] generate starting (dryRun=${parsed.dryRun} writeConfig=${parsed.writeConfig} discoverSchemas=${parsed.discoverSchemas}${parsed.configPath ? ` config=${parsed.configPath}` : ""})`
      );
    }
    result = await runGenerator({
      configPath: parsed.configPath,
      discoverSchemas: parsed.discoverSchemas,
      dryRun: parsed.dryRun,
      writeConfig: parsed.writeConfig,
    });
  } catch (error) {
    const formatted = formatGeneratorError(error, parsed.configPath);
    logCliError(formatted, errorLog);
    setCliExitCode(1);
    return;
  }

  if (parsed.dryRun) {
    log(
      `[dry-run] Generated ${result.files.length} files from ${result.configPath}`
    );
    for (const line of formatGeneratorModeLines(result)) {
      log(line);
    }
    for (const line of formatConfigEnsureLines(result)) {
      log(line);
    }
    for (const file of result.files) {
      log(` - ${file.path}`);
    }
    // When the real generator ran, also surface planned merge/skip outcomes.
    if (result.writtenDetails?.length || result.skippedFiles?.length) {
      for (const artifact of result.writtenDetails ?? []) {
        if (artifact.kind === "database" || artifact.kind === "registry") {
          log(formatWrittenArtifactLine(artifact));
        }
      }
      for (const artifact of result.skippedFiles ?? []) {
        if (artifact.kind === "database" || artifact.kind === "registry") {
          log(formatSkippedArtifactLine(artifact));
        }
      }
      for (const line of formatCustomPreserveWarnings(result)) {
        log(line);
      }
    }
    return;
  }

  log(
    `Generated ${result.writtenFiles.length} files from ${result.configPath}`
  );
  for (const line of formatGeneratorModeLines(result)) {
    log(line);
  }
  for (const line of formatConfigEnsureLines(result)) {
    log(line);
  }
  const detailByPath = new Map(
    (result.writtenDetails ?? []).map(
      (detail) => [detail.path, detail] as const
    )
  );
  for (const filePath of result.writtenFiles) {
    const detail = detailByPath.get(filePath);
    if (
      detail &&
      (detail.reason === "merged" || detail.reason === "overwritten")
    ) {
      log(formatWrittenArtifactLine(detail));
    } else {
      log(` - ${filePath}`);
    }
  }
  for (const artifact of result.skippedFiles) {
    log(formatSkippedArtifactLine(artifact));
  }
  for (const line of formatCustomPreserveWarnings(result)) {
    log(line);
  }
}
