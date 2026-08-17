import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type AthenaStorageFileBaseModule,
	type AthenaStorageMultipartClient,
	createStorageFileModule,
	DEFAULT_MULTIPART_PART_SIZE_BYTES,
	DEFAULT_MULTIPART_THRESHOLD_BYTES,
} from "../src/storage/file.ts";
import type {
	StorageFileMutationResponse,
	StorageUploadUrlResponse,
} from "../src/storage/module.ts";

function createManagedFile(id: string, storageKey: string) {
	return {
		bucket: "suits-finance",
		created_at: new Date().toISOString(),
		id,
		is_public: false,
		metadata: {},
		mime_type: "application/octet-stream",
		name: storageKey,
		original_name: storageKey,
		s3_id: "catalog-1",
		size_bytes: 0,
		status: "pending",
		storage_key: storageKey,
		updated_at: new Date().toISOString(),
	};
}

describe("storage.file.uploadMultipart", () => {
	it("creates, signs parts, completes, and reports progress", async () => {
		const partPuts: Array<{ url: string; size: number }> = [];
		const aborts: string[] = [];
		const progressPhases: string[] = [];

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = String(input);
			const body = init?.body;
			const size =
				body instanceof Blob
					? body.size
					: body instanceof ArrayBuffer
						? body.byteLength
						: body instanceof Uint8Array
							? body.byteLength
							: 0;
			partPuts.push({ size, url });
			return new Response(null, {
				headers: { ETag: `"etag-${partPuts.length}"` },
				status: 200,
			});
		}) as typeof fetch;

		try {
			const base: AthenaStorageFileBaseModule = {
				async createStorageUploadUrl(input) {
					const file = createManagedFile("file-1", input.storage_key);
					return {
						file,
						upload: {
							bucket: "suits-finance",
							cache_hit: false,
							cache_layer: "none",
							expires_at: new Date().toISOString(),
							expires_at_epoch_seconds: 0,
							expires_in: 3600,
							file_id: file.id,
							headers: {},
							purpose: "upload",
							storage_key: input.storage_key,
							url: "https://example.test/put",
						},
					} satisfies StorageUploadUrlResponse;
				},
				async createStorageUploadUrls() {
					throw new Error("unused");
				},
				async deleteStorageFile() {
					throw new Error("unused");
				},
				async getStorageFileProxy() {
					throw new Error("unused");
				},
				async listStorageFiles() {
					throw new Error("unused");
				},
			};

			const multipart: AthenaStorageMultipartClient = {
				async abort(input) {
					aborts.push(input.upload_id);
					return { aborted: true };
				},
				async complete(input) {
					return {
						file: {
							...createManagedFile(input.file_id, "large.bin"),
							size_bytes: DEFAULT_MULTIPART_PART_SIZE_BYTES + 1024,
							status: "uploaded",
						},
					} satisfies StorageFileMutationResponse;
				},
				async create() {
					return { upload_id: "upload-1" };
				},
				async signPart(input) {
					return {
						headers: {},
						url: `https://example.test/part/${input.part_number}`,
					};
				},
			};

			const file = createStorageFileModule(base, {}, multipart);
			const payload = new Uint8Array(DEFAULT_MULTIPART_PART_SIZE_BYTES + 1024);
			const result = await file.uploadMultipart({
				fileName: "large.bin",
				files: payload,
				multipartPartSizeBytes: DEFAULT_MULTIPART_PART_SIZE_BYTES,
				onProgress(progress) {
					progressPhases.push(progress.phase);
				},
				s3_id: "catalog-1",
			});

			assert.equal(result.count, 1);
			assert.equal(result.files[0]?.file.id, "file-1");
			assert.equal(partPuts.length, 2);
			assert.equal(partPuts[0]?.size, DEFAULT_MULTIPART_PART_SIZE_BYTES);
			assert.equal(partPuts[1]?.size, 1024);
			assert.equal(aborts.length, 0);
			assert.ok(progressPhases.includes("preparing"));
			assert.ok(progressPhases.includes("uploading"));
			assert.ok(progressPhases.includes("complete"));
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("auto-routes large uploads through multipart", async () => {
		let multipartCalls = 0;
		const base: AthenaStorageFileBaseModule = {
			async createStorageUploadUrl(input) {
				const file = createManagedFile("file-2", input.storage_key);
				return {
					file,
					upload: {
						bucket: "suits-finance",
						cache_hit: false,
						cache_layer: "none",
						expires_at: new Date().toISOString(),
						expires_at_epoch_seconds: 0,
						expires_in: 3600,
						file_id: file.id,
						headers: {},
						purpose: "upload",
						storage_key: input.storage_key,
						url: "https://example.test/put",
					},
				};
			},
			async createStorageUploadUrls() {
				throw new Error("unused");
			},
			async deleteStorageFile() {
				throw new Error("unused");
			},
			async getStorageFileProxy() {
				throw new Error("unused");
			},
			async listStorageFiles() {
				throw new Error("unused");
			},
		};
		const multipart: AthenaStorageMultipartClient = {
			async abort() {
				return { aborted: true };
			},
			async complete(input) {
				return {
					file: {
						...createManagedFile(input.file_id, "huge.bin"),
						size_bytes: DEFAULT_MULTIPART_THRESHOLD_BYTES,
						status: "uploaded",
					},
				};
			},
			async create() {
				multipartCalls += 1;
				return { upload_id: "upload-2" };
			},
			async signPart(input) {
				return {
					headers: {},
					url: `https://example.test/part/${input.part_number}`,
				};
			},
		};

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(null, {
				headers: { ETag: '"etag"' },
				status: 200,
			})) as typeof fetch;

		try {
			const file = createStorageFileModule(base, {}, multipart);
			await file.upload({
				fileName: "huge.bin",
				files: new Uint8Array(DEFAULT_MULTIPART_THRESHOLD_BYTES),
				s3_id: "catalog-1",
			});
			assert.equal(multipartCalls, 1);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
