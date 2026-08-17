/**
 * L3a local R2 object I/O subset for edge-local mode.
 * Pure R2 does not implement catalogs, backups, multipart, or signed URLs.
 * Hybrid compose overlays L3a helpers onto the full HTTP AthenaStorageModule.
 */

import type { AthenaStorageModule } from "../../storage/module.ts";
import type { R2BucketLike, R2ObjectBodyLike } from "../types.ts";

export interface CloudflareR2StorageOptions {
  /** Key prefix applied to all object keys (trailing slash normalized). */
  prefix?: string;
  r2: R2BucketLike;
}

export type CloudflareR2PutBody =
  | ReadableStream
  | ArrayBuffer
  | ArrayBufferView
  | string
  | Blob
  | null;

export interface CloudflareR2PutObjectInput {
  body: CloudflareR2PutBody;
  contentType?: string;
  key: string;
  metadata?: Record<string, string>;
}

export interface CloudflareR2GetObjectResult {
  body: R2ObjectBodyLike;
  contentType?: string;
  key: string;
  size: number;
}

export interface CloudflareR2ListObjectsInput {
  cursor?: string;
  limit?: number;
  prefix?: string;
}

export interface CloudflareR2ListObjectsResult {
  cursor?: string;
  objects: Array<{ key: string; size: number; etag?: string; uploaded?: Date }>;
  truncated: boolean;
}

/** L3a object methods exposed when an R2 binding is configured. */
export interface CloudflareR2ObjectStorage {
  deleteObject: (input: {
    key: string | string[];
  }) => Promise<{ deleted: string[] }>;
  getObject: (input: {
    key: string;
  }) => Promise<CloudflareR2GetObjectResult | null>;
  listObjects: (
    input?: CloudflareR2ListObjectsInput
  ) => Promise<CloudflareR2ListObjectsResult>;
  putObject: (input: CloudflareR2PutObjectInput) => Promise<{ key: string }>;
}

/**
 * Storage namespace for edge-local R2: full module shape (unsupported methods throw)
 * plus L3a object helpers. Hybrid compose is the same type with real HTTP ports.
 */
export type CloudflareR2StorageModule = AthenaStorageModule &
  CloudflareR2ObjectStorage;

function normalizePrefix(prefix: string | undefined): string {
  if (!prefix?.trim()) {
    return "";
  }
  const normalized = prefix.replace(/^\/+/, "").replace(/\/?$/, "/");
  if (normalized.includes("\0")) {
    throw new Error("storage prefix must not contain null bytes");
  }
  if (normalized.split("/").some((segment) => segment === "..")) {
    throw new Error('storage prefix must not contain ".." path segments');
  }
  return normalized;
}

/**
 * Normalize and validate an object key before joining with the configured prefix.
 * Rejects empty keys, null bytes, and `..` segments so a tenant prefix cannot be
 * escaped via path-like keys (even though R2 treats keys as opaque strings).
 */
function assertSafeObjectKey(key: string): string {
  if (typeof key !== "string" || !key.trim()) {
    throw new Error("Object key is required");
  }
  if (key.includes("\0")) {
    throw new Error("Object key must not contain null bytes");
  }
  const cleaned = key.replace(/^\/+/, "");
  if (!cleaned) {
    throw new Error("Object key is required");
  }
  const segments = cleaned.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new Error('Object key must not contain ".." path segments');
  }
  return cleaned;
}

function joinKey(prefix: string, key: string): string {
  return `${prefix}${assertSafeObjectKey(key)}`;
}

/**
 * Map a physical object key back to the logical key consumers pass in/out.
 * Returned keys must be reusable with getObject/deleteObject without double-prefixing.
 */
function toLogicalKey(prefix: string, physicalKey: string): string {
  if (!prefix) {
    return physicalKey;
  }
  if (physicalKey.startsWith(prefix)) {
    return physicalKey.slice(prefix.length);
  }
  return physicalKey;
}

/**
 * Public API keys are always logical: always join the configured prefix.
 * Never treat an input that happens to start with the prefix as already physical
 * (that would collapse `a.txt` and `tenant/a.txt` onto the same object).
 */
function toPhysicalKey(prefix: string, key: string): string {
  return joinKey(prefix, key);
}

function unsupported(method: string): never {
  throw new Error(
    `storage.${method} is not available in Cloudflare edge-local R2 object mode. ` +
      "Only putObject / getObject / deleteObject / listObjects are supported (L3a)."
  );
}

/**
 * Nested callable so pure-R2 `storage.catalog.list` throws the documented L3a message
 * instead of a TypeError from treating the unsupported stub as a plain function.
 */
function createUnsupportedCallable(path: string): unknown {
  const thrower = (..._args: unknown[]): never => unsupported(path);
  return new Proxy(thrower, {
    apply() {
      return unsupported(path);
    },
    get(target, property) {
      if (property === "then") {
        return;
      }
      if (typeof property === "symbol") {
        return Reflect.get(target, property);
      }
      if (typeof property === "string") {
        return createUnsupportedCallable(`${path}.${property}`);
      }
    },
  });
}

/**
 * L3a object helpers only (no HTTP surface, no unsupported proxy).
 */
export function createCloudflareR2ObjectStorage(
  options: CloudflareR2StorageOptions
): CloudflareR2ObjectStorage {
  const prefix = normalizePrefix(options.prefix);
  const { r2 } = options;

  const putObject = async (input: CloudflareR2PutObjectInput) => {
    const logical = assertSafeObjectKey(input.key);
    const physical = toPhysicalKey(prefix, logical);
    await r2.put(physical, input.body, {
      customMetadata: input.metadata,
      httpMetadata: input.contentType
        ? { contentType: input.contentType }
        : undefined,
    });
    // Return the logical key so put → get/delete round-trips without double-prefix.
    return { key: logical };
  };

  const getObject = async (input: { key: string }) => {
    const logical = assertSafeObjectKey(input.key);
    const physical = toPhysicalKey(prefix, logical);
    const object = await r2.get(physical);
    if (!object) {
      return null;
    }
    return {
      body: object,
      contentType: object.httpMetadata?.contentType,
      key: toLogicalKey(prefix, object.key),
      size: object.size,
    };
  };

  const deleteObject = async (input: { key: string | string[] }) => {
    const logicalKeys = (
      Array.isArray(input.key) ? input.key : [input.key]
    ).map((key) => assertSafeObjectKey(key));
    const physicalKeys = logicalKeys.map((key) => toPhysicalKey(prefix, key));
    await r2.delete(
      physicalKeys.length === 1 ? physicalKeys[0]! : physicalKeys
    );
    return { deleted: logicalKeys };
  };

  const listObjects = async (input?: CloudflareR2ListObjectsInput) => {
    // Empty relative prefix lists under the configured storage prefix only.
    const relative = input?.prefix?.trim()
      ? assertSafeObjectKey(input.prefix)
      : "";
    const listPrefix = `${prefix}${relative}`;
    const listed = await r2.list({
      cursor: input?.cursor,
      limit: input?.limit,
      prefix: listPrefix || undefined,
    });
    return {
      cursor: listed.cursor,
      objects: listed.objects.map((object) => ({
        etag: object.etag,
        key: toLogicalKey(prefix, object.key),
        size: object.size,
        uploaded: object.uploaded,
      })),
      truncated: listed.truncated,
    };
  };

  return {
    deleteObject,
    getObject,
    listObjects,
    putObject,
  };
}

/**
 * Minimal storage surface backed by an R2 binding only.
 * Full AthenaStorageModule methods that need catalogs throw clearly.
 */
export function createCloudflareR2StorageModule(
  options: CloudflareR2StorageOptions
): CloudflareR2StorageModule {
  const base = createCloudflareR2ObjectStorage(options);

  return new Proxy(base as CloudflareR2StorageModule, {
    get(target, property, receiver) {
      if (property in target) {
        return Reflect.get(target, property, receiver);
      }
      if (typeof property === "string") {
        return createUnsupportedCallable(property);
      }
    },
  });
}

/**
 * Same-namespace hybrid: HTTP storage.* ports (file/catalog/multipart/backup/…)
 * plus L3a R2 putObject/getObject/deleteObject/listObjects on the same module.
 * R2 L3a wins on the four object helper names if ever present on HTTP.
 */
export function composeHttpAndR2Storage(
  http: AthenaStorageModule,
  options: CloudflareR2StorageOptions
): CloudflareR2StorageModule {
  const r2Objects = createCloudflareR2ObjectStorage(options);
  return {
    ...http,
    ...r2Objects,
  };
}
