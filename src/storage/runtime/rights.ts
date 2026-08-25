import { parseAthenaRightKey, type AthenaRightKey } from "../../rights/key.ts";
import { missingRequiredRights } from "../../rights/matching.ts";
import type { AthenaPrincipal } from "../../runtime/data/principal.ts";
import { storageErrorResult } from "./errors.ts";
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

/**
 * Rights gate for Storage Nucleus. Grants are never consulted.
 * Returns a deny result, or undefined when the principal holds the Right.
 */
export function authorizeStorageOperation(
	principal: AthenaPrincipal,
	op: StorageObjectOp,
): StorageObjectResult | undefined {
	const required = requiredStorageRight(op);
	const missing = missingRequiredRights(principal.rights, [required]);
	if (missing.length === 0) {
		return undefined;
	}
	return storageErrorResult(
		3003,
		"storage_authorization_denied",
		"missing required storage right",
		403,
	);
}
