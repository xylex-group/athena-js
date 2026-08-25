import type { MollieSdkClientPool } from "./client-factory.ts";
import {
	asMollieSdkClient,
	invokeMollieSdk,
	requireMollieSdkMethod,
	requireMollieSdkResource,
	unwrapMollieSdkEntity,
} from "./invoke.ts";
import type { MollieSdkResourceClient } from "./types.ts";

export async function callMollieSdk(input: {
	client: object;
	method: string;
	operation: string;
	request: Record<string, unknown>;
	resource: keyof MollieSdkResourceClient;
	unwrap?: boolean;
}): Promise<unknown> {
	const client = asMollieSdkClient(input.client);
	const resource = requireMollieSdkResource(
		client,
		input.resource,
		input.operation,
	);
	const method = requireMollieSdkMethod(
		resource as Record<string, unknown>,
		input.method,
		input.operation,
	);
	const idempotencyKey = input.request.idempotencyKey;
	const raw = await invokeMollieSdk({
		idempotencyKeyPresent:
			typeof idempotencyKey === "string" && idempotencyKey.trim() !== "",
		invoke: () => method(input.request),
		operation: input.operation,
	});
	return input.unwrap === false ? raw : unwrapMollieSdkEntity(raw);
}

export function clientFromPool(
	pool: MollieSdkClientPool,
	context: {
		credential: Parameters<MollieSdkClientPool["clientFor"]>[0]["credential"];
		target: { profileId?: string | null };
	},
): object {
	return pool.clientFor({
		credential: context.credential,
		requestedProfileId: context.target.profileId,
	});
}
