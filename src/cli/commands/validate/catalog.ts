import type {
  CliCatalogFlag,
  CliCommandEntry,
} from "../../commands-catalog.ts";

const validateFlags = [
  "--config <path>",
  "--strict",
  "--json",
  "--plain",
  "-h",
] as const satisfies readonly CliCatalogFlag[];

export const validateCatalog: readonly CliCommandEntry[] = [
  {
    aliases: ["validate local"],
    command: "validate",
    description:
      "Inspect local Data Runtime, Embedded Auth schema, and passkeys (read-only)",
    examples: ["athena-js validate", "athena-js validate local --strict"],
    flags: validateFlags,
    group: "runtime",
    helpTopic: "validate",
    notes: [
      "Read-only inspection of the local Data Runtime and Embedded Auth on direct Postgres.",
      "Does not apply migrations. Exit 5 when any check is error.",
    ],
  },
];
