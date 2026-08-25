import type { CliCatalogFlag, CliCommandEntry } from "../../commands-catalog.ts";

const apiKeyGenerateFlags = [
	"--bytes <n>",
	"--prefix <str>",
	"--write",
	"--env-file <path>",
	"--env-key <name>",
	"--force",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

const apiKeyCreateFlags = [
	"--name <name>",
	"--rights a,b",
	"--client-name <c>",
	"--description <d>",
	"--expires-at <iso>",
	"--url <gateway>",
	"--admin-key <secret>",
	"--write",
	"--env-file <path>",
	"--env-key <name>",
	"--force",
	"--json",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

const apiKeyListFlags = [
	"--url <gateway>",
	"--admin-key <secret>",
	"--json",
	"-h",
] as const satisfies readonly CliCatalogFlag[];

export const apiKeyCatalog: readonly CliCommandEntry[] = [
	{
		aliases: ["key generate", "api-key gen", "api-key new"],
		command: "api-key generate",
		description:
			"Generate a local static admin secret (ATHENA_KEY_12; no network)",
		flags: apiKeyGenerateFlags,
		group: "local-secrets",
		helpTopic: "api-key",
		notes: [
			"generate: offline ATHENA_KEY_12 / P12 secret only — does not register a gateway API key store row.",
			"create/list: POST/GET /admin/api-keys via gateway admin (ATHENA_KEY_12). create --write sets ATHENA_API_KEY.",
		],
		examples: [
			"athena-js api-key generate --write",
			"athena-js api-key create --name analytics --rights gateway.query --client-name analytics --write",
			"athena-js api-key list --json",
		],
	},
	{
		aliases: ["key create"],
		command: "api-key create",
		description:
			"Create gateway API key via POST /admin/api-keys (static admin key)",
		flags: apiKeyCreateFlags,
		group: "gateway-admin",
		helpTopic: "api-key",
		notes: [
			"--rights tokens are parseAthenaRightKey (dotted AthenaRightKey). Invalid names fail closed; admin:read is not rewritten to admin.read.",
		],
	},
	{
		aliases: ["key list", "api-key ls", "key ls"],
		command: "api-key list",
		description: "List gateway API keys via GET /admin/api-keys",
		flags: apiKeyListFlags,
		group: "gateway-admin",
		helpTopic: "api-key",
	},
];
