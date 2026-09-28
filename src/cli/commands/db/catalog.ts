import type {
  CliCatalogFlag,
  CliCommandEntry,
} from "../../commands-catalog.ts";

const dbHelpFlags = ["-h"] as const satisfies readonly CliCatalogFlag[];

const dbStartFlags = [
  "--config <path>",
  "--force",
  "--json",
  "--write-env",
  "-h",
] as const satisfies readonly CliCatalogFlag[];

const dbStatusFlags = [
  "--config <path>",
  "--json",
  "-h",
] as const satisfies readonly CliCatalogFlag[];

const dbJsonFlags = ["--json", "-h"] as const satisfies readonly CliCatalogFlag[];

const dbResetFlags = [
  "--json",
  "--yes",
  "-h",
] as const satisfies readonly CliCatalogFlag[];

export const dbCatalog: readonly CliCommandEntry[] = [
  {
    command: "db",
    description: "Manage the project-local PostgreSQL runtime",
    examples: [
      "athena-js db start",
      "athena-js db status --json",
      "athena-js db reset --yes",
      "athena-js db logs",
    ],
    flags: dbHelpFlags,
    group: "runtime",
    helpTopic: "db",
    notes: [
      "The runtime uses Docker and persists its credentials in .athena/runtime/postgres.json.",
      "Reset is destructive and requires --yes.",
    ],
  },
  {
    command: "db start",
    description: "Start or recreate the project-local PostgreSQL container",
    flags: dbStartFlags,
    group: "runtime",
    helpTopic: "db",
  },
  {
    command: "db stop",
    description: "Stop the project-local PostgreSQL container",
    flags: dbJsonFlags,
    group: "runtime",
    helpTopic: "db",
  },
  {
    command: "db status",
    description: "Report the project-local PostgreSQL runtime",
    flags: dbStatusFlags,
    group: "runtime",
    helpTopic: "db",
  },
  {
    command: "db restart",
    description: "Restart the project-local PostgreSQL container",
    flags: dbStartFlags,
    group: "runtime",
    helpTopic: "db",
  },
  {
    command: "db reset",
    description: "Destroy the Athena-owned container, volume, and runtime state",
    flags: dbResetFlags,
    group: "runtime",
    helpTopic: "db",
  },
  {
    command: "db logs",
    description: "Print PostgreSQL container logs",
    flags: dbJsonFlags,
    group: "runtime",
    helpTopic: "db",
  },
];
