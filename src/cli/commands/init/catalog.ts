import type { CliCatalogFlag, CliCommandEntry } from "../../commands-catalog.ts";

const initFlags = [
	"--config <path>",
	"--mode direct|gateway|auto",
	"--force",
	"--dry-run",
	"--no-discover-schemas",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

export const initCatalog: readonly CliCommandEntry[] = [
	{
		command: "init",
		description: "Create or surgically update athena.config.ts",
		flags: initFlags,
		group: "project",
		helpTopic: "init",
		notes: [
			"Behavior:",
			"  - missing file → write modern athena-direct config with generatorEnv-backed secrets",
			"  - existing file → only patch provider.schemas when discovery finds new schemas",
			"  - gateway mode works fully via ATHENA_URL + ATHENA_API_KEY env fallbacks",
		],
		examples: [
			"athena-js init",
			"athena-js init --mode gateway",
			"athena-js init --dry-run",
			"athena-js init --force",
		],
	},
];
