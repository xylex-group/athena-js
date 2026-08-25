import type { AthenaResolvedPrincipal } from "../principal.ts";
import type { AthenaRuntimeRequestContext } from "../types.ts";
import type { AthenaDataNucleusEnvelope } from "./envelope.ts";
import type { AthenaDataMutationResult } from "./result.ts";
import type { AthenaDataTransactionSemantics } from "./transaction.ts";
import type {
	AthenaDataLifecyclePrincipal,
	AthenaDataMutationInput,
} from "./types.ts";

export type AthenaDataNucleusContext = {
	readonly envelope: AthenaDataNucleusEnvelope;
	readonly event: AthenaDataMutationInput["event"];
	readonly input?: AthenaDataMutationInput;
	readonly principal?: AthenaDataLifecyclePrincipal;
	readonly requestContext?: AthenaRuntimeRequestContext;
	readonly result?: AthenaDataMutationResult;
	readonly startedAt: Date;
	readonly transactionSemantics: AthenaDataTransactionSemantics;
};

const CLAIM_KEYS = ["claims", "token", "sessionToken", "password", "secret"];

export function sanitizeDataLifecyclePrincipal(
	resolved?: AthenaResolvedPrincipal,
): AthenaDataLifecyclePrincipal {
	const principal = resolved?.principal;
	const projection: AthenaDataLifecyclePrincipal = {
		authenticated: principal?.authenticated === true,
		...(resolved?.authority ? { authority: resolved.authority } : {}),
		...(typeof principal?.userId === "string"
			? { userId: principal.userId }
			: {}),
		...(typeof principal?.organizationId === "string"
			? { organizationId: principal.organizationId }
			: {}),
		...(typeof principal?.role === "string" ? { role: principal.role } : {}),
	};
	const record = projection as unknown as Record<string, unknown>;
	for (const key of CLAIM_KEYS) {
		delete record[key];
	}
	return Object.freeze(projection);
}
