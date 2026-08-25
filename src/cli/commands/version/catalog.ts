import type { CliCatalogFlag, CliCommandEntry } from "../../commands-catalog.ts";

const versionFlags = [
	"--short",
	"-q",
] as const satisfies readonly CliCatalogFlag[];

export const versionCatalog: readonly CliCommandEntry[] = [
	{
		aliases: ["-v", "--version", "v", "version"],
		command: "version",
		description: "Print @xylex-group/athena package version",
		flags: versionFlags,
		group: "global",
		helpTopic: "version",
	},
];
