import type {
  CliCatalogFlag,
  CliCommandEntry,
} from "../../commands-catalog.ts";

const generateFlags = [
  "--config <path>",
  "--check",
  "--dry-run",
  "--strict",
  "--no-write-config",
  "--write-config",
  "--no-discover-schemas",
  "-h",
] as const satisfies readonly CliCatalogFlag[];

export const generateCatalog: readonly CliCommandEntry[] = [
  {
    command: "generate",
    description: "Introspect schema and write models/registry artifacts",
    examples: [
      "athena-js generate",
      "DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/app_db athena-js generate --dry-run",
      "athena-js generate --config ./athena.config.ts --dry-run",
      "athena-js generate --check",
      "athena-js generate --check --strict",
      "athena-js generate --no-write-config",
    ],
    flags: generateFlags,
    group: "generator",
    helpTopic: "generate",
    notes: [
      "Config resolution:",
      "  - uses athena.config.* discovery first",
      "  - falls back to env-only direct mode when DATABASE_URL/PG_URL is present",
      "  - falls back to env-only gateway mode when ATHENA_URL + ATHENA_API_KEY are present",
      "`--check` inspects without writing. Exit 0 when current, 1 when stale, 2 on failed generation, 3 on generated-file ownership violations.",
      "`--strict` treats generator diagnostics (duplicate includeTables / excludeTables selectors) as errors.",
    ],
  },
];
