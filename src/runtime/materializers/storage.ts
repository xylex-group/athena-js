/**
 * Node storage materializer — local ObjectStore bind / HTTP module stays on core.
 */

import type { AthenaClientModelsInput } from "../../schema/types.ts";
import { createLocalStorageModule } from "../../storage/local.ts";
import type { AthenaStorageModule } from "../../storage/module.ts";
import {
	bindStorageProvider,
	bindStorageRuntime,
	createStorageRuntime,
	getStorageProvider,
} from "../../storage/runtime/index.ts";
import { createLocalStorageProvider } from "../../storage/runtime/providers/local-provider.ts";
import { createR2StorageProvider } from "../../storage/runtime/providers/r2-provider.ts";
import {
	createS3StorageProvider,
	isAthenaS3ObjectClient,
} from "../../storage/runtime/providers/s3-provider.ts";
import type { AthenaStorageLifecycleHooks } from "../../storage/runtime/types.ts";
import {
	bindLocalObjectStore,
	getLocalObjectStore,
	isLocalStorageConfig,
	isS3StorageConfig,
} from "../../storage/runtime.ts";
import {
	type AthenaClientConfig,
	AthenaConfigurationError,
	normalizeOptional,
} from "../../v3-client-core.ts";
import type { AthenaRuntimePlan } from "../plan/types.ts";

function isR2StorageConfig(
	storage: unknown,
): storage is { prefix?: string | null; r2: { get: unknown; put: unknown } } {
	return Boolean(
		storage &&
			typeof storage === "object" &&
			typeof (storage as { r2?: { get?: unknown; put?: unknown } }).r2?.get ===
				"function" &&
			typeof (storage as { r2?: { put?: unknown } }).r2?.put === "function",
	);
}

function attachRuntime<TStorage extends object>(
	storage: TStorage,
	lifecycle?: AthenaStorageLifecycleHooks,
): TStorage {
	const provider = getStorageProvider(storage);
	if (!provider) {
		return storage;
	}
	return bindStorageRuntime(
		storage,
		createStorageRuntime({
			lifecycle,
			provider,
		}),
	);
}

export function materializeStorage<
	TModels extends AthenaClientModelsInput | undefined,
>(
	config: AthenaClientConfig<TModels>,
	_plan?: AthenaRuntimePlan,
): AthenaClientConfig<TModels> {
	if (isLocalStorageConfig(config.storage)) {
		const root = normalizeOptional(config.storage.root);
		if (!root) {
			throw new AthenaConfigurationError(
				"ATHENA_RUNTIME_CONFIG_INVALID",
				'storage.provider "local" requires a filesystem root.',
				"storage",
			);
		}
		const store: AthenaStorageModule =
			getLocalObjectStore<AthenaStorageModule>(config.storage) ??
			createLocalStorageModule({
				prefix: config.storage.prefix,
				root,
			});
		const withStore = getLocalObjectStore(config.storage)
			? config.storage
			: bindLocalObjectStore(config.storage, store);
		const provider =
			getStorageProvider(withStore) ?? createLocalStorageProvider(store);
		const next: AthenaClientConfig<TModels> = {
			...config,
			storage: attachRuntime(
				bindStorageProvider(withStore, provider),
				config.lifecycle?.storage,
			),
		};
		if (next.capabilities && !config.capabilities) {
			next.capabilities = {
				...next.capabilities,
				storage: {
					...next.capabilities.storage,
					local: true,
					objects: true,
				},
			};
		}
		return next;
	}

	if (isR2StorageConfig(config.storage)) {
		const provider =
			getStorageProvider(config.storage) ??
			createR2StorageProvider(config.storage.r2 as never, config.storage.prefix);
		return {
			...config,
			storage: attachRuntime(
				bindStorageProvider(config.storage, provider),
				config.lifecycle?.storage,
			),
		};
	}

	if (isS3StorageConfig(config.storage)) {
		const bucket = normalizeOptional(config.storage.bucket);
		if (!bucket || !isAthenaS3ObjectClient(config.storage.s3)) {
			throw new AthenaConfigurationError(
				"ATHENA_RUNTIME_CONFIG_INVALID",
				'storage.provider "s3" requires a bucket and an injected S3 object client (getObject/putObject/headObject/deleteObject/listObjectsV2).',
				"storage",
			);
		}
		const provider =
			getStorageProvider(config.storage) ??
			createS3StorageProvider({
				bucket,
				prefix: config.storage.prefix,
				s3: config.storage.s3,
			});
		return {
			...config,
			storage: attachRuntime(
				bindStorageProvider(config.storage, provider),
				config.lifecycle?.storage,
			),
		};
	}

	return config;
}
