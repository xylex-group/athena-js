/**
 * Trusted-Node filesystem ObjectStore behind `athena.storage`.
 *
 * Catalog-optional: keys resolve under a configured root. Unsupported
 * control-plane ops throw `ATHENA_STORAGE_CAPABILITY_UNSUPPORTED`.
 */

import type { Dirent } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import { AthenaConfigurationError } from "../config/errors.ts";
import {
  ATHENA_STORAGE_CAPABILITY_UNSUPPORTED,
  AthenaStorageCapabilityError,
} from "./errors.ts";
import type { AthenaStorageUploadProgress } from "./file.ts";
import type { AthenaStorageModule } from "./module.ts";
import {
  isFolderPrefixInside,
  joinObjectKey,
  normalizeObjectPrefix,
  renameObjectKey,
  validateFolderSegment,
} from "./object-keys.ts";

export interface AthenaLocalStorageOptions {
  prefix?: string | null;
  root: string;
}

function capabilityError(operation: string): AthenaStorageCapabilityError {
  return new AthenaStorageCapabilityError(operation);
}

function rejectUnsupported(operation: string): Promise<never> {
  return Promise.reject(capabilityError(operation));
}

function unsupportedTree(path: string): unknown {
  const thrower = (): Promise<never> => rejectUnsupported(path);
  return new Proxy(thrower, {
    apply() {
      return rejectUnsupported(path);
    },
    get(target, property) {
      if (property === "then") {
        return;
      }
      if (typeof property === "symbol") {
        return Reflect.get(target, property);
      }
      if (typeof property === "string") {
        return unsupportedTree(`${path}.${property}`);
      }
    },
  });
}

function normalizePrefix(prefix: string | undefined | null): string {
  if (!prefix?.trim()) {
    return "";
  }
  const normalized = prefix.replace(/^\/+/, "").replace(/\/?$/, "/");
  assertSafeObjectKey(normalized.replace(/\/$/, "") || "prefix");
  return normalized;
}

export function assertSafeObjectKey(key: string): string {
  if (typeof key !== "string" || !key.trim()) {
    throw new Error("Object key is invalid: key is required");
  }
  if (key.includes("\0")) {
    throw new Error("Object key is invalid: must not contain null bytes");
  }
  if (/^[a-zA-Z]:[\\/]/.test(key)) {
    throw new Error("Object key is invalid: must not be an absolute path");
  }
  if (key.startsWith("/") || key.startsWith("\\")) {
    throw new Error("Object key is invalid: must not be an absolute path");
  }
  const cleaned = key.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned) {
    throw new Error("Object key is invalid: key is required");
  }
  const segments = cleaned.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new Error('Object key must not contain ".." path segments');
  }
  return segments.filter((segment) => segment && segment !== ".").join("/");
}

function resolveUnderRoot(
  root: string,
  key: string
): { abs: string; key: string } {
  const logical = assertSafeObjectKey(key);
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, ...logical.split("/"));
  const rel = relative(resolvedRoot, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Object key escapes storage root");
  }
  const rootPrefix = resolvedRoot.endsWith(sep)
    ? resolvedRoot
    : `${resolvedRoot}${sep}`;
  if (target !== resolvedRoot && !target.startsWith(rootPrefix)) {
    throw new Error("Object key escapes storage root");
  }
  return { abs: target, key: logical };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
}

function readString(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  if (!record) {
    return;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
}

async function toBytes(value: unknown): Promise<Uint8Array> {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer());
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const candidate of [
      record.body,
      record.bytes,
      record.data,
      record.content,
      record.files,
    ]) {
      if (candidate !== undefined && candidate !== value) {
        return toBytes(candidate);
      }
    }
  }
  throw new Error("storage.file.upload requires file bytes");
}

function isBinarySource(value: unknown): boolean {
  return (
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    (typeof Blob !== "undefined" && value instanceof Blob) ||
    typeof value === "string"
  );
}

function isFileListLike(value: unknown): value is ArrayLike<unknown> {
  if (Array.isArray(value)) {
    return true;
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as { item?: unknown; length?: unknown };
  return (
    typeof record.length === "number" &&
    Number.isFinite(record.length) &&
    record.length >= 0
  );
}

function fileNameOf(source: unknown, fallback: string): string {
  if (source && typeof source === "object" && "name" in source) {
    const name = (source as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) {
      return name.trim();
    }
  }
  return fallback;
}

function sourceSizeOf(source: unknown): number {
  if (source instanceof Uint8Array) {
    return source.byteLength;
  }
  if (source instanceof ArrayBuffer) {
    return source.byteLength;
  }
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    return source.size;
  }
  return 0;
}

function readOnProgress(
  input: unknown
): ((progress: AthenaStorageUploadProgress) => void) | undefined {
  const record = asRecord(input);
  const onProgress = record?.onProgress;
  return typeof onProgress === "function"
    ? (onProgress as (progress: AthenaStorageUploadProgress) => void)
    : undefined;
}

function readPrefixPath(input: unknown): string {
  const record = asRecord(input);
  const prefix = record?.prefixPath ?? record?.prefix;
  return typeof prefix === "string" ? prefix : "";
}

function progressSnapshot(
  phase: AthenaStorageUploadProgress["phase"],
  files: readonly { fileName: string; sizeBytes: number }[],
  fileIndex: number,
  loaded: number,
  aggregateLoaded: number
): AthenaStorageUploadProgress {
  const total = files[fileIndex]?.sizeBytes ?? 0;
  const aggregateTotal = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  return {
    aggregateLoaded,
    aggregatePercent:
      aggregateTotal > 0
        ? Math.round((aggregateLoaded / aggregateTotal) * 100)
        : 100,
    aggregateTotal,
    fileCount: files.length,
    fileIndex,
    fileName: files[fileIndex]?.fileName ?? "",
    loaded,
    percent: total > 0 ? Math.round((loaded / total) * 100) : 100,
    phase,
    total,
  };
}

function extractUploadSource(input: unknown): unknown {
  if (isBinarySource(input)) {
    return input;
  }
  const record = asRecord(input);
  if (!record) {
    return input;
  }
  const files = record.files;
  if (isBinarySource(files)) {
    return files;
  }
  if (Array.isArray(files)) {
    return files[0];
  }
  return record.source ?? record.body ?? files ?? input;
}

function extractKey(input: unknown, fallback?: string): string {
  if (typeof input === "string") {
    return input;
  }
  const record = asRecord(input);
  const key =
    readString(record, "storage_key", "storageKey", "key") ?? fallback;
  if (!key) {
    throw new Error("storage key is required");
  }
  return key;
}

function applyPrefix(prefix: string, key: string): string {
  if (!prefix) {
    return key;
  }
  return `${prefix}${key}`;
}

function stripPrefix(prefix: string, key: string): string {
  if (prefix && key.startsWith(prefix)) {
    return key.slice(prefix.length);
  }
  return key;
}

async function collectFiles(
  root: string,
  dir: string
): Promise<Array<{ abs: string; key: string; size: number }>> {
  const out: Array<{ abs: string; key: string; size: number }> = [];
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code === "ENOENT") {
      return out;
    }
    throw error;
  }
  for (const entry of entries) {
    const full = `${dir}${sep}${entry.name}`;
    if (entry.isDirectory()) {
      const rel = relative(root, full).split(sep).join("/");
      if (rel) {
        out.push({ abs: full, key: `${rel}/`, size: 0 });
      }
      out.push(...(await collectFiles(root, full)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const info = await stat(full);
    const rel = relative(root, full).split(sep).join("/");
    out.push({ abs: full, key: rel, size: info.size });
  }
  return out;
}

export function createLocalStorageModule(
  options: AthenaLocalStorageOptions
): AthenaStorageModule {
  const root = options.root?.trim();
  if (!root) {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      'storage.provider "local" requires a filesystem root.',
      "storage"
    );
  }
  const resolvedRoot = resolve(root);
  const prefix = normalizePrefix(options.prefix);

  const putBytes = async (logicalKey: string, body: Uint8Array) => {
    const prefixed = applyPrefix(prefix, assertSafeObjectKey(logicalKey));
    const dest = resolveUnderRoot(resolvedRoot, prefixed);
    await mkdir(dirname(dest.abs), { recursive: true });
    await writeFile(dest.abs, body);
    return dest;
  };

  const putOne = async (
    key: string,
    source: unknown,
    fileName: string,
    contentType?: string
  ) => {
    const bytes = await toBytes(source);
    const dest = await putBytes(key, bytes);
    const logical = stripPrefix(prefix, dest.key);
    const now = new Date().toISOString();
    const name = fileName || basename(logical);
    return {
      file: {
        bucket: "local",
        content_type: contentType ?? null,
        created_at: now,
        id: logical,
        is_public: false,
        metadata: {},
        name,
        size_bytes: bytes.byteLength,
        status: "ready",
        storage_key: logical,
        updated_at: now,
      },
      fileName: name,
      storage_key: logical,
    };
  };

  const upload = async (input: unknown) => {
    const record = asRecord(input);
    const filesField = record?.files;
    const onProgress = readOnProgress(input);
    if (isFileListLike(filesField) && !isBinarySource(filesField)) {
      const prefixPath = readPrefixPath(input);
      const sources = Array.from(filesField);
      if (sources.length === 0) {
        throw new Error("storage.file.upload requires at least one file");
      }
      const described = sources.map((source, index) => ({
        fileName: fileNameOf(source, `file-${index + 1}`),
        sizeBytes: sourceSizeOf(source),
        source,
      }));
      onProgress?.(progressSnapshot("preparing", described, 0, 0, 0));
      const uploaded: Array<Awaited<ReturnType<typeof putOne>>> = [];
      let aggregateLoaded = 0;
      for (let index = 0; index < described.length; index += 1) {
        const item = described[index];
        if (!item) {
          continue;
        }
        onProgress?.(
          progressSnapshot("uploading", described, index, 0, aggregateLoaded)
        );
        const key = joinObjectKey(prefixPath, item.fileName);
        const result = await putOne(
          key,
          item.source,
          item.fileName,
          readString(record, "contentType", "content_type", "mime_type")
        );
        aggregateLoaded += item.sizeBytes;
        onProgress?.(
          progressSnapshot(
            "uploading",
            described,
            index,
            item.sizeBytes,
            aggregateLoaded
          )
        );
        uploaded.push(result);
      }
      onProgress?.(
        progressSnapshot(
          "complete",
          described,
          described.length - 1,
          described[described.length - 1]?.sizeBytes ?? 0,
          aggregateLoaded
        )
      );
      return {
        count: uploaded.length,
        files: uploaded,
        storage_key: uploaded[0]?.storage_key,
      };
    }
    const key = extractKey(input);
    const bytesSource = extractUploadSource(input);
    const name =
      readString(record, "name", "fileName", "original_name") ?? basename(key);
    const contentType = readString(record, "content_type", "mime_type");
    onProgress?.(
      progressSnapshot(
        "preparing",
        [{ fileName: name, sizeBytes: sourceSizeOf(bytesSource) }],
        0,
        0,
        0
      )
    );
    const uploaded = await putOne(key, bytesSource, name, contentType);
    onProgress?.(
      progressSnapshot(
        "complete",
        [{ fileName: name, sizeBytes: uploaded.file.size_bytes }],
        0,
        uploaded.file.size_bytes,
        uploaded.file.size_bytes
      )
    );
    return {
      count: 1,
      files: [uploaded],
      storage_key: uploaded.storage_key,
    };
  };

  const head = async (input: unknown) => {
    const logical = assertSafeObjectKey(extractKey(input));
    const dest = resolveUnderRoot(resolvedRoot, applyPrefix(prefix, logical));
    try {
      const info = await stat(dest.abs);
      if (!info.isFile()) {
        throw new Error(`Object not found: ${logical}`);
      }
      return {
        key: logical,
        size: info.size,
        storage_key: logical,
      };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code: unknown }).code === "ENOENT"
      ) {
        throw new Error(`Object not found: ${logical}`);
      }
      throw error;
    }
  };

  const get = async (input: unknown) => {
    const logical = assertSafeObjectKey(extractKey(input));
    const dest = resolveUnderRoot(resolvedRoot, applyPrefix(prefix, logical));
    try {
      return new Uint8Array(await readFile(dest.abs));
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code: unknown }).code === "ENOENT"
      ) {
        throw new Error(`Object not found: ${logical}`);
      }
      throw error;
    }
  };

  const remove = async (input: unknown) => {
    const logical = assertSafeObjectKey(extractKey(input));
    const dest = resolveUnderRoot(resolvedRoot, applyPrefix(prefix, logical));
    await rm(dest.abs, { force: true, recursive: true });
    return { deleted: true, storage_key: logical };
  };

  const moveFile = async (input: unknown) => {
    const record = asRecord(input);
    const from = assertSafeObjectKey(
      readString(record, "from", "from_key", "source_key", "key") ?? ""
    );
    const to = assertSafeObjectKey(
      readString(record, "to", "to_key", "destination_key") ?? ""
    );
    const fromDest = resolveUnderRoot(resolvedRoot, applyPrefix(prefix, from));
    const toDest = resolveUnderRoot(resolvedRoot, applyPrefix(prefix, to));
    await mkdir(dirname(toDest.abs), { recursive: true });
    await rename(fromDest.abs, toDest.abs);
    return { from, storage_key: to, to };
  };

  const renameFile = async (input: unknown) => {
    const record = asRecord(input);
    const key = assertSafeObjectKey(
      readString(record, "key", "from", "storage_key") ?? ""
    );
    const name = readString(record, "name", "to", "newName");
    if (!name) {
      throw new Error("storage.file.rename requires name");
    }
    const to = renameObjectKey(key, name, false);
    return moveFile({ from: key, to });
  };

  const createFolder = async (input: unknown) => {
    const record = asRecord(input);
    const name = readString(record, "name");
    const parent = readPrefixPath(input) || readString(record, "prefix") || "";
    const rawPrefix = name
      ? joinObjectKey(parent, validateFolderSegment(name))
      : (readString(record, "prefix", "key", "path") ?? "");
    const folderPrefix = normalizeObjectPrefix(rawPrefix);
    const dest = resolveUnderRoot(
      resolvedRoot,
      applyPrefix(prefix, assertSafeObjectKey(folderPrefix.replace(/\/$/, "")))
    );
    await mkdir(dest.abs, { recursive: true });
    return { created: true, prefix: folderPrefix };
  };

  const deleteFolder = async (input: unknown) => {
    const record = asRecord(input);
    const folderPrefix = normalizeObjectPrefix(
      readString(record, "prefix", "key", "from_prefix") ?? ""
    );
    const dest = resolveUnderRoot(
      resolvedRoot,
      applyPrefix(prefix, assertSafeObjectKey(folderPrefix.replace(/\/$/, "")))
    );
    await rm(dest.abs, { force: true, recursive: true });
    return { deleted: true, prefix: folderPrefix };
  };

  const moveFolder = async (input: unknown) => {
    const record = asRecord(input);
    const from = normalizeObjectPrefix(
      readString(record, "from", "from_prefix", "prefix") ?? ""
    );
    const to = normalizeObjectPrefix(
      readString(record, "to", "to_prefix", "destination") ?? ""
    );
    if (!(from && to)) {
      throw new Error("storage.folder.move requires from and to prefixes");
    }
    if (isFolderPrefixInside(from, to)) {
      throw new Error("Cannot move a folder into itself");
    }
    const fromDest = resolveUnderRoot(
      resolvedRoot,
      applyPrefix(prefix, assertSafeObjectKey(from.replace(/\/$/, "")))
    );
    const toDest = resolveUnderRoot(
      resolvedRoot,
      applyPrefix(prefix, assertSafeObjectKey(to.replace(/\/$/, "")))
    );
    await mkdir(dirname(toDest.abs), { recursive: true });
    await rename(fromDest.abs, toDest.abs);
    return { from, prefix: to, to };
  };

  const renameFolder = async (input: unknown) => {
    const record = asRecord(input);
    const from = normalizeObjectPrefix(
      readString(record, "from", "from_prefix", "prefix", "key") ?? ""
    );
    const name = readString(record, "name", "to");
    const explicitTo = readString(record, "to_prefix", "to");
    const to = explicitTo
      ? normalizeObjectPrefix(explicitTo)
      : renameObjectKey(from, validateFolderSegment(name ?? ""), true);
    return moveFolder({ from, to });
  };

  const list = async (input?: unknown) => {
    const record = asRecord(input);
    const rawPrefix = readString(record, "prefix") ?? "";
    const filter = rawPrefix ? assertSafeObjectKey(rawPrefix) : "";
    const files = await collectFiles(resolvedRoot, resolvedRoot);
    const listed = files
      .map((file) => ({
        ...file,
        key: stripPrefix(prefix, file.key),
      }))
      .filter((file) => {
        if (prefix && !file.key && file.key !== "") {
          return false;
        }
        if (!filter) {
          return true;
        }
        return (
          file.key === filter ||
          file.key.startsWith(`${filter}/`) ||
          file.key.startsWith(filter)
        );
      })
      .map((file) => ({
        id: file.key,
        name: basename(file.key.replace(/\/$/, "")),
        size_bytes: file.size,
        storage_key: file.key,
      }))
      .sort((left, right) =>
        left.storage_key < right.storage_key
          ? -1
          : left.storage_key > right.storage_key
            ? 1
            : 0
      );
    const cursor = readString(record, "cursor");
    const limitRaw = record?.limit;
    const limit =
      typeof limitRaw === "number" && Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.trunc(limitRaw)
        : undefined;
    let start = 0;
    if (cursor) {
      const exact = listed.findIndex((file) => file.storage_key === cursor);
      if (exact >= 0) {
        start = exact + 1;
      } else {
        const after = listed.findIndex((file) => file.storage_key > cursor);
        start = after >= 0 ? after : listed.length;
      }
    }
    const page =
      limit == null ? listed.slice(start) : listed.slice(start, start + limit);
    const hasMore = limit != null && start + page.length < listed.length;
    const nextCursor =
      hasMore && page.length > 0
        ? page[page.length - 1]?.storage_key
        : undefined;
    return {
      count: page.length,
      files: page,
      ...(typeof nextCursor === "string" ? { cursor: nextCursor } : {}),
    };
  };

  const file = {
    delete: remove,
    get,
    head,
    list,
    move: moveFile,
    rename: renameFile,
    retention: unsupportedTree("file.retention"),
    upload,
    uploadMultipart: () => rejectUnsupported("file.uploadMultipart"),
  };

  const folder = {
    create: createFolder,
    delete: deleteFolder,
    move: moveFolder,
    rename: renameFolder,
  };

  const object = {
    delete: remove,
    folder: {
      create: createFolder,
      delete: deleteFolder,
      rename: renameFolder,
    },
    head,
    list,
    uploadUrl: () => rejectUnsupported("object.uploadUrl"),
    url: () => rejectUnsupported("object.url"),
  };

  const permissions = {
    grant: () => rejectUnsupported("permissions.grant"),
    list: () => rejectUnsupported("permissions.list"),
    revoke: () => rejectUnsupported("permissions.revoke"),
  };

  const base = {
    catalog: unsupportedTree("catalog"),
    connections: unsupportedTree("connections"),
    file,
    files: {
      upload: () => rejectUnsupported("files.upload"),
    },
    folder,
    object,
    permission: unsupportedTree("permission"),
    permissions,
  };

  return new Proxy(base as unknown as AthenaStorageModule, {
    get(target, property, receiver) {
      if (property === ATHENA_STORAGE_CAPABILITY_UNSUPPORTED) {
        return ATHENA_STORAGE_CAPABILITY_UNSUPPORTED;
      }
      if (property in target) {
        return Reflect.get(target, property, receiver);
      }
      if (typeof property === "string") {
        return unsupportedTree(property);
      }
    },
  });
}
