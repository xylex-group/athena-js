import type { CliCatalogFlag, CliCommandEntry } from "../../commands-catalog.ts";

const generateFlags = [
	"--config <path>",
	"--dry-run",
	"--no-write-config",
	"--write-config",
	"--no-discover-schemas",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

export const generateCatalog: readonly CliCommandEntry[] = [
	{
		command: "generate",
		description: "Introspect schema and write models/registry artifacts",
		flags: generateFlags,
		group: "generator",
		helpTopic: "generate",
		notes: [
			"Config resolution:",
			"  - uses athena.config.* discovery first",
			"  - falls back to env-only direct mode when DATABASE_URL/PG_URL is present",
			"  - falls back to env-only gateway mode when ATHENA_URL + ATHENA_API_KEY are present",
		],
		examples: [
			"athena-js generate",
			"DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/app_db athena-js generate --dry-run",
			"athena-js generate --config ./athena.config.ts --dry-run",
			"athena-js generate --no-write-config",
		],
	},
];
