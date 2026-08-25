import type { CliCatalogFlag, CliCommandEntry } from "../../commands-catalog.ts";

const migrateApplyFlags = [
	"--config <path>",
	"--dry-run",
	"--allow-dirty-migrations",
	"--json",
	"--plain",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

const migrateStatusFlags = [
	"--config <path>",
	"--json",
	"--plain",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

const migrateJsonFlags = [
	"--config <path>",
	"--json",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

const migrateCheckFlags = [
	"--config <path>",
	"--strict",
	"--json",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

const migrateReconcileFlags = [
	"--config <path>",
	"--apply",
	"--yes",
	"--json",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

const migrateVerifyFlags = [
	"--config <path>",
	"--json",
	"--strict",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

const migrateRepairFlags = [
	"--config <path>",
	"--yes",
	"--dry-run",
	"--json",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

export const migrateCatalog: readonly CliCommandEntry[] = [
	{
		command: "migrate",
		description: "Apply pending SQL migrations (direct Postgres)",
		flags: migrateApplyFlags,
		group: "migrations",
		helpTopic: "migrate",
		notes: [
			"Requires provider.kind=postgres and provider.mode=direct.",
			"Preflights the pending batch against the physical catalog, then applies each file under a PostgreSQL session advisory lock.",
			"Use migrate check for static analysis; migrate reconcile [--apply] for ledger vs physical metadata.",
			"Fails closed on uncommitted files unless --allow-dirty-migrations --yes.",
		],
		examples: [
			"athena-js migrate",
			"athena-js migrate --dry-run",
			"athena-js migrate status",
			"athena-js migrate check --strict",
			"athena-js migrate reconcile",
			"athena-js migrate reconcile --apply --yes",
			"athena-js migrate --allow-dirty-migrations --yes",
			"athena-js migrate repair --yes",
			"athena-js migrate auth sync",
		],
	},
	{
		command: "migrate status",
		description: "Show applied/pending/conflict migration rows",
		flags: migrateStatusFlags,
		group: "migrations",
		helpTopic: "migrate-status",
		notes: [
			"Prints applied, pending, and conflict rows from local SQL plus the athena.schema_migrations ledger.",
			"Does not apply migrations. Use --plain for unstyled output, --json for machines.",
		],
	},
	{
		command: "migrate plan",
		description: "Compiler report: graph, pending, physical drift",
		flags: migrateJsonFlags,
		group: "migrations",
		helpTopic: "migrate",
	},
	{
		command: "migrate check",
		description: "Static analysis + physical verification (zero mutations)",
		flags: migrateCheckFlags,
		group: "migrations",
		helpTopic: "migrate",
	},
	{
		command: "migrate graph",
		description: "Print object dependency graph",
		flags: migrateJsonFlags,
		group: "migrations",
		helpTopic: "migrate",
	},
	{
		command: "migrate explain",
		description: "Explain one migration's creates/reads/deps",
		flags: migrateJsonFlags,
		group: "migrations",
		helpTopic: "migrate",
		notes: [
			"Requires a version or filename argument.",
			"athena-js migrate explain with no target prints migrate help; it does not explain a missing version as (missing).",
		],
		examples: [
			"athena-js migrate explain 0007",
			"athena-js migrate explain 0007_add_indexes.sql",
		],
	},
	{
		command: "migrate drift",
		description: "Ledger vs projected vs physical schema",
		flags: migrateJsonFlags,
		group: "migrations",
		helpTopic: "migrate",
	},
	{
		command: "migrate reconcile",
		description:
			"Three-way diagnose repository vs ledger vs physical schema (no SQL)",
		flags: migrateReconcileFlags,
		group: "migrations",
		helpTopic: "migrate",
	},
	{
		command: "migrate verify",
		description:
			"Deployment readiness: ledgers, drift, dirty worktree, Auth generation",
		flags: migrateVerifyFlags,
		group: "migrations",
		helpTopic: "migrate",
		notes: [
			"Read-only. Does not apply SQL. Exit 6 when the revision is not safe to deploy.",
		],
	},
	{
		command: "migrate repair",
		description: "Repair Auth schema drift (inspect/restore app objects separately)",
		flags: migrateRepairFlags,
		group: "migrations",
		helpTopic: "migrate",
	},
	{
		command: "migrate auth sync",
		aliases: ["migrate auth materialize", "migrate auth"],
		description:
			"Rematerialize package-owned Embedded Auth SQL under athena/managed/auth/migrations",
		flags: ["--config <path>", "--dry-run", "--json", "--plain", "-h"],
		group: "migrations",
		helpTopic: "migrate",
		notes: [
			"Local files are a read-only inspection view. Runtime apply never executes edited copies.",
			"Does not touch athena/migrations or the application ledger.",
		],
		examples: [
			"athena-js migrate auth sync",
			"athena-js migrate auth materialize",
			"athena-js migrate auth sync --dry-run",
		],
	},
];
