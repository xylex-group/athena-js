import type { CliCatalogFlag, CliCommandEntry } from "../../commands-catalog.ts";

const rightsReadFlags = [
	"--url <gateway>",
	"--admin-key <secret>",
	"--json",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

const rightsCreateFlags = [
	"--name <right>",
	"--description <text>",
	"--url <gateway>",
	"--admin-key <secret>",
	"--json",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

export const rightsCatalog: readonly CliCommandEntry[] = [
	{
		aliases: ["rights ls"],
		command: "rights list",
		description: "List dynamic API key rights (GET /admin/api-key-rights)",
		flags: rightsReadFlags,
		group: "gateway-admin",
		helpTopic: "rights",
	},
	{
		aliases: ["rights all"],
		command: "rights catalog",
		description:
			"Unified native + dynamic rights catalog (GET /admin/rights/catalog)",
		flags: rightsReadFlags,
		group: "gateway-admin",
		helpTopic: "rights",
	},
	{
		command: "rights create",
		description:
			"Bootstrap a right (POST /admin/api-key-rights). --name is parseAthenaRightKey (fail-closed)",
		flags: rightsCreateFlags,
		group: "gateway-admin",
		helpTopic: "rights",
	},
];
