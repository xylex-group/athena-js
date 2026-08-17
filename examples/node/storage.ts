/**
 * EXAMPLE: Storage namespace (gateway managed files / object helpers).
 *
 *   ATHENA_URL=https://… ATHENA_API_KEY=… pnpm example:storage
 */
import { createClient } from "@xylex-group/athena";

const url = process.env.ATHENA_URL ?? process.env.ATHENA_GATEWAY_URL;
const key = process.env.ATHENA_API_KEY ?? process.env.ATHENA_GATEWAY_API_KEY;

if (!url) {
	console.error("Set ATHENA_URL (and ATHENA_API_KEY when required)");
	process.exit(1);
}

const athena = createClient({
	key,
	storage: { url: process.env.ATHENA_STORAGE_URL ?? url },
	url,
});

async function main() {
	const storage = athena.storage as unknown as Record<string, unknown>;
	console.log("storage keys", Object.keys(storage));

	const files = storage.files as
		| { list?: (input?: unknown) => Promise<unknown> }
		| undefined;
	if (typeof files?.list === "function") {
		try {
			const listed = await files.list({ limit: 5 });
			console.log("files.list", listed);
		} catch (error) {
			console.log(
				"files.list error",
				error instanceof Error ? error.message : error,
			);
		}
	} else {
		console.log(
			"storage.files.list not available — edge R2 samples live under examples/cloudflare/14-l3a-r2-storage.ts",
		);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
