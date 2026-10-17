import { parseAthenaRightKey } from "../../rights/key.ts";
import type { AthenaPrincipal } from "../../runtime/data/principal.ts";
import type { AthenaStorageUploadProgress } from "../file.ts";
import {
  isFolderPrefixInside,
  joinObjectKey,
  normalizeObjectPrefix,
  renameObjectKey,
  validateFolderSegment,
} from "../object-keys.ts";
import {
  AthenaStorageAuthorizationError,
  AthenaStorageError,
  isAthenaStorageAuthorizationError,
} from "./errors.ts";
import type { StorageOverlayInput } from "./overlays.ts";
import type {
  StorageObjectOp,
  StorageObjectResult,
  StorageRuntime,
} from "./types.ts";

const OVERLAY_PRINCIPAL: AthenaPrincipal = {
  authenticated: true,
  grants: [],
  rights: Object.freeze([parseAthenaRightKey("storage.*")]),
  userId: "storage-overlay",
};

async function runOverlay(runtime: StorageRuntime, input: StorageOverlayInput) {
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
      ...(input.ifAbsent ? { ifAbsent: true } : {}),
      signal: input.signal,
    },
    OVERLAY_PRINCIPAL
  );
}

function unwrap(
  result: StorageObjectResult,
  operation: StorageObjectOp
): unknown {
  if (result.ok) {
    return result.data;
  }
  if (result.error && isAthenaStorageAuthorizationError(result.error)) {
    throw new AthenaStorageAuthorizationError({
      missing: result.error.missing,
      operation: result.error.operation,
    });
  }
  throw new AthenaStorageError({
    code: result.error?.code ?? "storage_internal",
    errorNumber: result.error?.errorNumber ?? 3010,
    message: result.error?.message ?? `storage ${operation} denied`,
    status: result.status,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function readString(
  record: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
}

function attachOperationProgress(
  error: unknown,
  progress: Record<string, unknown>
): Error {
  const failure = error instanceof Error ? error : new Error(String(error));
  try {
    Object.assign(failure, progress);
    return failure;
  } catch {
    return Object.assign(new Error(failure.message), progress);
  }
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
  const record = value as { length?: unknown };
  return (
    typeof record.length === "number" &&
    Number.isFinite(record.length) &&
    record.length >= 0
  );
}

export async function coerceStorageBytes(
  value: unknown
): Promise<Uint8Array | string | undefined> {
  if (value instanceof Uint8Array || typeof value === "string") {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer());
  }
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

function listedKeys(data: unknown): string[] {
  if (!data || typeof data !== "object") {
    return [];
  }
  const record = data as Record<string, unknown>;
  const items = record.objects ?? record.files ?? record.items;
  if (!Array.isArray(items)) {
    return [];
  }
  const keys: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const entry = item as Record<string, unknown>;
    const key = entry.key ?? entry.storage_key ?? entry.storageKey;
    if (typeof key === "string" && key.trim()) {
      keys.push(key.trim());
    }
  }
  return keys;
}

function listedCursor(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return;
  }
  const record = data as Record<string, unknown>;
  const cursor = record.cursor ?? record.nextCursor;
  return typeof cursor === "string" && cursor.trim()
    ? cursor.trim()
    : undefined;
}

function listedTruncated(data: unknown): boolean {
  if (!data || typeof data !== "object") {
    return false;
  }
  const record = data as Record<string, unknown>;
  return record.truncated === true || record.IsTruncated === true;
}

async function listAllKeys(
  runtime: StorageRuntime,
  prefix: string
): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  const cursors = new Set<string>();
  for (let page = 0; page < 50; page += 1) {
    const result = await runOverlay(runtime, {
      cursor,
      op: "list",
      prefix: prefix || undefined,
    });
    const data = unwrap(result, "list");
    keys.push(...listedKeys(data));
    const next = listedCursor(data);
    if (!next) {
      if (listedTruncated(data)) {
        throw new Error(
          "Storage folder listing is incomplete: provider marked it truncated without a pagination cursor"
        );
      }
      return keys;
    }
    if (cursors.has(next) || next === cursor) {
      throw new Error(
        "Storage folder listing returned a repeated pagination cursor"
      );
    }
    cursors.add(next);
    cursor = next;
  }
  throw new Error(
    "Storage folder listing is incomplete after 50 pages; no mutation was performed"
  );
}

async function putBytes(
  runtime: StorageRuntime,
  input: {
    contentType?: string;
    ifAbsent?: boolean;
    key: string;
    metadata?: Record<string, string>;
    signal?: AbortSignal;
    source: unknown;
  }
) {
  const source = await coerceStorageBytes(input.source);
  const result = await runOverlay(runtime, {
    contentType: input.contentType,
    key: input.key,
    metadata: input.metadata,
    op: "put",
    ...(input.ifAbsent ? { ifAbsent: true } : {}),
    signal: input.signal,
    source,
  });
  return unwrap(result, "put");
}

export function isHighLevelFileUpload(input: unknown): boolean {
  const record = asRecord(input);
  const files = record.files;
  return isFileListLike(files) && !isBinarySource(files);
}

export async function overlayUploadFiles(
  runtime: StorageRuntime,
  input: unknown,
  options?: { signal?: AbortSignal }
) {
  const record = asRecord(input);
  const filesField = record.files;
  if (!isFileListLike(filesField)) {
    throw new Error("storage.file.upload requires files");
  }
  const sources = Array.from(filesField);
  if (sources.length === 0) {
    throw new Error("storage.file.upload requires at least one file");
  }
  const prefixPath =
    typeof record.prefixPath === "string"
      ? record.prefixPath
      : typeof record.prefix === "string"
        ? record.prefix
        : "";
  const onProgress =
    typeof record.onProgress === "function"
      ? (record.onProgress as (progress: AthenaStorageUploadProgress) => void)
      : undefined;
  const described = sources.map((source, index) => ({
    fileName: fileNameOf(source, `file-${index + 1}`),
    sizeBytes: sourceSizeOf(source),
    source,
  }));
  onProgress?.(progressSnapshot("preparing", described, 0, 0, 0));
  const uploaded: unknown[] = [];
  const uploadedKeys: string[] = [];
  let aggregateLoaded = 0;
  for (let index = 0; index < described.length; index += 1) {
    if (options?.signal?.aborted) {
      const error = new Error("Upload cancelled");
      error.name = "AbortError";
      Object.assign(error, { uploaded: [...uploadedKeys] });
      throw error;
    }
    const item = described[index];
    if (!item) {
      continue;
    }
    onProgress?.(
      progressSnapshot("uploading", described, index, 0, aggregateLoaded)
    );
    const key = joinObjectKey(prefixPath, item.fileName);
    let result: unknown;
    try {
      result = await putBytes(runtime, {
        contentType:
          typeof record.contentType === "string"
            ? record.contentType
            : undefined,
        key,
        signal: options?.signal,
        source: item.source,
      });
    } catch (error) {
      const failure =
        error && typeof error === "object" ? error : new Error(String(error));
      Object.assign(failure, { uploaded: [...uploadedKeys] });
      throw failure;
    }
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
    uploadedKeys.push(key);
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
    uploaded: described.map((item) => joinObjectKey(prefixPath, item.fileName)),
  };
}

export async function overlayMoveFile(runtime: StorageRuntime, input: unknown) {
  const record = asRecord(input);
  const from =
    readString(record, "from", "from_key", "source_key", "key") ?? "";
  const to = readString(record, "to", "to_key", "destination_key") ?? "";
  if (!(from && to)) {
    throw new Error("storage.file.move requires from and to keys");
  }
  if (from === to) {
    return { from, storage_key: to, to };
  }
  await assertDestinationAvailable(runtime, to);
  const metadata = await readObjectMetadata(runtime, from);
  const getResult = await runOverlay(runtime, {
    key: from,
    op: "get",
  });
  const body = unwrap(getResult, "get");
  let destinationWritten = false;
  try {
    await putBytes(runtime, {
      contentType: metadata.contentType,
      ifAbsent: true,
      key: to,
      metadata: metadata.metadata,
      source: body,
    });
    destinationWritten = true;
    const deleteResult = await runOverlay(runtime, {
      key: from,
      op: "delete",
    });
    unwrap(deleteResult, "delete");
  } catch (error) {
    throw attachOperationProgress(error, {
      copied: destinationWritten ? [to] : [],
      from,
      inProgress: { from, to },
      to,
    });
  }
  return { from, storage_key: to, to };
}

async function assertDestinationAvailable(
  runtime: StorageRuntime,
  key: string
) {
  const result = await runOverlay(runtime, { key, op: "head" });
  if (result.ok) {
    throw new Error(`Storage destination already exists: ${key}`);
  }
  if (result.status === 404 || result.error?.errorNumber === 3005) {
    return;
  }
  unwrap(result, "head");
}

async function readObjectMetadata(runtime: StorageRuntime, key: string) {
  const result = await runOverlay(runtime, { key, op: "head" });
  const data = unwrap(result, "head");
  if (!data || typeof data !== "object") {
    return {};
  }
  const record = data as Record<string, unknown>;
  const metadata = record.metadata;
  const typedMetadata =
    metadata && typeof metadata === "object"
      ? (Object.fromEntries(
          Object.entries(metadata as Record<string, unknown>).filter(
            ([, value]) => typeof value === "string"
          )
        ) as Record<string, string>)
      : undefined;
  return {
    contentType:
      typeof record.contentType === "string" ? record.contentType : undefined,
    metadata: typedMetadata,
  };
}

export async function overlayRenameFile(
  runtime: StorageRuntime,
  input: unknown
) {
  const record = asRecord(input);
  const key = readString(record, "key", "from", "storage_key") ?? "";
  const name = readString(record, "name", "to", "newName") ?? "";
  if (!(key && name)) {
    throw new Error("storage.file.rename requires key and name");
  }
  return overlayMoveFile(runtime, {
    from: key,
    to: renameObjectKey(key, name, false),
  });
}

export async function overlayCreateFolder(
  runtime: StorageRuntime,
  input: unknown
) {
  const record = asRecord(input);
  const name = readString(record, "name");
  const parent =
    (typeof record.prefixPath === "string" ? record.prefixPath : undefined) ||
    readString(record, "prefix") ||
    "";
  const prefix = name
    ? normalizeObjectPrefix(joinObjectKey(parent, validateFolderSegment(name)))
    : normalizeObjectPrefix(readString(record, "prefix", "key", "path") ?? "");
  if (!prefix) {
    throw new Error("storage.folder.create requires a folder name or prefix");
  }
  await putBytes(runtime, { key: prefix, source: new Uint8Array() });
  return { created: true, prefix };
}

export async function overlayDeleteFolder(
  runtime: StorageRuntime,
  input: unknown
) {
  const record = asRecord(input);
  const prefix = normalizeObjectPrefix(
    readString(record, "prefix", "key", "from_prefix") ?? ""
  );
  if (!prefix) {
    throw new Error("storage.folder.delete requires prefix");
  }
  const keys = await listAllKeys(runtime, prefix);
  const deleted: string[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    try {
      const result = await runOverlay(runtime, {
        key,
        op: "delete",
      });
      unwrap(result, "delete");
      deleted.push(key);
    } catch (error) {
      throw attachOperationProgress(error, {
        deleted,
        remaining: keys.slice(index),
      });
    }
  }
  return { deleted: true, prefix };
}

export async function overlayMoveFolder(
  runtime: StorageRuntime,
  input: unknown
) {
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
  const keys = await listAllKeys(runtime, from);
  const moves = keys.map((key) => ({
    from: key,
    to: `${to}${key.slice(from.length)}`,
  }));
  for (const move of moves) {
    await assertDestinationAvailable(runtime, move.to);
  }
  const copied: string[] = [];
  const moved: string[] = [];
  for (const key of keys) {
    const next = `${to}${key.slice(from.length)}`;
    try {
      const metadata = await readObjectMetadata(runtime, key);
      const getResult = await runOverlay(runtime, {
        key,
        op: "get",
      });
      const body = unwrap(getResult, "get");
      await putBytes(runtime, {
        contentType: metadata.contentType,
        ifAbsent: true,
        key: next,
        metadata: metadata.metadata,
        source: body,
      });
      copied.push(next);
      const deleteResult = await runOverlay(runtime, {
        key,
        op: "delete",
      });
      unwrap(deleteResult, "delete");
      moved.push(key);
    } catch (error) {
      throw attachOperationProgress(error, {
        copied,
        inProgress: { from: key, to: next },
        moved,
      });
    }
  }
  if (keys.length === 0) {
    await assertDestinationAvailable(runtime, to);
    await putBytes(runtime, { key: to, source: new Uint8Array() });
  }
  return { from, prefix: to, to };
}

export async function overlayRenameFolder(
  runtime: StorageRuntime,
  input: unknown
) {
  const record = asRecord(input);
  const from = normalizeObjectPrefix(
    readString(record, "from", "from_prefix", "prefix", "key") ?? ""
  );
  const name = readString(record, "name");
  const explicitTo = readString(record, "to_prefix", "to");
  const to = explicitTo
    ? normalizeObjectPrefix(explicitTo)
    : renameObjectKey(from, validateFolderSegment(name ?? ""), true);
  return overlayMoveFolder(runtime, { from, to });
}
