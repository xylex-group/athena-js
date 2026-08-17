/**
 * Shared mocks for SDD dual-suite tests under test/sdd/.
 * Keep thin — characterization suites should not depend on product refactors.
 */
import type {
	D1DatabaseLike,
	D1PreparedStatementLike,
	D1ResultLike,
	R2BucketLike,
} from "../../src/cloudflare/types.ts";

export function createSddMockD1(): D1DatabaseLike {
	return {
		async batch(statements) {
			return Promise.all(statements.map((s) => s.run()));
		},
		async exec() {
			return { count: 0, duration: 0 };
		},
		prepare(): D1PreparedStatementLike {
			const statement: D1PreparedStatementLike = {
				async all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
					return {
						meta: { changes: 0, duration: 1 },
						results: [] as T[],
						success: true,
					};
				},
				bind() {
					return statement;
				},
				async first() {
					return null;
				},
				async run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
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

export type SddMockR2 = R2BucketLike & { objects: Map<string, Uint8Array> };

export function createSddMockR2(): SddMockR2 {
	const objects = new Map<string, Uint8Array>();
	return {
		async delete(keys) {
			for (const key of Array.isArray(keys) ? keys : [keys]) {
				objects.delete(key);
			}
		},
		async get(key) {
			const bytes = objects.get(key);
			if (!bytes) {
				return null;
			}
			return {
				async arrayBuffer() {
					const copy = new Uint8Array(bytes.byteLength);
					copy.set(bytes);
					return copy.buffer;
				},
				async blob() {
					return new Blob([new Uint8Array(bytes)]);
				},
				httpMetadata: { contentType: "text/plain" },
				async json() {
					return JSON.parse(new TextDecoder().decode(bytes));
				},
				key,
				size: bytes.byteLength,
				async text() {
					return new TextDecoder().decode(bytes);
				},
			};
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
