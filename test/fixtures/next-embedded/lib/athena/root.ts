import "server-only";

import { createClient } from "@xylex-group/athena/server";

export const athena = createClient({
	auth: {
		mode: "local",
	},
	databaseUrl: process.env.DATABASE_URL ?? process.env.ATHENA_TEST_DATABASE_URL,
});
