import {
  type CloudflareR2ObjectStorage,
  createCloudflareR2ObjectStorage,
} from "../../../cloudflare/r2/storage.ts";
import type { R2BucketLike } from "../../../cloudflare/types.ts";
import {
  mapProviderFailure,
  storageErrorResult,
  storageOkResult,
} from "../errors.ts";
import type {
  AuthorizedStorageOperation,
  StorageObjectProvider,
} from "../types.ts";

export function createR2StorageProvider(
  r2: R2BucketLike,
  prefix?: string | null
): StorageObjectProvider {
  const objects: CloudflareR2ObjectStorage = createCloudflareR2ObjectStorage({
    prefix: prefix ?? undefined,
    r2,
  });
  return {
    async execute(op: AuthorizedStorageOperation) {
      try {
        switch (op.op) {
          case "put": {
            op.signal?.throwIfAborted();
            if (!op.key?.trim()) {
              return storageErrorResult({
                message: "put requires key",
                source: "runtime",
                status: 400,
              });
            }
            // shortcut: R2 PUT cannot be aborted in flight; upgrade when its API adds signal support.
            const data = await objects.putObject({
              body: op.body ?? new Uint8Array(),
              contentType: op.contentType,
              key: op.key,
              metadata: op.metadata,
              ...(op.ifAbsent ? { ifAbsent: true } : {}),
            });
            return storageOkResult(data);
          }
          case "get": {
            if (!op.key?.trim()) {
              return storageErrorResult({
                message: "get requires key",
                source: "runtime",
                status: 400,
              });
            }
            const object = await objects.getObject({ key: op.key });
            if (!object) {
              return storageErrorResult({
                message: `Object not found: ${op.key}`,
                source: "runtime",
                status: 404,
              });
            }
            const bytes = await readR2Body(object.body);
            return storageOkResult(bytes);
          }
          case "head": {
            if (!op.key?.trim()) {
              return storageErrorResult({
                message: "head requires key",
                source: "runtime",
                status: 400,
              });
            }
            const object = await objects.getObject({ key: op.key });
            if (!object) {
              return storageErrorResult({
                message: `Object not found: ${op.key}`,
                source: "runtime",
                status: 404,
              });
            }
            return storageOkResult({
              contentType: object.contentType,
              etag: object.etag,
              key: object.key,
              metadata: object.metadata,
              size: object.size,
            });
          }
          case "delete": {
            if (!op.key?.trim()) {
              return storageErrorResult({
                message: "delete requires key",
                source: "runtime",
                status: 400,
              });
            }
            const data = await objects.deleteObject({ key: op.key });
            return storageOkResult(data);
          }
          case "list": {
            const data = await objects.listObjects({
              cursor: op.cursor,
              limit: op.limit,
              prefix: op.prefix,
            });
            return storageOkResult(data);
          }
          default:
            return storageErrorResult({
              message: `unsupported op ${String(op.op)}`,
              source: "runtime",
              status: 400,
            });
        }
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code?: unknown }).code === "PreconditionFailed"
        ) {
          return storageErrorResult(
            3006,
            "storage_conflict",
            "Storage destination already exists",
            409
          );
        }
        return mapProviderFailure(error);
      }
    },
  };
}

async function readR2Body(body: {
  arrayBuffer?: () => Promise<ArrayBuffer>;
  text?: () => Promise<string>;
}): Promise<Uint8Array> {
  if (typeof body.arrayBuffer === "function") {
    return new Uint8Array(await body.arrayBuffer());
  }
  if (typeof body.text === "function") {
    return new TextEncoder().encode(await body.text());
  }
  throw new Error("R2 object response did not expose a readable body");
}
