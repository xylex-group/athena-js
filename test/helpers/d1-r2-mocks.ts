/**
 * Shared D1 / R2 mock bindings with types that satisfy D1DatabaseLike / R2BucketLike.
 */
import type {
	D1DatabaseLike,
	D1PreparedStatementLike,
	D1ResultLike,
	R2BucketLike,
	R2ObjectBodyLike,
} from "../../src/cloudflare/types.ts";

/** Default INTEGER PRIMARY KEY so bounded UPDATE/DELETE mocks resolve identity. */
export const DEFAULT_BOUNDED_IDENTITY_TABLE_INFO = [
	{
		cid: 0,
		dflt_value: null,
		name: "id",
		notnull: 0,
		pk: 1,
		type: "INTEGER",
	},
];

export function createMockD1(store: {
	rowsBySql?: Map<string, unknown[]>;
	inserts?: Array<{ sql: string; params: unknown[] }>;
}): D1DatabaseLike {
	return {
		async batch(
			statements: D1PreparedStatementLike[],
		): Promise<D1ResultLike[]> {
			return Promise.all(statements.map((s) => s.run()));
		},
		async exec() {
			return { count: 0, duration: 0 };
		},
		prepare(query: string): D1PreparedStatementLike {
			let bound: unknown[] = [];
			const statement: D1PreparedStatementLike = {
				async all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
					if (!/^\s*(select|with|pragma|explain)\b/i.test(query)) {
						store.inserts?.push({ params: bound, sql: query });
					}
					if (/PRAGMA\s+table_info/i.test(query)) {
						const override = store.rowsBySql?.get(query);
						const rows = (override ??
							DEFAULT_BOUNDED_IDENTITY_TABLE_INFO) as T[];
						return {
							meta: { changes: 0, duration: 1 },
							results: rows,
							success: true,
						};
					}
					if (/PRAGMA\s+index_list/i.test(query)) {
						const override = store.rowsBySql?.get(query);
						return {
							meta: { changes: 0, duration: 1 },
							results: (override ?? []) as T[],
							success: true,
						};
					}
					const rows = (store.rowsBySql?.get(query) ?? []) as T[];
					return {
						meta: { changes: 1, duration: 1 },
						results: rows,
						success: true,
					};
				},
				bind(...values: unknown[]) {
					bound = values;
					return statement;
				},
				async first<T = Record<string, unknown>>() {
					return null as T | null;
				},
				async run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
					store.inserts?.push({ params: bound, sql: query });
					return {
						meta: { changes: 1, duration: 1 },
						results: [] as T[],
						success: true,
					};
				},
			};
			return statement;
		},
	};
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

export function createMockR2(): R2BucketLike & {
	objects: Map<string, Uint8Array>;
} {
	const objects = new Map<string, Uint8Array>();
	return {
		async delete(keys) {
			for (const key of Array.isArray(keys) ? keys : [keys]) {
				objects.delete(key);
			}
		},
		async get(key): Promise<R2ObjectBodyLike | null> {
			const bytes = objects.get(key);
			if (!bytes) {
				return null;
			}
			const body: R2ObjectBodyLike = {
				async arrayBuffer() {
					return toArrayBuffer(bytes);
				},
				async blob() {
					return new Blob([toArrayBuffer(bytes)]);
				},
				httpMetadata: { contentType: "text/plain" },
				async json<T = unknown>() {
					return JSON.parse(new TextDecoder().decode(bytes)) as T;
				},
				key,
				size: bytes.byteLength,
				async text() {
					return new TextDecoder().decode(bytes);
				},
			};
			return body;
		},
		async list(options) {
			const prefix = options?.prefix ?? "";
			const listed = [...objects.entries()]
				.filter(([key]) => key.startsWith(prefix))
				.map(([key, bytes]) => ({ key, size: bytes.byteLength }));
			return { objects: listed, truncated: false };
		},
		objects,
		async put(key, value) {
			if (typeof value === "string") {
				objects.set(key, new TextEncoder().encode(value));
			} else if (value instanceof Uint8Array) {
				objects.set(key, value);
			} else if (value instanceof ArrayBuffer) {
				objects.set(key, new Uint8Array(value));
			} else {
				objects.set(key, new Uint8Array());
			}
			return { key };
		},
	};
}
