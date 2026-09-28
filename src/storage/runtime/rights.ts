import {
  type AthenaRightKey,
  athenaRightKeyString,
  parseAthenaRightKey,
} from "../../rights/key.ts";
import { missingRequiredRights } from "../../rights/matching.ts";
import { recordAthenaAuthorizationDecisionFromPrincipal } from "../../runtime/authorization/decisions.ts";
import type { AthenaPrincipal } from "../../runtime/data/principal.ts";
import {
  AthenaStorageAuthorizationError,
  storageErrorResult,
} from "./errors.ts";
import type { StorageObjectOp, StorageObjectResult } from "./types.ts";

const STORAGE_GET = parseAthenaRightKey("storage.get");
const STORAGE_HEAD = parseAthenaRightKey("storage.head");
const STORAGE_LIST = parseAthenaRightKey("storage.list");
const STORAGE_PUT = parseAthenaRightKey("storage.put");
const STORAGE_DELETE = parseAthenaRightKey("storage.delete");

const STORAGE_OPERATION_RIGHTS: Record<StorageObjectOp, AthenaRightKey> = {
  delete: STORAGE_DELETE,
  get: STORAGE_GET,
  head: STORAGE_HEAD,
  list: STORAGE_LIST,
  put: STORAGE_PUT,
};

export function requiredStorageRight(op: StorageObjectOp): AthenaRightKey {
  return STORAGE_OPERATION_RIGHTS[op];
}

export function listStorageRightKeys(): readonly AthenaRightKey[] {
  return Object.values(STORAGE_OPERATION_RIGHTS);
}

/**
 * Rights gate for Storage Nucleus. Grants are never consulted.
 * Returns a deny result, or undefined when the principal holds the Right.
 */
export function authorizeStorageOperation(
  principal: AthenaPrincipal,
  op: StorageObjectOp
): StorageObjectResult | undefined {
  if (!principal.authenticated) {
    return storageErrorResult(
      3003,
      "storage_unauthenticated",
      "authentication is required",
      401
    );
  }
  const required = requiredStorageRight(op);
  const missing = missingRequiredRights(principal.rights, [required]);
  recordAthenaAuthorizationDecisionFromPrincipal({
    domain: "storage",
    operation: op,
    principal,
    required: [required],
    resource: "storage",
  });
  if (missing.length === 0) {
    return;
  }
  return storageErrorResult(
    new AthenaStorageAuthorizationError({
      missing: missing.map(athenaRightKeyString),
      operation: op,
    })
  );
}
