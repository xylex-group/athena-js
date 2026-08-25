/**
 * Browser-safe local-storage config helpers.
 *
 * The Node filesystem adapter lives in `./local.ts` and is imported only from
 * the server `v3-client.ts` entry. This module must stay free of `node:fs`.
 */

export const ATHENA_LOCAL_OBJECT_STORE = Symbol.for(
  "@xylex-group/athena.storage.localObjectStore"
);

export interface AthenaLocalStorageConfigShape {
  prefix?: string | null;
  provider?: string | null;
  root?: string | null;
}

export function isLocalStorageConfig(
  storage: unknown
): storage is AthenaLocalStorageConfigShape & { provider: "local" } {
  if (!storage || typeof storage !== "object") {
    return false;
  }
  return (storage as AthenaLocalStorageConfigShape).provider === "local";
}

export interface AthenaS3StorageConfigShape {
  bucket?: string | null;
  prefix?: string | null;
  provider?: string | null;
  s3?: unknown;
}

export function isS3StorageConfig(
  storage: unknown
): storage is AthenaS3StorageConfigShape & { provider: "s3" } {
  if (!storage || typeof storage !== "object") {
    return false;
  }
  return (storage as AthenaS3StorageConfigShape).provider === "s3";
}

export function hasLocalStorageRoot(storage: unknown): boolean {
  if (!isLocalStorageConfig(storage)) {
    return false;
  }
  const root = storage.root;
  return typeof root === "string" && root.trim().length > 0;
}

export function getLocalObjectStore<T = unknown>(
  storage: unknown
): T | undefined {
  if (!storage || typeof storage !== "object") {
    return;
  }
  const handle = (storage as { [ATHENA_LOCAL_OBJECT_STORE]?: T })[
    ATHENA_LOCAL_OBJECT_STORE
  ];
  return handle;
}

export function bindLocalObjectStore<TStorage extends object, TStore>(
  storage: TStorage,
  store: TStore
): TStorage & { [ATHENA_LOCAL_OBJECT_STORE]: TStore } {
  return {
    ...storage,
    [ATHENA_LOCAL_OBJECT_STORE]: store,
  };
}
