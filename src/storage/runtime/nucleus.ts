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

function toBytes(body: Uint8Array | string | undefined): Uint8Array | undefined {
	if (body == null) {
		return undefined;
	}
	if (typeof body === "string") {
		return new TextEncoder().encode(body);
	}
	return body;
}

export function createStorageRuntime(
	options: CreateStorageRuntimeOptions,
): StorageRuntime {
	const { provider, policies, lifecycle } = options;

	return {
		provider,
		async execute(request: StorageObjectRequest, principal: AthenaPrincipal) {
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
					return storageErrorResult(
						3003,
						"storage_authorization_denied",
						decision.reason ?? "denied",
						403,
					);
				}
			}

			lifecycle?.before?.({ op: request.op, request });

			const authorized: AuthorizedStorageOperation = {
				body: toBytes(request.body),
				contentType: request.contentType,
				cursor: request.cursor,
				key: request.key,
				limit: request.limit,
				metadata: request.metadata,
				op: request.op,
				prefix: request.prefix,
				principal,
			};

			let result;
			try {
				result = await provider.execute(authorized);
			} catch (error) {
				result = mapProviderFailure(error);
			}

			lifecycle?.after?.({ op: request.op, result });
			return result;
		},
	};
}
