import type { AthenaPolicyRegistry } from "../../policy/registry.ts";
import type { AthenaPrincipal } from "../../runtime/data/principal.ts";

export type StorageObjectOp = "get" | "put" | "delete" | "list" | "head";

export function isStorageObjectOp(value: unknown): value is StorageObjectOp {
  return (
    value === "delete" ||
    value === "get" ||
    value === "head" ||
    value === "list" ||
    value === "put"
  );
}

export interface StorageObjectRequest {
  body?: Uint8Array | string;
  contentType?: string;
  cursor?: string;
  key?: string;
  limit?: number;
  metadata?: Record<string, string>;
  op: StorageObjectOp;
  prefix?: string;
}

export interface AuthorizedStorageOperation {
  body?: Uint8Array;
  contentType?: string;
  cursor?: string;
  key?: string;
  limit?: number;
  metadata?: Record<string, string>;
  op: StorageObjectOp;
  prefix?: string;
  principal: AthenaPrincipal;
}

export interface StorageObjectError {
  code: string;
  errorNumber: number;
  message: string;
  missing?: readonly string[];
  operation?: StorageObjectOp;
}

export interface StorageObjectResult {
  data?: unknown;
  error?: StorageObjectError;
  ok: boolean;
  status: number;
}

export interface StorageObjectProvider {
  execute(op: AuthorizedStorageOperation): Promise<StorageObjectResult>;
}

export interface AthenaStorageLifecycleHooks {
  after?(event: { op: StorageObjectOp; result: StorageObjectResult }): void;
  before?(event: { op: StorageObjectOp; request: StorageObjectRequest }): void;
}

export interface CreateStorageRuntimeOptions {
  lifecycle?: AthenaStorageLifecycleHooks;
  policies?: AthenaPolicyRegistry;
  provider: StorageObjectProvider;
}

export interface StorageRuntime {
  execute(
    request: StorageObjectRequest,
    principal: AthenaPrincipal
  ): Promise<StorageObjectResult>;
  readonly provider: StorageObjectProvider;
}

export const ATHENA_STORAGE_PROVIDER = Symbol.for(
  "@xylex-group/athena.storage.provider"
);

export const ATHENA_STORAGE_RUNTIME = Symbol.for(
  "@xylex-group/athena.storage.runtime"
);

export type StorageProviderHandle = StorageObjectProvider;
