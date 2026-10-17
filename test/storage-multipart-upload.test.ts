import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { putDirectStorageUploadBody } from "../src/storage/direct-upload.ts";
import {
  type AthenaStorageFileBaseModule,
  type AthenaStorageMultipartClient,
  createStorageFileModule,
  DEFAULT_MULTIPART_PART_SIZE_BYTES,
  DEFAULT_MULTIPART_THRESHOLD_BYTES,
} from "../src/storage/file.ts";
import type {
  AthenaStorageDirectUploadConfig,
  StorageFileMutationResponse,
  StorageUploadUrlResponse,
} from "../src/storage/module.ts";

describe("storage direct upload body hashing", () => {
  it("hashes Blob bodies in bounded chunks", async () => {
    const chunkSize = 4 * 1024 * 1024;
    const body = new Blob([new Uint8Array(chunkSize * 2 + 17)]);
    const expectedPayloadHash = Buffer.from(
      await crypto.subtle.digest("SHA-256", await body.arrayBuffer())
    ).toString("hex");
    const readSizes: number[] = [];
    const originalArrayBuffer = Blob.prototype.arrayBuffer;
    const originalFetch = globalThis.fetch;
    let sentPayloadHash: string | null = null;
    Blob.prototype.arrayBuffer = async function () {
      readSizes.push(this.size);
      return originalArrayBuffer.call(this);
    };
    globalThis.fetch = (async (_input, init) => {
      sentPayloadHash = new Headers(init?.headers).get("x-amz-content-sha256");
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    try {
      await putDirectStorageUploadBody(
        {
          accessKeyId: "access-key",
          bucket: "bucket",
          endpoint: "https://storage.example.test",
          secretAccessKey: "secret-key",
        } satisfies AthenaStorageDirectUploadConfig,
        "bucket",
        "large.bin",
        body,
        {},
        undefined,
        () => {}
      );

      assert.equal(
        readSizes.reduce((total, size) => total + size, 0),
        body.size
      );
      assert.ok(Math.max(...readSizes) <= chunkSize);
      assert.equal(readSizes.length, 3);
      assert.equal(sentPayloadHash, expectedPayloadHash);
    } finally {
      Blob.prototype.arrayBuffer = originalArrayBuffer;
      globalThis.fetch = originalFetch;
    }
  });

  it("stops hashing a Blob after upload cancellation", async () => {
    const controller = new AbortController();
    const body = new Blob([new Uint8Array(4 * 1024 * 1024 + 1)]);
    const originalArrayBuffer = Blob.prototype.arrayBuffer;
    const originalFetch = globalThis.fetch;
    let hashReads = 0;
    let fetchCalls = 0;
    Blob.prototype.arrayBuffer = async function () {
      hashReads += 1;
      const result = await originalArrayBuffer.call(this);
      controller.abort();
      return result;
    };
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    try {
      await assert.rejects(
        () =>
          putDirectStorageUploadBody(
            {
              accessKeyId: "access-key",
              bucket: "bucket",
              endpoint: "https://storage.example.test",
              secretAccessKey: "secret-key",
            } satisfies AthenaStorageDirectUploadConfig,
            "bucket",
            "large.bin",
            body,
            {},
            controller.signal,
            () => {}
          ),
        { name: "AbortError" }
      );
      assert.equal(hashReads, 1);
      assert.equal(fetchCalls, 0);
    } finally {
      Blob.prototype.arrayBuffer = originalArrayBuffer;
      globalThis.fetch = originalFetch;
    }
  });
});

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
      init?: RequestInit
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

  it("keeps direct-upload mode on multipart for threshold-sized files", async () => {
    let multipartCalls = 0;
    const base: AthenaStorageFileBaseModule = {
      async createStorageUploadUrl(input) {
        const file = createManagedFile(
          "direct-multipart-file",
          input.storage_key
        );
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
            url: "https://example.test/unused-single-put",
          },
        };
      },
      async createStorageUploadUrls() {
        throw new Error("unused");
      },
      async deleteStorageFile() {
        return { file: createManagedFile("deleted", "deleted") };
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
        return { file: createManagedFile(input.file_id, "direct.bin") };
      },
      async create() {
        multipartCalls += 1;
        return { upload_id: "upload-direct" };
      },
      async signPart() {
        return { headers: {}, url: "https://example.test/part" };
      },
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(null, {
        headers: { ETag: '"part"' },
        status: 200,
      })) as typeof fetch;
    try {
      const file = createStorageFileModule(
        base,
        {
          directUpload: {
            accessKeyId: "a",
            bucket: "b",
            endpoint: "https://example.test",
            region: "auto",
            secretAccessKey: "s",
          },
        } as never,
        multipart
      );
      await file.upload({
        files: new Uint8Array([1, 2]),
        multipartPartSizeBytes: 5 * 1024 * 1024,
        multipartThresholdBytes: 1,
        s3_id: "catalog-1",
      });
      assert.equal(multipartCalls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("cleans known pending file records and reports completed files on batch failure", async () => {
    const deleted: string[] = [];
    const cleanupSignals: (AbortSignal | undefined)[] = [];
    const controller = new AbortController();
    let puts = 0;
    const base: AthenaStorageFileBaseModule = {
      async createStorageUploadUrl(input) {
        const file = createManagedFile(input.storage_key, input.storage_key);
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
            url: `https://example.test/${input.storage_key}`,
          },
        };
      },
      async createStorageUploadUrls(input) {
        return {
          files: await Promise.all(
            input.files.map((entry) => this.createStorageUploadUrl(entry))
          ),
        };
      },
      async deleteStorageFile(fileId, options) {
        deleted.push(fileId);
        cleanupSignals.push(options?.signal);
        return { file: createManagedFile(fileId, fileId) };
      },
      async getStorageFileProxy() {
        throw new Error("unused");
      },
      async listStorageFiles() {
        throw new Error("unused");
      },
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      puts += 1;
      if (puts === 2) {
        controller.abort();
        throw new Error("second upload failed");
      }
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    try {
      const file = createStorageFileModule(base);
      await assert.rejects(
        file.upload(
          {
            files: [new Blob(["a"]), new Blob(["b"])],
            maxFiles: 2,
            s3_id: "catalog-1",
          },
          { signal: controller.signal }
        ),
        (error: unknown) => {
          assert.match(
            error instanceof Error ? error.message : String(error),
            /second upload failed/
          );
          assert.deepEqual((error as { uploaded?: string[] }).uploaded, [
            "file-1",
          ]);
          return true;
        }
      );
      assert.deepEqual(deleted, ["file-2"]);
      assert.deepEqual(cleanupSignals, [undefined]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("aborts canceled multipart uploads without the canceled signal", async () => {
    const controller = new AbortController();
    const cleanupSignals: (AbortSignal | undefined)[] = [];
    const base: AthenaStorageFileBaseModule = {
      async createStorageUploadUrl(input) {
        const file = createManagedFile("file-canceled", input.storage_key);
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
            url: "https://example.test/unused",
          },
        };
      },
      async createStorageUploadUrls() {
        throw new Error("unused");
      },
      async deleteStorageFile(fileId, options) {
        cleanupSignals.push(options?.signal);
        return { file: createManagedFile(fileId, fileId) };
      },
      async getStorageFileProxy() {
        throw new Error("unused");
      },
      async listStorageFiles() {
        throw new Error("unused");
      },
    };
    const multipart: AthenaStorageMultipartClient = {
      async abort(_input, options) {
        cleanupSignals.push(options?.signal);
        return { aborted: true };
      },
      async complete() {
        throw new Error("unused");
      },
      async create() {
        return { upload_id: "upload-canceled" };
      },
      async signPart() {
        return { headers: {}, url: "https://example.test/part" };
      },
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input, init) => {
      assert.equal(init?.signal, controller.signal);
      controller.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    }) as typeof fetch;

    try {
      const file = createStorageFileModule(base, {}, multipart);
      await assert.rejects(() =>
        file.uploadMultipart(
          {
            files: new Uint8Array([1]),
            multipartPartSizeBytes: 5 * 1024 * 1024,
            s3_id: "catalog-1",
          },
          { signal: controller.signal }
        )
      );
      assert.deepEqual(cleanupSignals, [undefined, undefined]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports multipart successes when a mixed batch single PUT fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/imports/2")) {
        throw new Error("small upload failed");
      }
      return new Response(null, { headers: { ETag: '"part"' }, status: 200 });
    }) as typeof fetch;
    const createUploadUrl = (storageKey: string) => {
      const file = createManagedFile(storageKey, storageKey);
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
          purpose: "upload" as const,
          storage_key: storageKey,
          url: `https://example.test/put/${storageKey}`,
        },
      };
    };
    const base: AthenaStorageFileBaseModule = {
      async createStorageUploadUrl(input) {
        return createUploadUrl(input.storage_key);
      },
      async createStorageUploadUrls(input) {
        return {
          files: input.files.map(({ storage_key }) =>
            createUploadUrl(storage_key)
          ),
        };
      },
      async deleteStorageFile(fileId) {
        return { file: createManagedFile(fileId, fileId) };
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
            ...createManagedFile(input.file_id, "large.bin"),
            status: "uploaded",
          },
        };
      },
      async create() {
        return { upload_id: "upload-mixed" };
      },
      async signPart() {
        return { headers: {}, url: "https://example.test/part" };
      },
    };

    try {
      const file = createStorageFileModule(base, {}, multipart);
      await assert.rejects(
        () =>
          file.upload({
            files: [
              new Blob([new Uint8Array([4])]),
              new Blob([new Uint8Array([1, 2, 3])]),
              new Blob([new Uint8Array([5])]),
            ],
            maxFiles: 3,
            multipartPartSizeBytes: 5 * 1024 * 1024,
            multipartThresholdBytes: 2,
            s3_id: "catalog-1",
            storageKeyTemplate: "imports/{index}",
          }),
        (error: unknown) => {
          assert.match(
            error instanceof Error ? error.message : String(error),
            /small upload failed/
          );
          assert.deepEqual(
            (
              error as { completedFiles?: { storage_key: string }[] }
            ).completedFiles?.map(({ storage_key }) => storage_key),
            ["imports/0", "imports/1"]
          );
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps mixed upload keys, progress indexes, and results in original order", async () => {
    const createdKeys: string[] = [];
    const progress: Array<{
      aggregateLoaded: number;
      aggregateTotal: number;
      fileCount: number;
      fileIndex: number;
      phase: string;
    }> = [];
    const createUploadUrl = (storageKey: string) => {
      createdKeys.push(storageKey);
      const file = createManagedFile(storageKey, storageKey);
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
          purpose: "upload" as const,
          storage_key: storageKey,
          url: `https://example.test/put/${storageKey}`,
        },
      };
    };
    const base: AthenaStorageFileBaseModule = {
      async createStorageUploadUrl(input) {
        return createUploadUrl(input.storage_key);
      },
      async createStorageUploadUrls(input) {
        return {
          files: input.files.map(({ storage_key }) =>
            createUploadUrl(storage_key)
          ),
        };
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
          file: createManagedFile(input.file_id, input.file_id),
        };
      },
      async create() {
        return { upload_id: "upload-mixed-order" };
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
        headers: { ETag: '"part"' },
        status: 200,
      })) as typeof fetch;

    try {
      const file = createStorageFileModule(base, {}, multipart);
      const result = await file.upload({
        files: [
          new Blob([new Uint8Array([1])]),
          new Blob([new Uint8Array([2, 3, 4])]),
          new Blob([new Uint8Array([5])]),
        ],
        maxFiles: 3,
        multipartPartSizeBytes: 5 * 1024 * 1024,
        multipartThresholdBytes: 2,
        onProgress(value) {
          progress.push(value);
        },
        s3_id: "catalog-1",
        storageKeyTemplate: "imports/{index}",
      });

      assert.deepEqual(
        result.files.map(({ storage_key }) => storage_key),
        ["imports/0", "imports/1", "imports/2"]
      );
      assert.deepEqual(
        result.files.map(({ fileName }) => fileName),
        ["file-1", "file-2", "file-3"]
      );
      assert.deepEqual(createdKeys.sort(), [
        "imports/0",
        "imports/1",
        "imports/2",
      ]);
      assert.ok(progress.every((entry) => entry.fileCount === 3));
      assert.ok(progress.every((entry) => entry.aggregateTotal === 5));
      assert.deepEqual(
        [...new Set(progress.map((entry) => entry.fileIndex))].sort(),
        [0, 1, 2]
      );
      assert.equal(progress.at(-1)?.aggregateLoaded, 5);

      const fallbackOffset = createdKeys.length;
      const fallbackResult = await file.upload({
        files: [
          new Blob([new Uint8Array([1])]),
          new Blob([new Uint8Array([2, 3, 4])]),
          new Blob([new Uint8Array([5])]),
        ],
        maxFiles: 3,
        multipartPartSizeBytes: 5 * 1024 * 1024,
        multipartThresholdBytes: 2,
        s3_id: "catalog-1",
      });
      assert.deepEqual(createdKeys.slice(fallbackOffset).sort(), [
        "file-1",
        "file-2",
        "file-3",
      ]);
      assert.deepEqual(
        fallbackResult.files.map(({ storage_key }) => storage_key),
        ["file-1", "file-2", "file-3"]
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns completed multipart files when a later upload URL request fails", async () => {
    let uploadUrlCalls = 0;
    const base: AthenaStorageFileBaseModule = {
      async createStorageUploadUrl(input) {
        uploadUrlCalls += 1;
        if (uploadUrlCalls === 2) {
          throw new Error("second upload URL failed");
        }
        const file = createManagedFile("file-first", "first.bin");
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
            url: `https://example.test/put/${input.storage_key}`,
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
        return { file: createManagedFile(input.file_id, "first.bin") };
      },
      async create() {
        return { upload_id: "upload-first" };
      },
      async signPart() {
        return { headers: {}, url: "https://example.test/part/1" };
      },
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(null, {
        headers: { ETag: '"first-part"' },
        status: 200,
      })) as typeof fetch;

    try {
      const file = createStorageFileModule(base, {}, multipart);
      await assert.rejects(
        () =>
          file.uploadMultipart({
            files: [
              new Blob([new Uint8Array([1])]),
              new Blob([new Uint8Array([2])]),
            ],
            forceMultipart: true,
            maxFiles: 2,
            s3_id: "catalog-1",
            storageKeyTemplate: "batch/{index}",
          }),
        (error: unknown) => {
          assert.equal(
            error instanceof Error ? error.message : String(error),
            "second upload URL failed"
          );
          assert.deepEqual(
            (
              error as { completedFiles?: { storage_key: string }[] }
            ).completedFiles?.map(({ storage_key }) => storage_key),
            ["batch/0"]
          );
          return true;
        }
      );
      assert.equal(uploadUrlCalls, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
