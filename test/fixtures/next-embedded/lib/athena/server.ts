import "server-only";

import { createAthenaServerClient } from "@xylex-group/athena/next/server";

import { athena } from "./root.ts";

export async function createAthenaServer(options?: {
	scope?: {
		organizationId?: string | null;
		userId?: string | null;
	};
	session?: unknown;
}) {
	return createAthenaServerClient({
		client: athena,
		...options,
	});
}
