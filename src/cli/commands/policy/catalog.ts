import type { CliCatalogFlag, CliCommandEntry } from "../../commands-catalog.ts";

const policyHelpFlags = ["-h"] as const satisfies readonly CliCatalogFlag[];

const policyConfigFlags = [
	"--config <path>",
	"--json",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

const policyShowFlags = [
	"--config <path>",
	"--id <id>",
	"--json",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

const policyExplainFlags = [
	"--config <path>",
	"--action <name>",
	"--resource <name>",
	"--json",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

const policySimulateFlags = [
	"--config <path>",
	"--action <name>",
	"--resource <name>",
	"--row",
	"--row <json>",
	"--json",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

const policyExportFlags = [
	"--config <path>",
	"--format ir",
	"--json",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

export const policyCatalog: readonly CliCommandEntry[] = [
	{
		command: "policy",
		description: "Inspect authored Athena Policy IR (no database)",
		flags: policyHelpFlags,
		group: "policy",
		helpTopic: "policy",
		notes: [
			"Loads policies from athena.config.ts (`policies` or lazy `tooling.policies`).",
			"Does not require a generator provider or database connection.",
		],
		examples: [
			"athena-js policy list",
			"athena-js policy validate",
			"athena-js policy explain --action select --resource public.invoices",
			"athena-js policy simulate --row '{\"userId\":\"user-1\"}'",
			"athena-js policy export --format ir",
		],
	},
	{
		command: "policy list",
		description: "Inventory authored policies",
		flags: policyConfigFlags,
		group: "policy",
		helpTopic: "policy",
	},
	{
		command: "policy show",
		description: "Show one authored policy by id",
		flags: policyShowFlags,
		group: "policy",
		helpTopic: "policy",
	},
	{
		command: "policy validate",
		description: "Validate Policy IR (no database)",
		flags: policyConfigFlags,
		group: "policy",
		helpTopic: "policy",
	},
	{
		command: "policy lint",
		description: "Lint policy expressions with stable codes and severity",
		flags: policyConfigFlags,
		group: "policy",
		helpTopic: "policy",
	},
	{
		command: "policy coverage",
		description: "Coverage cells per resource × action",
		flags: policyConfigFlags,
		group: "policy",
		helpTopic: "policy",
	},
	{
		command: "policy explain",
		description: "Structural interrogation of compiled Policy IR",
		flags: policyExplainFlags,
		group: "policy",
		helpTopic: "policy",
	},
	{
		command: "policy simulate",
		description: "Bind --row and evaluate Policy against a concrete row",
		flags: policySimulateFlags,
		group: "policy",
		helpTopic: "policy",
	},
	{
		command: "policy fingerprint",
		description: "Fingerprint the loaded Policy IR document",
		flags: policyConfigFlags,
		group: "policy",
		helpTopic: "policy",
	},
	{
		command: "policy export",
		description: "Export canonical Policy IR (byte-equal to canonicalizeDocument)",
		flags: policyExportFlags,
		group: "policy",
		helpTopic: "policy",
	},
];
