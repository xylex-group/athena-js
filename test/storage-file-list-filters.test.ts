import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type AthenaStorageFileBaseModule,
	createStorageFileModule,
} from "../src/storage/file.ts";
import type { ListStorageFilesRequest } from "../src/storage/module.ts";

/**
 * Regression: filters on file.list must reach POST /storage/files/list.
 * High-level list used to rebuild only { prefix, s3_id }, dropping typed filters.
 */
describe("storage.file.list filter forwarding", () => {
	it("forwards status, limit, bucket and other ListStorageFilesRequest fields", async () => {
		let captured: ListStorageFilesRequest | undefined;

		const base: AthenaStorageFileBaseModule = {
			async createStorageUploadUrl() {
				throw new Error("unused");
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
			async listStorageFiles(input) {
				captured = input;
				return { count: 0, files: [] };
			},
		};

		const file = createStorageFileModule(base, {
			prefixPath: "org/{organization_id}",
		});

		await file.list({
			bucket: "suits-finance",
			content_type: "image/png",
			key_prefix: "exports/",
			limit: 25,
			metadata: { source: "ui" },
			mime_type: "image/png",
			name: "report",
			offset: 50,
			organization_id: "org-1",
			prefix: "invoices",
			resource_id: "res-9",
			s3_id: "catalog-1",
			status: "uploaded",
			visibility: "private",
		});

		assert.ok(captured, "listStorageFiles must be called");
		assert.equal(captured.s3_id, "catalog-1");
		assert.equal(captured.bucket, "suits-finance");
		assert.equal(captured.status, "uploaded");
		assert.equal(captured.limit, 25);
		assert.equal(captured.offset, 50);
		assert.equal(captured.visibility, "private");
		assert.equal(captured.mime_type, "image/png");
		assert.equal(captured.content_type, "image/png");
		assert.equal(captured.name, "report");
		assert.equal(captured.resource_id, "res-9");
		assert.equal(captured.key_prefix, "exports/");
		assert.deepEqual(captured.metadata, { source: "ui" });
		// prefixPath templating still applies; path helpers must not leak into body
		assert.equal(captured.prefix, "org/org-1/invoices");
		assert.equal(
			"organization_id" in captured,
			false,
			"path helper organization_id must not be forwarded",
		);
		assert.equal(
			"prefixPath" in captured,
			false,
			"prefixPath must not be forwarded",
		);
	});
});
