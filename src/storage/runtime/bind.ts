import {
	ATHENA_STORAGE_PROVIDER,
	ATHENA_STORAGE_RUNTIME,
	type StorageObjectProvider,
	type StorageRuntime,
} from "./types.ts";

export function getStorageProvider(
	storage: unknown,
): StorageObjectProvider | undefined {
	if (!storage || typeof storage !== "object") {
		return undefined;
	}
	return (storage as { [ATHENA_STORAGE_PROVIDER]?: StorageObjectProvider })[
		ATHENA_STORAGE_PROVIDER
	];
}

export function bindStorageProvider<TStorage extends object>(
	storage: TStorage,
	provider: StorageObjectProvider,
): TStorage & { [ATHENA_STORAGE_PROVIDER]: StorageObjectProvider } {
	return {
		...storage,
		[ATHENA_STORAGE_PROVIDER]: provider,
	};
}

export function getStorageRuntime(
	storage: unknown,
): StorageRuntime | undefined {
	if (!storage || typeof storage !== "object") {
		return undefined;
	}
	return (storage as { [ATHENA_STORAGE_RUNTIME]?: StorageRuntime })[
		ATHENA_STORAGE_RUNTIME
	];
}

export function bindStorageRuntime<TStorage extends object>(
	storage: TStorage,
	runtime: StorageRuntime,
): TStorage & { [ATHENA_STORAGE_RUNTIME]: StorageRuntime } {
	return {
		...storage,
		[ATHENA_STORAGE_RUNTIME]: runtime,
	};
}
