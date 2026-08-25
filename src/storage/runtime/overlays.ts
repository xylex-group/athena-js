import { parseAthenaRightKey } from "../../rights/key.ts";
import type { AthenaPrincipal } from "../../runtime/data/principal.ts";
import type { StorageObjectOp, StorageRuntime } from "./types.ts";

export interface StorageOverlayInput {
	contentType?: string;
	cursor?: string;
	key?: string;
	limit?: number;
	metadata?: Record<string, string>;
	op: StorageObjectOp;
	prefix?: string;
	source?: Uint8Array | string;
}

/** Process-owned local ObjectStore caller — not an HTTP identity. */
const OVERLAY_PRINCIPAL: AthenaPrincipal = {
	authenticated: true,
	grants: [],
	rights: Object.freeze([parseAthenaRightKey("storage.*")]),
	userId: "storage-overlay",
};

export async function executeStorageOverlay(
	runtime: StorageRuntime,
	input: StorageOverlayInput,
) {
	return runtime.execute(
		{
			body: input.source,
			contentType: input.contentType,
			cursor: input.cursor,
			key: input.key,
			limit: input.limit,
			metadata: input.metadata,
			op: input.op,
			prefix: input.prefix,
		},
		OVERLAY_PRINCIPAL,
	);
}

export function wrapStorageModuleWithRuntime<T extends object>(
	module: T,
	runtime: StorageRuntime,
): T {
	const storage = module as T & {
		file?: {
			delete?: (input: unknown) => Promise<unknown>;
			get?: (input: unknown) => Promise<unknown>;
			list?: (input?: unknown) => Promise<unknown>;
			upload?: (input: unknown) => Promise<unknown>;
		};
	};
	if (!storage.file) {
		return module;
	}
	const file = storage.file;
	return {
		...storage,
		file: {
			...file,
			async head(input: unknown) {
				const result = await executeStorageOverlay(runtime, {
					key: readKey(input),
					op: "head",
				});
				if (!result.ok) {
					throw new Error(result.error?.message ?? "storage head denied");
				}
				return result.data;
			},
			async delete(input: unknown) {
				const result = await executeStorageOverlay(runtime, {
					key: readKey(input),
					op: "delete",
				});
				if (!result.ok) {
					throw new Error(result.error?.message ?? "storage delete denied");
				}
				return result.data;
			},
			async get(input: unknown) {
				const result = await executeStorageOverlay(runtime, {
					key: readKey(input),
					op: "get",
				});
				if (!result.ok) {
					throw new Error(result.error?.message ?? "storage get denied");
				}
				return result.data;
			},
			async list(input?: unknown) {
				const result = await executeStorageOverlay(runtime, {
					cursor: readCursor(input),
					limit: readLimit(input),
					op: "list",
					prefix: readPrefix(input),
				});
				if (!result.ok) {
					throw new Error(result.error?.message ?? "storage list denied");
				}
				return result.data;
			},
			async upload(input: unknown) {
				const result = await executeStorageOverlay(runtime, {
					contentType: readContentType(input),
					key: readKey(input),
					metadata: readMetadata(input),
					op: "put",
					source: readSource(input),
				});
				if (!result.ok) {
					throw new Error(result.error?.message ?? "storage upload denied");
				}
				return result.data;
			},
		},
	};
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

function readKey(input: unknown): string | undefined {
	if (typeof input === "string" && input.trim()) {
		return input;
	}
	const record = asRecord(input);
	const key = record.storage_key ?? record.storageKey ?? record.key ?? record.name;
	return typeof key === "string" && key.trim() ? key : undefined;
}

function readPrefix(input: unknown): string | undefined {
	const record = asRecord(input);
	return typeof record.prefix === "string" ? record.prefix : undefined;
}

function readSource(input: unknown): Uint8Array | string | undefined {
	if (input instanceof Uint8Array || typeof input === "string") {
		return input;
	}
	const record = asRecord(input);
	const source = record.source ?? record.body ?? record.files ?? record.bytes;
	if (source instanceof Uint8Array || typeof source === "string") {
		return source;
	}
	return undefined;
}

function readContentType(input: unknown): string | undefined {
	const record = asRecord(input);
	return typeof record.contentType === "string" ? record.contentType : undefined;
}

function readMetadata(input: unknown): Record<string, string> | undefined {
	const record = asRecord(input);
	const metadata = record.metadata;
	if (!metadata || typeof metadata !== "object") {
		return undefined;
	}
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(
		metadata as Record<string, unknown>,
	)) {
		if (typeof value === "string") {
			out[key] = value;
		}
	}
	return out;
}

function readCursor(input: unknown): string | undefined {
	const record = asRecord(input);
	return typeof record.cursor === "string" ? record.cursor : undefined;
}

function readLimit(input: unknown): number | undefined {
	const record = asRecord(input);
	return typeof record.limit === "number" ? record.limit : undefined;
}
