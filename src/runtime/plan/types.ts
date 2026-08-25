/**
 * Internal AthenaRuntimePlan. Not a public config surface.
 */

import type {
	AthenaAuthRuntime,
	AthenaDbTransport,
	AthenaRuntimeEnvironment,
	AthenaStorageTransport,
	ResolvedAthenaRuntime,
} from "../resolve.ts";

export interface AthenaRuntimePlanAuth {
	runtime: AthenaAuthRuntime;
}

export interface AthenaRuntimePlanDb {
	hasD1: boolean;
	hasPool: boolean;
	pgUri?: string;
	transport: AthenaDbTransport;
}

export interface AthenaRuntimePlanStorage {
	bucket?: string;
	hasR2: boolean;
	hasUrl: boolean;
	prefix?: string;
	root?: string;
	transport: AthenaStorageTransport;
	wantsLocal: boolean;
	wantsS3: boolean;
}

/**
 * Construction intent + resolved transports + environment.
 * Provider SDK handles are produced by materializers, not stored as config.
 */
export interface AthenaRuntimePlan {
	auth: AthenaRuntimePlanAuth;
	config: unknown;
	db: AthenaRuntimePlanDb;
	environment: AthenaRuntimeEnvironment;
	storage: AthenaRuntimePlanStorage;
	trustedNode: boolean;
}

export function toResolvedAthenaRuntime(
	plan: AthenaRuntimePlan,
): ResolvedAthenaRuntime {
	return {
		auth: { runtime: plan.auth.runtime },
		db: { transport: plan.db.transport },
		runtime: { environment: plan.environment },
		storage: { transport: plan.storage.transport },
	};
}
