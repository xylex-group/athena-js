import type { CliCatalogFlag, CliCommandEntry } from "../../commands-catalog.ts";

const commandsFlags = [
	"--json",
	"--plain",
	"--groups",
] as const satisfies readonly CliCatalogFlag[];

export const commandsCatalog: readonly CliCommandEntry[] = [
	{
		aliases: [
			"-C",
			"--commands",
			"--list-commands",
			"--cmds",
			"commands",
			"list-commands",
			"cmds",
		],
		command: "commands",
		description: "List every CLI command, alias, and common flags",
		flags: commandsFlags,
		group: "global",
		helpTopic: "commands",
		notes: [
			"Prints the full athena-js command inventory (SSOT).",
			"Use `athena-js <command> --help` for detailed flags on one command.",
		],
	},
];
