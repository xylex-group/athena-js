import type { CliCatalogFlag, CliCommandEntry } from "../../commands-catalog.ts";

const schemaHelpFlags = ["-h"] as const satisfies readonly CliCatalogFlag[];

const schemaDiffFlags = [
	"--config <path>",
	"--from <path>",
	"--json",
	"--migration",
	"--policy-impact",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

const schemaSnapshotFlags = [
	"--config <path>",
	"--out <path>",
	"--check",
	"--json",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

export const schemaCatalog: readonly CliCommandEntry[] = [
	{
		command: "schema",
		description: "Schema IR vs physical database (diff / snapshot)",
		flags: schemaHelpFlags,
		group: "schema",
		helpTopic: "schema",
		notes: [
			"Compares a checked-in schema snapshot to the physical database.",
			"Does not apply migrations. Use `schema diff --migration` for a proposed SQL comment stub.",
			"`schema diff --policy-impact` reports authored policies impacted by dropped/renamed tables/columns (not a schema lifecycle engine).",
		],
		examples: [
			"athena-js schema snapshot",
			"athena-js schema snapshot --check",
			"athena-js schema diff",
			"athena-js schema diff --json",
			"athena-js schema diff --migration",
			"athena-js schema diff --policy-impact",
		],
	},
	{
		command: "schema diff",
		description: "Diff checked-in snapshot against the physical database",
		flags: schemaDiffFlags,
		group: "schema",
		helpTopic: "schema",
	},
	{
		command: "schema snapshot",
		description: "Write or check athena/schema.snapshot.json",
		flags: schemaSnapshotFlags,
		group: "schema",
		helpTopic: "schema",
	},
];
