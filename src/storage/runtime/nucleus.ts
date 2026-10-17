import { decideAthenaPolicy } from "../../policy/decide.ts";
import type { PolicyActionName } from "../../policy/types.ts";
import type { AthenaPrincipal } from "../../runtime/data/principal.ts";
import { mapProviderFailure, storageErrorResult } from "./errors.ts";
import { authorizeStorageOperation } from "./rights.ts";
import type {
  AuthorizedStorageOperation,
  CreateStorageRuntimeOptions,
  StorageObjectOp,
  StorageObjectRequest,
  StorageObjectResult,
  StorageRuntime,
} from "./types.ts";

const STORAGE_RESOURCE = "storage.object";

function actionForOp(op: StorageObjectOp): PolicyActionName {
  switch (op) {
    case "put":
      return "storage.object.write";
    case "delete":
      return "storage.object.delete";
    default:
      return "storage.object.read";
  }
}

function toBytes(
  body: Uint8Array | string | undefined
): Uint8Array | undefined {
  if (body == null) {
    return;
  }
  if (typeof body === "string") {
    return new TextEncoder().encode(body);
  }
  return body;
}

export function createStorageRuntime(
  options: CreateStorageRuntimeOptions
): StorageRuntime {
  const { keyScope, provider, policies, lifecycle } = options;

  return {
    async execute(request: StorageObjectRequest, principal: AthenaPrincipal) {
      if (
        request.op !== "get" &&
        request.op !== "put" &&
        request.op !== "delete" &&
        request.op !== "list" &&
        request.op !== "head"
      ) {
        return storageErrorResult({
          message: `unsupported op ${String(request.op)}`,
          source: "runtime",
          status: 400,
        });
      }
      if (request.op !== "list" && !request.key?.trim()) {
        return storageErrorResult({
          message: `${request.op} requires key`,
          source: "runtime",
          status: 400,
        });
      }
      const rightsDenied = authorizeStorageOperation(principal, request.op);
      if (rightsDenied) {
        return rightsDenied;
      }

      if (policies) {
        const decision = decideAthenaPolicy(policies, {
          action: actionForOp(request.op),
          principal,
          resource: STORAGE_RESOURCE,
        });
        if (!decision.allowed) {
          return storageErrorResult({
            message: decision.reason ?? "denied",
            source: "runtime",
            status: 403,
          });
        }
      }

      let operation = request;
      let scopePrefix: string | undefined;
      if (keyScope) {
        try {
          scopePrefix = normalizeKeyScope(keyScope(principal));
          operation = {
            ...request,
            ...(request.key
              ? { key: scopeStorageKey(scopePrefix, request.key) }
              : {}),
            ...(request.prefix === undefined
              ? request.op === "list"
                ? { prefix: scopePrefix }
                : {}
              : { prefix: scopeStorageKey(scopePrefix, request.prefix) }),
          };
        } catch (error) {
          return storageErrorResult(
            3003,
            "storage_authorization_denied",
            error instanceof Error
              ? error.message
              : "storage key scope is invalid",
            403
          );
        }
      }

      lifecycle?.before?.({ op: request.op, request });

      const authorized: AuthorizedStorageOperation = {
        body: toBytes(operation.body),
        contentType: operation.contentType,
        cursor: operation.cursor,
        ...(operation.ifAbsent ? { ifAbsent: true } : {}),
        key: operation.key,
        limit: operation.limit,
        metadata: operation.metadata,
        op: operation.op,
        prefix: operation.prefix,
        principal,
        signal: operation.signal,
      };

      let result: StorageObjectResult;
      try {
        result = await provider.execute(authorized);
      } catch (error) {
        result = mapProviderFailure(error);
      }

      if (scopePrefix && result.ok) {
        result = {
          ...result,
          data: unScopeStorageResult(result.data, scopePrefix),
        };
      }

      lifecycle?.after?.({ op: request.op, result });
      return result;
    },
    provider,
  };
}

function normalizeKeyScope(value: string): string {
  const namespace = value.trim().replace(/^\/+/, "");
  const prefix = namespace.endsWith("/") ? namespace : `${namespace}/`;
  if (!namespace || prefix.includes("\0") || prefix.split("/").includes("..")) {
    throw new Error("storage key scope must be a non-empty safe prefix");
  }
  return prefix;
}

function scopeStorageKey(prefix: string, value: string): string {
  const key = value.replace(/^\/+/, "");
  if (key.includes("\0") || key.split("/").includes("..")) {
    throw new Error("storage key must not contain null bytes or .. segments");
  }
  return `${prefix}${key}`;
}

function unScopeStorageResult(data: unknown, prefix: string): unknown {
  if (Array.isArray(data)) {
    return data.map((entry) => unScopeStorageResult(entry, prefix));
  }
  if (!data || typeof data !== "object") {
    return data;
  }
  if (
    ArrayBuffer.isView(data) ||
    data instanceof ArrayBuffer ||
    (typeof Blob !== "undefined" && data instanceof Blob) ||
    (typeof Response !== "undefined" && data instanceof Response)
  ) {
    return data;
  }
  const prototype = Object.getPrototypeOf(data);
  if (prototype !== Object.prototype && prototype !== null) {
    return data;
  }
  const record = data as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (
      (key === "objects" || key === "files" || key === "items") &&
      Array.isArray(value)
    ) {
      output[key] = value
        .filter((entry) => {
          if (!entry || typeof entry !== "object") {
            return false;
          }
          const object = entry as Record<string, unknown>;
          const objectKey =
            object.key ?? object.storage_key ?? object.storageKey;
          return typeof objectKey === "string" && objectKey.startsWith(prefix);
        })
        .map((entry) => unScopeStorageResult(entry, prefix));
      continue;
    }
    if (
      (key === "key" || key === "storage_key" || key === "storageKey") &&
      typeof value === "string" &&
      value.startsWith(prefix)
    ) {
      output[key] = value.slice(prefix.length);
      continue;
    }
    if (key === "deleted" && Array.isArray(value)) {
      output[key] = value
        .filter(
          (entry): entry is string =>
            typeof entry === "string" && entry.startsWith(prefix)
        )
        .map((entry) => entry.slice(prefix.length));
      continue;
    }
    output[key] = unScopeStorageResult(value, prefix);
  }
  return output;
}
