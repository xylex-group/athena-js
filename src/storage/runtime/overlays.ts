import { parseAthenaRightKey } from "../../rights/key.ts";
import type { AthenaPrincipal } from "../../runtime/data/principal.ts";
import {
  AthenaStorageAuthorizationError,
  AthenaStorageError,
  isAthenaStorageAuthorizationError,
} from "./errors.ts";
import {
  coerceStorageBytes,
  isHighLevelFileUpload,
  overlayCreateFolder,
  overlayDeleteFolder,
  overlayMoveFile,
  overlayMoveFolder,
  overlayRenameFile,
  overlayRenameFolder,
  overlayUploadFiles,
} from "./object-ops.ts";
import type {
  StorageObjectOp,
  StorageObjectResult,
  StorageRuntime,
} from "./types.ts";

export interface StorageOverlayInput {
  contentType?: string;
  cursor?: string;
  key?: string;
  limit?: number;
  metadata?: Record<string, string>;
  op: StorageObjectOp;
  prefix?: string;
  source?: Uint8Array | string;
}

/** Process-owned local ObjectStore caller — not an HTTP identity. */
const OVERLAY_PRINCIPAL: AthenaPrincipal = {
  authenticated: true,
  grants: [],
  rights: Object.freeze([parseAthenaRightKey("storage.*")]),
  userId: "storage-overlay",
};

export async function executeStorageOverlay(
  runtime: StorageRuntime,
  input: StorageOverlayInput
) {
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
    },
    OVERLAY_PRINCIPAL
  );
}

export function wrapStorageModuleWithRuntime<T extends object>(
  module: T,
  runtime: StorageRuntime
): T {
  const storage = module as T & {
    file?: {
      delete?: (input: unknown) => Promise<unknown>;
      get?: (input: unknown) => Promise<unknown>;
      list?: (input?: unknown) => Promise<unknown>;
      move?: (input: unknown) => Promise<unknown>;
      rename?: (input: unknown) => Promise<unknown>;
      upload?: (
        input: unknown,
        options?: { signal?: AbortSignal }
      ) => Promise<unknown>;
    };
    folder?: {
      create?: (input: unknown) => Promise<unknown>;
      delete?: (input: unknown) => Promise<unknown>;
      move?: (input: unknown) => Promise<unknown>;
      rename?: (input: unknown) => Promise<unknown>;
    };
  };
  if (!storage.file) {
    return module;
  }
  const file = storage.file;
  const folder = storage.folder ?? {};
  return {
    ...storage,
    file: {
      ...file,
      async delete(input: unknown) {
        const result = await executeStorageOverlay(runtime, {
          key: readKey(input),
          op: "delete",
        });
        return unwrapStorageRuntimeResult(result, "delete");
      },
      async get(input: unknown) {
        const result = await executeStorageOverlay(runtime, {
          key: readKey(input),
          op: "get",
        });
        return unwrapStorageRuntimeResult(result, "get");
      },
      async head(input: unknown) {
        const result = await executeStorageOverlay(runtime, {
          key: readKey(input),
          op: "head",
        });
        return unwrapStorageRuntimeResult(result, "head");
      },
      async list(input?: unknown) {
        const result = await executeStorageOverlay(runtime, {
          cursor: readCursor(input),
          limit: readLimit(input),
          op: "list",
          prefix: readPrefix(input),
        });
        return unwrapStorageRuntimeResult(result, "list");
      },
      async move(input: unknown) {
        return overlayMoveFile(runtime, input);
      },
      async rename(input: unknown) {
        return overlayRenameFile(runtime, input);
      },
      async upload(input: unknown, options?: { signal?: AbortSignal }) {
        if (isHighLevelFileUpload(input)) {
          return overlayUploadFiles(runtime, input, options);
        }
        const source = await coerceStorageBytes(
          readSource(input) ?? readLooseSource(input)
        );
        const result = await executeStorageOverlay(runtime, {
          contentType: readContentType(input),
          key: readKey(input),
          metadata: readMetadata(input),
          op: "put",
          source,
        });
        return unwrapStorageRuntimeResult(result, "put");
      },
    },
    folder: {
      ...folder,
      create: folder.create ?? ((input) => overlayCreateFolder(runtime, input)),
      delete: folder.delete ?? ((input) => overlayDeleteFolder(runtime, input)),
      move: folder.move ?? ((input) => overlayMoveFolder(runtime, input)),
      rename: folder.rename ?? ((input) => overlayRenameFolder(runtime, input)),
    },
  };
}

export function unwrapStorageRuntimeResult(
  result: StorageObjectResult,
  operation: StorageObjectOp
): unknown {
  if (result.ok) {
    return result.data;
  }
  throw projectStorageRuntimeError(result, operation);
}

export function projectStorageRuntimeError(
  result: StorageObjectResult,
  operation: StorageObjectOp
): AthenaStorageError {
  if (result.error && isAthenaStorageAuthorizationError(result.error)) {
    return new AthenaStorageAuthorizationError({
      missing: result.error.missing,
      operation: result.error.operation,
    });
  }
  return new AthenaStorageError({
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

function readKey(input: unknown): string | undefined {
  if (typeof input === "string" && input.trim()) {
    return input;
  }
  const record = asRecord(input);
  const key =
    record.storage_key ?? record.storageKey ?? record.key ?? record.name;
  return typeof key === "string" && key.trim() ? key : undefined;
}

function readPrefix(input: unknown): string | undefined {
  const record = asRecord(input);
  return typeof record.prefix === "string" ? record.prefix : undefined;
}

function readSource(input: unknown): Uint8Array | string | undefined {
  if (input instanceof Uint8Array || typeof input === "string") {
    return input;
  }
  const record = asRecord(input);
  const source = record.source ?? record.body ?? record.files ?? record.bytes;
  if (source instanceof Uint8Array || typeof source === "string") {
    return source;
  }
}

function readContentType(input: unknown): string | undefined {
  const record = asRecord(input);
  return typeof record.contentType === "string"
    ? record.contentType
    : undefined;
}

function readMetadata(input: unknown): Record<string, string> | undefined {
  const record = asRecord(input);
  const metadata = record.metadata;
  if (!metadata || typeof metadata !== "object") {
    return;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(
    metadata as Record<string, unknown>
  )) {
    if (typeof value === "string") {
      out[key] = value;
    }
  }
  return out;
}

function readCursor(input: unknown): string | undefined {
  const record = asRecord(input);
  return typeof record.cursor === "string" ? record.cursor : undefined;
}

function readLimit(input: unknown): number | undefined {
  const record = asRecord(input);
  return typeof record.limit === "number" ? record.limit : undefined;
}

function readLooseSource(input: unknown): unknown {
  if (
    input instanceof Uint8Array ||
    input instanceof ArrayBuffer ||
    (typeof Blob !== "undefined" && input instanceof Blob)
  ) {
    return input;
  }
  const record = asRecord(input);
  return record.source ?? record.body ?? record.files ?? record.bytes;
}

/** Public, non-secret Storage summary for settings UI. Never copy credentials. */
export function advertiseSafeStorageCapabilities(
  storage: object,
  input?: {
    bucket?: string | null;
    provider?: string | null;
    r2?: unknown;
  }
): void {
  const bucket = input?.bucket?.trim() ?? "";
  let provider: string | undefined;
  if (typeof input?.provider === "string" && input.provider.trim()) {
    provider = input.provider.trim();
  } else if (input?.r2) {
    provider = "r2";
  }
  const target = storage as { capabilities?: Record<string, unknown> };
  target.capabilities = {
    ...(target.capabilities && typeof target.capabilities === "object"
      ? target.capabilities
      : {}),
    objects: true,
    ...(provider ? { provider } : {}),
    ...(bucket ? { bucket } : {}),
  };
}
