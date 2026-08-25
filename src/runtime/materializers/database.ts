/**
 * Node database transport materializer (postgres / D1 already on config).
 */

import { createPostgresDirectCapabilities } from "../../cloudflare/capabilities.ts";
import {
	ATHENA_PG_DIRECT_API_KEY,
	ATHENA_PG_DIRECT_BASE_URL,
} from "../../postgres/constants.ts";
import type { AthenaPostgresPool } from "../../postgres/driver.ts";
import {
	bindPostgresRuntime,
	createAthenaPostgresRuntime,
} from "../../postgres/owned-runtime.ts";
import {
	createPostgresDirectTransport,
	disposePostgresDirectTransport,
} from "../../postgres/transport.ts";
import { catalogFromModels } from "../../query/engine/index.ts";
import type { AthenaClientModelsInput } from "../../schema/types.ts";
import { isLocalStorageConfig, isS3StorageConfig } from "../../storage/runtime.ts";
import {
	type AthenaClientConfig,
	AthenaConfigurationError,
	hasRemoteAuthService,
	hasRemoteDbGatewayUrl,
	hasRemoteHttpServices,
	hasRemoteHttpStorage,
	isD1Binding,
	normalizeOptional,
	resolveUnifiedRemoteRoot,
} from "../../v3-client-core.ts";
import type { AthenaRuntimePlan } from "../plan/types.ts";

export { disposePostgresDirectTransport };

/**
 * Wire `db.pgUri` into a direct PostgreSQL AthenaGatewayClient transport.
 * Runs after edge materialize so D1 wins only when selected; d1+pgUri is rejected.
 */
export function materializeDatabase<
	TModels extends AthenaClientModelsInput | undefined,
>(
	config: AthenaClientConfig<TModels>,
	_plan?: AthenaRuntimePlan,
): AthenaClientConfig<TModels> {
	const pgUri = normalizeOptional(config.db?.pgUri);
	const borrowedPool = config.db?.pool;
	if (!(pgUri || borrowedPool)) {
		return config;
	}

	if (isD1Binding(config.db?.d1)) {
		throw new AthenaConfigurationError(
			"ATHENA_NO_SERVICE_CONFIGURED",
			"Athena cannot use db.d1 and db.pgUri together. Configure exactly one local DB binding, or set mode/prefer to select a single execution backend.",
			"db",
		);
	}

	// Explicit gateway mode keeps historical header-only pgUri routing on HTTP.
	const modeRaw =
		normalizeOptional(
			typeof config.mode === "string" ? config.mode : undefined,
		) ?? normalizeOptional(config.env?.ATHENA_EXECUTION_MODE);
	if (modeRaw) {
		const modeKey = modeRaw.trim().toLowerCase();
		if (
			modeKey === "gateway" ||
			modeKey === "http" ||
			modeKey === "remote" ||
			modeKey === "server"
		) {
			return config;
		}
	}

	if (config.gatewayTransport) {
		return config;
	}

	const remoteRoot = resolveUnifiedRemoteRoot(config);
	const remoteServices = hasRemoteHttpServices(config);
	const remoteStorage = hasRemoteHttpStorage(config);
	const remoteAuth = hasRemoteAuthService(config);
	const postgresRuntime = createAthenaPostgresRuntime(
		borrowedPool
			? { pool: borrowedPool as AthenaPostgresPool }
			: { connectionString: pgUri as string },
	);
	const gatewayTransport = createPostgresDirectTransport({
		relationCatalog: catalogFromModels(config.models),
		runtime: postgresRuntime,
	});
	bindPostgresRuntime(gatewayTransport, postgresRuntime);
	const next: AthenaClientConfig<TModels> = {
		...config,
		gatewayTransport,
	};

	const explicitDbUrl = normalizeOptional(config.db?.url);
	const remoteDbGateway = hasRemoteDbGatewayUrl(config);
	next.db = {
		...config.db,
		pgUri,
		// Prefer sentinel for pure local DB so resolveCore has urls.db without
		// implying a real HTTP gateway. Keep explicit/remote db.url when present.
		url:
			explicitDbUrl ??
			(remoteDbGateway ? undefined : ATHENA_PG_DIRECT_BASE_URL),
	};

	const explicitKey = normalizeOptional(config.key);
	if (explicitKey) {
		next.key = explicitKey;
	} else if (remoteServices) {
		next.key = undefined;
	} else {
		next.key = ATHENA_PG_DIRECT_API_KEY;
	}

	if (remoteRoot) {
		next.billing = {
			...(config.billing ?? {}),
			url: normalizeOptional(config.billing?.url) ?? remoteRoot,
		};
	}

	if (!config.capabilities) {
		next.capabilities = createPostgresDirectCapabilities({
			authRemote: remoteAuth,
			findManyAst: true,
			flatCrud: true,
			query: true,
			relations: true,
			rpc: true,
			storageConfigured:
				remoteStorage ||
				isLocalStorageConfig(config.storage) ||
				isS3StorageConfig(config.storage),
		});
		if (isLocalStorageConfig(config.storage)) {
			next.capabilities.storage.local = true;
			next.capabilities.storage.objects = true;
		}
		if (isS3StorageConfig(config.storage)) {
			next.capabilities.storage.objects = true;
		}
	}
	next.findManyAst = config.findManyAst ?? true;

	return next;
}

export function disposeMaterializedDatabase(
	transport: Parameters<typeof disposePostgresDirectTransport>[0],
): Promise<void> {
	return disposePostgresDirectTransport(transport);
}
