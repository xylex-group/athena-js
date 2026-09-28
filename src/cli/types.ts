import type { BillingImportRunReport } from "../billing/import/types.ts";
import type { ensureGeneratorConfigFile } from "../generator/config-file.ts";
import type { runSchemaGenerator } from "../generator/pipeline.ts";
import type {
  LocalPostgresRuntime,
  LocalPostgresRuntimeOptions,
} from "../local/runtime.ts";
import type { runMigrations } from "../migrations/runner.ts";
import type { MigrationCommandMode } from "../migrations/types.ts";
import type { runMigrationVerify } from "../migrations/verify.ts";
import type { AthenaSchemaSnapshot } from "../schema/diff/index.ts";
import type { AuthStatusFacts } from "./commands/auth/status-report.ts";
import type { runCliDoctor } from "./commands/doctor/doctor.ts";
import type { EnvCheckMode } from "./commands/env/project-env.ts";
import type { InitMode } from "./commands/init/modes.ts";
import type { validateLocalRuntime } from "./commands/validate/validate-local.ts";
import type {
  CatalogHelpTopic,
  CommandsListFormat,
} from "./commands-catalog.ts";
import type { AthenaCliLogger } from "./logging/types.ts";

export interface GenerateCommand {
  command: "generate";
  check: boolean;
  configPath?: string;
  /** When false, skip live schema discovery. Default true. */
  discoverSchemas: boolean;
  dryRun: boolean;
  strict: boolean;
  /** When false, never write/update athena.config.ts. Default true. */
  writeConfig: boolean;
}

export interface InitCommand {
  command: "init";
  configPath?: string;
  discoverSchemas: boolean;
  dryRun: boolean;
  force: boolean;
  mode: InitMode;
}

export interface MigrateCommand {
  allowDirty?: boolean;
  applyReconcile?: boolean;
  command: "migrate";
  configPath?: string;
  dryRun: boolean;
  explainTarget?: string;
  json?: boolean;
  mode: MigrationCommandMode;
  plain?: boolean;
  strict?: boolean;
  yes?: boolean;
}

export interface MigrateAuthSyncCommand {
  command: "migrate-auth-sync";
  configPath?: string;
  dryRun: boolean;
  json?: boolean;
  plain?: boolean;
}

export interface HelpCommand {
  command: "help";
  topic: CatalogHelpTopic;
}

export interface VersionCommand {
  command: "version";
  /** When true, print only the semver (no package name prefix). */
  short: boolean;
}

export interface CommandsCommand {
  command: "commands";
  format: CommandsListFormat;
}

export interface EnvCommand {
  command: "env";
  /** Env files to inspect (relative or absolute). Empty = default project load order. */
  files: string[];
  json: boolean;
  mode: EnvCheckMode;
  strict: boolean;
}

export interface ValidateCommand {
  command: "validate";
  configPath?: string;
  json: boolean;
  plain: boolean;
  strict: boolean;
}

export interface DoctorCommand {
  command: "doctor";
  configPath?: string;
  json: boolean;
  plain: boolean;
  skipRuntime: boolean;
  strict: boolean;
}

export interface DoctorBundleCommand {
  command: "doctor-bundle";
  includeLatestLog: boolean;
  invocation?: string;
  json: boolean;
  outDir?: string;
}

export interface LogsCommand {
  action: "path" | "list" | "latest" | "show" | "export" | "prune";
  command: "logs";
  errors: boolean;
  invocationId?: string;
  json: boolean;
  limit: number;
  olderThan?: string;
  outPath?: string;
}

export interface DbCommand {
  action: "start" | "stop" | "status" | "restart" | "reset" | "logs";
  command: "db";
  configPath?: string;
  force: boolean;
  json: boolean;
  writeEnv: boolean;
  yes: boolean;
}

export interface SchemaCommand {
  command: "schema";
}

export interface SchemaDiffCommand {
  command: "schema-diff";
  configPath?: string;
  fromPath?: string;
  json: boolean;
  migration: boolean;
  policyImpact?: boolean;
}

export interface SchemaSnapshotCommand {
  check: boolean;
  command: "schema-snapshot";
  configPath?: string;
  json: boolean;
  outPath?: string;
}

export interface AuthCommand {
  command: "auth";
}

export interface AuthStatusCommand {
  command: "auth-status";
  json: boolean;
}

export interface AuthDoctorCommand {
  command: "auth-doctor";
  json: boolean;
  strict: boolean;
}

export interface AuthCapabilitiesCommand {
  command: "auth-capabilities";
  json: boolean;
}

export interface AuthAuditCommand {
  action: "list" | "show";
  command: "auth-audit";
  errors: boolean;
  json: boolean;
  limit: number;
  target?: string;
}

export interface AuthTracesCommand {
  action: "list" | "show";
  command: "auth-traces";
  errors: boolean;
  json: boolean;
  limit: number;
  target?: string;
}

export interface AuthAuditRow {
  actor?: string;
  at: string;
  event: string;
  id?: string;
}

export interface AuthTraceRow {
  method: string;
  path: string;
  statusCode?: number;
  totalMs?: number;
  traceId?: string;
}

export interface GatewayAdminFlags {
  adminKey?: string;
  json: boolean;
  url?: string;
}

export interface ApiKeyGenerateCommand {
  bytes: number;
  command: "api-key-generate";
  /** When set, write the key into this env file (default `.env.local` if --write). */
  envFile?: string;
  /** Env variable to write. Default `ATHENA_KEY_12` (not `ATHENA_API_KEY`). */
  envKey: string;
  force: boolean;
  prefix: string;
  write: boolean;
}

export interface ApiKeyListCommand extends GatewayAdminFlags {
  command: "api-key-list";
}

export interface ApiKeyCreateCommand extends GatewayAdminFlags {
  clientName?: string;
  command: "api-key-create";
  description?: string;
  envFile?: string;
  envKey: string;
  expiresAt?: string;
  force: boolean;
  name: string;
  rights: string[];
  write: boolean;
}

export interface RightsListCommand extends GatewayAdminFlags {
  command: "rights-list";
}

export interface RightsCatalogCommand extends GatewayAdminFlags {
  command: "rights-catalog";
}

export interface RightsCreateCommand extends GatewayAdminFlags {
  command: "rights-create";
  description?: string;
  name: string;
}

export interface PolicyDxCommand {
  action?: string;
  command:
    | "policy"
    | "policy-list"
    | "policy-show"
    | "policy-validate"
    | "policy-lint"
    | "policy-coverage"
    | "policy-explain"
    | "policy-simulate"
    | "policy-fingerprint"
    | "policy-export";
  configPath?: string;
  format?: "ir";
  id?: string;
  json?: boolean;
  resource?: string;
  row?: string;
}

export interface BillingReconcileSubjectsCommand {
  apply: boolean;
  command: "billing-reconcile-subjects";
  configPath?: string;
  connectionId?: string;
  cursor?: string;
  customerId?: string;
  dryRun: boolean;
  includeAmbiguous: boolean;
  json: boolean;
  limit?: number;
  maxCustomers?: number;
  maxDurationMs?: number;
  maxPages?: number;
  provider?: string;
  subjectId?: string;
}

export interface BillingWebhooksCommand {
  action: "reconcile" | "status" | "verify";
  command: "billing-webhooks";
  configPath?: string;
  connectionId?: string;
  dryRun: boolean;
  json: boolean;
  provider?: string;
}

export interface BillingIngressReplayCommand {
  classifyOnly: boolean;
  command: "billing-ingress-replay";
  configPath?: string;
  dryRun: boolean;
  json: boolean;
  limit?: number;
}

export type CliCommand =
  | GenerateCommand
  | InitCommand
  | MigrateCommand
  | MigrateAuthSyncCommand
  | HelpCommand
  | VersionCommand
  | CommandsCommand
  | EnvCommand
  | ValidateCommand
  | DoctorCommand
  | DoctorBundleCommand
  | LogsCommand
  | DbCommand
  | SchemaCommand
  | SchemaDiffCommand
  | SchemaSnapshotCommand
  | AuthCommand
  | AuthStatusCommand
  | AuthDoctorCommand
  | AuthCapabilitiesCommand
  | AuthAuditCommand
  | AuthTracesCommand
  | ApiKeyGenerateCommand
  | ApiKeyListCommand
  | ApiKeyCreateCommand
  | RightsListCommand
  | RightsCatalogCommand
  | RightsCreateCommand
  | PolicyDxCommand
  | BillingReconcileSubjectsCommand
  | BillingWebhooksCommand
  | BillingIngressReplayCommand;

export interface CliRuntime {
  /** Override cwd for env / api-key file operations (tests). */
  cwd?: string;
  ensureConfig?: typeof ensureGeneratorConfigFile;
  env?: Record<string, string | undefined>;
  /** Defaults to `console.error`. */
  errorLog?: (message: string) => void;
  /** Inject fetch for gateway admin commands (tests). */
  fetchImpl?: typeof fetch;
  /** Override the local PostgreSQL runtime for command tests. */
  createLocalRuntime?: (
    options: LocalPostgresRuntimeOptions
  ) => LocalPostgresRuntime;
  inspectAuthStatus?: (options: { cwd?: string }) => Promise<AuthStatusFacts>;
  inspectSchemaSnapshot?: () => Promise<AthenaSchemaSnapshot>;
  /** Override stdout TTY detection (tests). Injected `log` defaults to non-TTY. */
  isTty?: boolean;
  log?: (message: string) => void;
  /** Reuse a launcher-owned invocation logger. */
  logger?: AthenaCliLogger;
  queryAuthAudit?: (options: {
    action: "list" | "show";
    configPath?: string;
    cwd?: string;
    limit: number;
    target?: string;
  }) => Promise<AuthAuditRow[]>;
  queryAuthTraces?: (options: {
    action: "list" | "show";
    configPath?: string;
    cwd?: string;
    errorsOnly: boolean;
    limit: number;
    target?: string;
  }) => Promise<AuthTraceRow[]>;
  runBillingReconcileSubjects?: (input: {
    cwd: string;
    parsed: BillingReconcileSubjectsCommand;
  }) => Promise<BillingImportRunReport>;
  runCliDoctor?: typeof runCliDoctor;
  runGenerator?: typeof runSchemaGenerator;
  runMigrations?: typeof runMigrations;
  runMigrationVerify?: typeof runMigrationVerify;
  /** Alias accepted by programmatic callers that call the logger a session. */
  session?: AthenaCliLogger;
  validateLocal?: typeof validateLocalRuntime;
}

export interface CliRunSummary {
  commandId?: string;
  exitCode: number;
  loggingFailed: boolean;
  logPath?: string;
  outcome: "success" | "failure" | "cancelled";
}
