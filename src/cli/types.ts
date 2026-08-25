import type { ensureGeneratorConfigFile } from "../generator/config-file.ts";
import type { runSchemaGenerator } from "../generator/pipeline.ts";
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

export interface GenerateCommand {
	command: "generate";
	configPath?: string;
	/** When false, skip live schema discovery. Default true. */
	discoverSchemas: boolean;
	dryRun: boolean;
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
	command: "migrate";
	configPath?: string;
	dryRun: boolean;
	explainTarget?: string;
	json?: boolean;
	mode: MigrationCommandMode;
	plain?: boolean;
	strict?: boolean;
	allowDirty?: boolean;
	applyReconcile?: boolean;
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
	json: boolean;
	outDir?: string;
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
	command: "schema-snapshot";
	check: boolean;
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
	command: "api-key-generate";
	bytes: number;
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
	| PolicyDxCommand;

export interface CliRuntime {
	ensureConfig?: typeof ensureGeneratorConfigFile;
	/** Defaults to `console.error`. */
	errorLog?: (message: string) => void;
	/** Inject fetch for gateway admin commands (tests). */
	fetchImpl?: typeof fetch;
	log?: (message: string) => void;
	runGenerator?: typeof runSchemaGenerator;
	runMigrations?: typeof runMigrations;
	validateLocal?: typeof validateLocalRuntime;
	runCliDoctor?: typeof runCliDoctor;
	inspectSchemaSnapshot?: () => Promise<AthenaSchemaSnapshot>;
	runMigrationVerify?: typeof runMigrationVerify;
	inspectAuthStatus?: (options: { cwd?: string }) => Promise<AuthStatusFacts>;
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
	/** Override cwd for env / api-key file operations (tests). */
	cwd?: string;
	/** Override stdout TTY detection (tests). Injected `log` defaults to non-TTY. */
	isTty?: boolean;
}
