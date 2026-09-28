import type {
  CliCatalogFlag,
  CliCommandEntry,
} from "../../commands-catalog.ts";
import {
  ATHENA_MIGRATE_ALLOW_DIRTY_YES_COMMAND,
  ATHENA_MIGRATE_AUTH_MATERIALIZE_COMMAND,
  ATHENA_MIGRATE_AUTH_SYNC_COMMAND,
  ATHENA_MIGRATE_AUTH_SYNC_DRY_RUN_COMMAND,
  ATHENA_MIGRATE_CHECK_STRICT_COMMAND,
  ATHENA_MIGRATE_COMMAND,
  ATHENA_MIGRATE_EXPLAIN_COMMAND,
  ATHENA_MIGRATE_RECONCILE_APPLY_YES_COMMAND,
  ATHENA_MIGRATE_RECONCILE_COMMAND,
  ATHENA_MIGRATE_REPAIR_YES_COMMAND,
  ATHENA_MIGRATE_STATUS_COMMAND,
} from "../../../migrations/commands.ts";

const migrateApplyFlags = [
  "--config <path>",
  "--dry-run",
  "--allow-dirty-migrations",
  "--yes",
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
  "--allow-dirty-migrations",
  "--json",
  "--strict",
  "-h",
] as const satisfies readonly CliCatalogFlag[];

const migrateRepairFlags = [
  "--config <path>",
  "--allow-dirty-migrations",
  "--yes",
  "--dry-run",
  "--json",
  "-h",
] as const satisfies readonly CliCatalogFlag[];

export const migrateCatalog: readonly CliCommandEntry[] = [
  {
    command: "migrate",
    description: "Apply pending SQL migrations (direct Postgres)",
    examples: [
      ATHENA_MIGRATE_COMMAND,
      `${ATHENA_MIGRATE_COMMAND} --dry-run`,
      ATHENA_MIGRATE_STATUS_COMMAND,
      ATHENA_MIGRATE_CHECK_STRICT_COMMAND,
      ATHENA_MIGRATE_RECONCILE_COMMAND,
      ATHENA_MIGRATE_RECONCILE_APPLY_YES_COMMAND,
      ATHENA_MIGRATE_ALLOW_DIRTY_YES_COMMAND,
      ATHENA_MIGRATE_REPAIR_YES_COMMAND,
      ATHENA_MIGRATE_AUTH_SYNC_COMMAND,
    ],
    flags: migrateApplyFlags,
    group: "migrations",
    helpTopic: "migrate",
    notes: [
      "Requires provider.kind=postgres and provider.mode=direct.",
      "Preflights the pending batch against the physical catalog, then applies each file under a PostgreSQL session advisory lock.",
      "Use migrate check for static analysis; migrate reconcile [--apply] for ledger vs physical metadata.",
      "Fails closed on uncommitted application SQL or migrate config unless --allow-dirty-migrations --yes.",
      "--allow-dirty is an alias of --allow-dirty-migrations; -y is an alias of --yes.",
      "Non-interactive apply (no TTY) requires both the allow-dirty flag and --yes; a TTY prompts instead of --yes.",
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
    examples: [
      `${ATHENA_MIGRATE_EXPLAIN_COMMAND} 0007`,
      `${ATHENA_MIGRATE_EXPLAIN_COMMAND} 0007_add_indexes.sql`,
    ],
    flags: migrateJsonFlags,
    group: "migrations",
    helpTopic: "migrate",
    notes: [
      "Requires a version or filename argument.",
      `${ATHENA_MIGRATE_EXPLAIN_COMMAND} with no target prints migrate help; it does not explain a missing version as (missing).`,
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
      "A dirty migration worktree is not deploy-ready unless --allow-dirty-migrations.",
    ],
  },
  {
    command: "migrate repair",
    description:
      "Repair Auth schema drift (inspect/restore app objects separately)",
    flags: migrateRepairFlags,
    group: "migrations",
    helpTopic: "migrate",
  },
  {
    aliases: ["migrate auth materialize", "migrate auth"],
    command: "migrate auth sync",
    description:
      "Rematerialize package-owned Embedded Auth SQL under athena/managed/auth/migrations",
    examples: [
      ATHENA_MIGRATE_AUTH_SYNC_COMMAND,
      ATHENA_MIGRATE_AUTH_MATERIALIZE_COMMAND,
      ATHENA_MIGRATE_AUTH_SYNC_DRY_RUN_COMMAND,
    ],
    flags: ["--config <path>", "--dry-run", "--json", "--plain", "-h"],
    group: "migrations",
    helpTopic: "migrate",
    notes: [
      "Local files are a read-only inspection view. Runtime apply never executes edited copies.",
      "Does not touch athena/migrations or the application ledger.",
    ],
  },
];
