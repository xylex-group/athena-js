import type {
  CliCatalogFlag,
  CliCommandEntry,
} from "../../commands-catalog.ts";

const doctorFlags = [
  "--config <path>",
  "--strict",
  "--skip-runtime",
  "--json",
  "--plain",
  "-h",
] as const satisfies readonly CliCatalogFlag[];

const doctorBundleFlags = [
  "--include-latest-log",
  "--invocation <id>",
  "--out <path>",
  "--json",
  "-h",
] as const satisfies readonly CliCatalogFlag[];

export const doctorCatalog: readonly CliCommandEntry[] = [
  {
    command: "doctor",
    description:
      "Project health check: Node, config, env, and local runtime (read-only)",
    examples: [
      "athena-js doctor",
      "athena-js doctor --strict",
      "athena-js doctor --skip-runtime --json",
      "athena-js doctor bundle",
    ],
    flags: doctorFlags,
    group: "runtime",
    helpTopic: "doctor",
    notes: [
      "Read-only project health check (Node, config, env, local runtime).",
      "Does not write files or apply migrations. Exit 5 when any check is error.",
    ],
  },
  {
    command: "doctor bundle",
    description: "Write a secret-safe diagnostic directory",
    flags: doctorBundleFlags,
    group: "runtime",
    helpTopic: "doctor",
    notes: [
      "Writes redacted JSON (no database passwords, API keys, JWT, or SMTP secrets).",
    ],
  },
];
