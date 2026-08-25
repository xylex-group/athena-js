import { createLocalStorageModule } from "../../local.ts";
import type { AthenaStorageModule } from "../../module.ts";
import {
	mapProviderFailure,
	storageErrorResult,
	storageOkResult,
} from "../errors.ts";
import type {
	AuthorizedStorageOperation,
	StorageObjectProvider,
} from "../types.ts";

export function createLocalStorageProvider(
	store: AthenaStorageModule,
): StorageObjectProvider {
	return {
		async execute(op: AuthorizedStorageOperation) {
			try {
				switch (op.op) {
					case "put": {
						if (!op.key?.trim()) {
							return storageErrorResult(
								3000,
								"storage_invalid_request",
								"put requires key",
								400,
							);
						}
						const data = await store.file.upload({
							body: op.body ?? new Uint8Array(),
							name: op.key,
							source: op.body ?? new Uint8Array(),
							storage_key: op.key,
						} as never);
						return storageOkResult(data);
					}
					case "get": {
						if (!op.key?.trim()) {
							return storageErrorResult(
								3000,
								"storage_invalid_request",
								"get requires key",
								400,
							);
						}
						const data = await store.file.get({ storage_key: op.key } as never);
						return storageOkResult(data);
					}
					case "head": {
						if (!op.key?.trim()) {
							return storageErrorResult(
								3000,
								"storage_invalid_request",
								"head requires key",
								400,
							);
						}
						const data = await (
							store.file as typeof store.file & {
								head: (input: never) => Promise<unknown>;
							}
						).head({ storage_key: op.key } as never);
						return storageOkResult(data);
					}
					case "delete": {
						if (!op.key?.trim()) {
							return storageErrorResult(
								3000,
								"storage_invalid_request",
								"delete requires key",
								400,
							);
						}
						const data = await store.file.delete({
							storage_key: op.key,
						} as never);
						return storageOkResult(data);
					}
					case "list": {
						const data = await store.file.list({ prefix: op.prefix } as never);
						return storageOkResult(data);
					}
					default:
						return storageErrorResult(
							3000,
							"storage_invalid_request",
							`unsupported op ${String(op.op)}`,
							400,
						);
				}
			} catch (error) {
				return mapProviderFailure(error);
			}
		},
	};
}

export function createLocalStorageProviderFromRoot(options: {
	prefix?: string | null;
	root: string;
}): StorageObjectProvider {
	return createLocalStorageProvider(
		createLocalStorageModule({
			prefix: options.prefix,
			root: options.root,
		}),
	);
}
