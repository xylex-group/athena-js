import type { AthenaRuntimeDiscoveryEndpoints } from "../../gateway/discovery-types.ts";
import { DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT } from "../../runtime/data/discovery-document.ts";
import { storageErrorResult, storageOkResult } from "./errors.ts";
import type {
	AuthorizedStorageOperation,
	StorageObjectProvider,
} from "./types.ts";

export function resolveBrowserStorageEndpoint(
	endpoints?:
		| Pick<AthenaRuntimeDiscoveryEndpoints, "storage">
		| { storage?: string },
): string {
	const advertised = endpoints?.storage?.trim();
	return advertised || DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT;
}

export function createEmbeddedStorageFacade(): {
	file: {
		delete: (input: unknown) => Promise<unknown>;
		get: (input: unknown) => Promise<unknown>;
		head: (input: unknown) => Promise<unknown>;
		list: (input?: unknown) => Promise<unknown>;
		upload: (input: unknown) => Promise<unknown>;
	};
} {
	const unused = (): Promise<unknown> =>
		Promise.reject(
			new Error("Athena embedded storage facade must be wrapped by StorageRuntime"),
		);
	return {
		file: {
			delete: unused,
			get: unused,
			head: unused,
			list: unused,
			upload: unused,
		},
	};
}

export function createBrowserStorageTransport(options?: {
	baseUrl?: string;
	endpoints?: { storage?: string };
	fetch?: typeof fetch;
	headers?: Record<string, string>;
}): StorageObjectProvider {
	const fetchImpl = options?.fetch ?? fetch;
	const extraHeaders = options?.headers ?? {};
	const root = options?.baseUrl?.replace(/\/+$/, "") ?? "";
	const explicit = options?.endpoints?.storage?.trim();
	let resolved:
		| { kind: "path"; path: string }
		| { kind: "absolute"; url: string }
		| { kind: "missing" }
		| undefined = explicit
		? parseEndpoint(explicit)
		: undefined;

	function joinPath(path: string): string {
		if (/^https?:\/\//i.test(path)) {
			return path;
		}
		const prefixed = path.startsWith("/") ? path : `/${path}`;
		if (root) {
			return `${root}${prefixed}`;
		}
		const origin =
			(globalThis as { location?: { origin?: string } }).location?.origin ??
			(
				globalThis as { window?: { location?: { origin?: string } } }
			).window?.location?.origin;
		if (origin) {
			return `${origin.replace(/\/+$/, "")}${prefixed}`;
		}
		return `http://localhost${prefixed}`;
	}

	async function resolveUrl(): Promise<string> {
		if (resolved?.kind === "missing") {
			throw new Error("storage runtime is not configured");
		}
		if (resolved?.kind === "absolute") {
			return resolved.url;
		}
		if (resolved?.kind === "path") {
			return joinPath(resolved.path);
		}
		const fallback = DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT;
		const probe = joinPath(fallback);
		const response = await fetchImpl(probe, {
			credentials: "same-origin",
			headers: {
				accept: "application/json",
				...extraHeaders,
			},
			method: "GET",
		});
		const json = (await response.json().catch(() => undefined)) as
			| { endpoints?: { storage?: string } }
			| undefined;
		const advertised = json?.endpoints?.storage?.trim();
		if (advertised) {
			resolved = parseEndpoint(advertised);
			return resolveUrl();
		}
		if (response.ok && json && json.endpoints && json.endpoints.storage == null) {
			resolved = { kind: "missing" };
			throw new Error("storage runtime is not configured");
		}
		resolved = { kind: "path", path: fallback };
		return probe;
	}

	return {
		async execute(op: AuthorizedStorageOperation) {
			let url: string;
			try {
				url = await resolveUrl();
			} catch (error) {
				return storageErrorResult(
					3007,
					"storage_unavailable",
					error instanceof Error ? error.message : "storage runtime is not configured",
					503,
				);
			}
			const response = await fetchImpl(url, {
				body: JSON.stringify({
					operation: op.op,
					payload: {
						body: op.body ? bytesToBase64(op.body) : undefined,
						contentType: op.contentType,
						cursor: op.cursor,
						key: op.key,
						limit: op.limit,
						metadata: op.metadata,
						prefix: op.prefix,
					},
				}),
				credentials: "same-origin",
				headers: {
					"content-type": "application/json",
					...extraHeaders,
				},
				method: "POST",
			});
			const json = (await response.json().catch(() => undefined)) as
				| {
						data?: unknown;
						error?: { errorNumber?: number; message?: string };
						ok?: boolean;
						status?: number;
				  }
				| undefined;
			if (!response.ok || json?.ok === false) {
				const status = json?.status ?? response.status;
				const errorNumber =
					json?.error?.errorNumber ??
					(status === 401 || status === 403 ? 3003 : status === 503 ? 3007 : 3010);
				const code =
					status === 401
						? "storage_unauthenticated"
						: status === 403
							? "storage_authorization_denied"
							: status === 503
								? "storage_unavailable"
								: "storage_internal";
				return storageErrorResult(
					errorNumber,
					code,
					json?.error?.message ?? response.statusText,
					status,
				);
			}
			return storageOkResult(json?.data ?? json);
		},
	};
}

function parseEndpoint(
	value: string,
): { kind: "path"; path: string } | { kind: "absolute"; url: string } {
	if (/^https?:\/\//i.test(value)) {
		return { kind: "absolute", url: value };
	}
	return { kind: "path", path: value };
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}
