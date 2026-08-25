import type {
	CliCatalogFlag,
	CliCommandEntry,
} from "../../commands-catalog.ts";

const envCheckFlags = [
	"--file <path>",
	"-f <path>",
	"--mode auto|direct|gateway",
	"--strict",
	"--json",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

export const envCatalog: readonly CliCommandEntry[] = [
	{
		aliases: ["env", "env validate"],
		command: "env check",
		description: "Validate .env / .env.local keys and URLs",
		flags: envCheckFlags,
		group: "env",
		helpTopic: "env",
		notes: [
			"Validates Athena-related keys and URLs from project env files and process env.",
			"Exit 5 when one or more validation errors are present.",
		],
		examples: [
			"athena-js env check",
			"athena-js env check --file .env.local --mode gateway",
			"athena-js env validate --json",
		],
	},
];
