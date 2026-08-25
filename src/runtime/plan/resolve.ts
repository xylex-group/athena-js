/**
 * Resolve an internal AthenaRuntimePlan from createClient config.
 */

import {
	detectAthenaRuntimeEnvironment,
	inferEmbeddedAuthMode,
	resolveAthenaRuntime,
	resolveDatabaseUri,
	type ResolveAthenaRuntimeOptions,
	type ResolveConfigInput,
} from "../resolve.ts";
import type { AthenaRuntimePlan } from "./types.ts";

function trimOptional(value: string | null | undefined): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function resolveRuntimePlan(
	config: unknown,
	options: ResolveAthenaRuntimeOptions = {},
): AthenaRuntimePlan {
	const input = (config ?? {}) as ResolveConfigInput;
	const environment =
		options.environment ?? detectAthenaRuntimeEnvironment();
	const trustedNode = options.trustedNode ?? environment === "node";
	const inferred = trustedNode ? inferEmbeddedAuthMode(input) : input;
	const snapshot = resolveAthenaRuntime(inferred, {
		environment,
		trustedNode,
	});
	const storage = inferred.storage;
	const root = trimOptional(storage?.root);
	const prefix = trimOptional(storage?.prefix);
	const bucket = trimOptional(storage?.bucket);
	return {
		auth: { runtime: snapshot.auth.runtime },
		config: inferred,
		db: {
			hasD1: inferred.db?.d1 !== undefined && inferred.db?.d1 !== null,
			hasPool: inferred.db?.pool !== undefined && inferred.db?.pool !== null,
			pgUri: resolveDatabaseUri(inferred),
			transport: snapshot.db.transport,
		},
		environment,
		storage: {
			...(bucket ? { bucket } : {}),
			hasR2: storage?.r2 !== undefined && storage?.r2 !== null,
			hasUrl: Boolean(trimOptional(storage?.url)),
			...(prefix ? { prefix } : {}),
			...(root ? { root } : {}),
			transport: snapshot.storage.transport,
			wantsLocal: storage?.provider === "local",
			wantsS3: storage?.provider === "s3",
		},
		trustedNode,
	};
}
