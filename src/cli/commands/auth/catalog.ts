import type { CliCatalogFlag, CliCommandEntry } from "../../commands-catalog.ts";

const authHelpFlags = ["-h"] as const satisfies readonly CliCatalogFlag[];

const authJsonFlags = [
	"--json",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

const authDoctorFlags = [
	"--json",
	"--strict",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

const authAuditFlags = [
	"--limit <n>",
	"--json",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

const authTracesFlags = [
	"--errors",
	"--limit <n>",
	"--json",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

export const authCatalog: readonly CliCommandEntry[] = [
	{
		command: "auth",
		description: "Embedded Auth operations (status, capabilities, audit, traces)",
		flags: authHelpFlags,
		group: "auth",
		helpTopic: "auth",
		examples: [
			"athena-js auth status",
			"athena-js auth doctor",
			"athena-js auth capabilities",
			"athena-js auth audit list --limit 20",
			"athena-js auth traces list --errors",
		],
	},
	{
		command: "auth status",
		description: "Embedded vs Rust capability snapshot and schema generation",
		flags: authJsonFlags,
		group: "auth",
		helpTopic: "auth",
		notes: [
			"Inspects Embedded Auth on postgres/direct (schema generation and observability tables).",
			"Inspect failures exit nonzero. Observability columns are not printed as unknown when inspect cannot run.",
		],
	},
	{
		command: "auth doctor",
		description: "Auth-focused health: generation, capabilities, observability tables",
		flags: authDoctorFlags,
		group: "auth",
		helpTopic: "auth",
		notes: [
			"Same inspect path as auth status, plus --strict.",
			"Inspect failures exit nonzero instead of reporting audit_log_auth / traces_auth as unknown.",
		],
	},
	{
		command: "auth capabilities",
		description: "Catalog matrix of Embedded vs Rust Auth operations",
		flags: authJsonFlags,
		group: "auth",
		helpTopic: "auth",
		notes: [
			"Static catalog matrix (Embedded vs dedicated Auth). Does not open a database.",
		],
	},
	{
		command: "auth audit",
		description: "List or show audit_log_auth events (local database)",
		flags: authAuditFlags,
		group: "auth",
		helpTopic: "auth",
		notes: [
			"Reads athena.audit_log_auth on postgres/direct. Requires observability generation 23+.",
		],
	},
	{
		command: "auth traces",
		description: "List or show traces_auth rows (local database)",
		flags: authTracesFlags,
		group: "auth",
		helpTopic: "auth",
		notes: [
			"Reads athena.traces_auth on postgres/direct. Requires observability generation 23+.",
		],
	},
];
