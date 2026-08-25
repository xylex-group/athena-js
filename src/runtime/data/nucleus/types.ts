import type { AthenaResolvedResource } from "../../../schema/resource.ts";

export const AuthorizedDataMutationBrand: unique symbol = Symbol(
	"athena.AuthorizedDataMutation",
);

export type AuthorizedDataMutationBrand = typeof AuthorizedDataMutationBrand;

export type AthenaDataNucleusEventName =
	| "data.insert"
	| "data.update"
	| "data.delete"
	| "data.upsert";

export type AthenaDataNucleusSemanticOperation =
	| "insert"
	| "update"
	| "delete"
	| "upsert";

export type AthenaDataNucleusTransportOperation = "insert" | "update" | "delete";

export type AthenaDataLifecyclePrincipal = {
	authenticated: boolean;
	authority?:
		| "anonymous"
		| "athena-session"
		| "custom-trusted"
		| "jwt"
		| "service";
	organizationId?: string;
	role?: string;
	userId?: string;
};

/**
 * Clone+sanitize+freeze snapshot given to prepare/before/after.
 * Must not include transport, db, pool, policy-engine, or the mutable request.
 */
export type AthenaDataMutationInput = {
	changedFields: readonly string[];
	database?: string;
	event: AthenaDataNucleusEventName;
	eventId?: string;
	model?: string;
	principal?: AthenaDataLifecyclePrincipal;
	record?: Record<string, unknown>;
	records?: readonly Record<string, unknown>[];
	requestId?: string;
	resource?: AthenaResolvedResource;
	result?: {
		affectedRows?: number;
		ok: boolean;
		status?: number;
	};
	schema?: string;
	semanticOperation: AthenaDataNucleusSemanticOperation;
	table?: string;
	traceId?: string;
	transactionSemantics?: "atomic" | "backend-managed" | "unknown";
	transportOperation: AthenaDataNucleusTransportOperation;
};

export type AuthorizedDataMutation = {
	readonly [AuthorizedDataMutationBrand]: true;
	readonly payload: unknown;
};

export type FrozenAuthorizedMutation = AuthorizedDataMutation;

export function isAuthorizedDataMutation(
	value: unknown,
): value is AuthorizedDataMutation {
	return Boolean(
		value &&
			typeof value === "object" &&
			AuthorizedDataMutationBrand in value &&
			(value as AuthorizedDataMutation)[AuthorizedDataMutationBrand] === true,
	);
}

export const hasAuthorizedBrand = isAuthorizedDataMutation;

export function brandAuthorizedDataPayload(
	payload: unknown,
): AuthorizedDataMutation {
	return freezeAuthorizedDataMutation(payload);
}

export function freezeAuthorizedDataMutation(
	payload: unknown,
): AuthorizedDataMutation {
	const frozenPayload = deepFreezeValue(structuredClone(payload));
	const branded: AuthorizedDataMutation = {
		[AuthorizedDataMutationBrand]: true,
		payload: frozenPayload,
	};
	return Object.freeze(branded);
}

export function deepFreezeValue<T>(value: T): T {
	if (value === null || typeof value !== "object") {
		return value;
	}
	if (Object.isFrozen(value)) {
		return value;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			deepFreezeValue(item);
		}
		return Object.freeze(value);
	}
	const record = value as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		deepFreezeValue(record[key]);
	}
	return Object.freeze(value);
}
