import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { parseAthenaRightKey, type AthenaRightKey } from "../../rights/key.ts";
import {
	canonicalAthenaResource,
	parseAthenaResourceRef,
	resolvedAthenaResource,
} from "../../schema/resource.ts";
import {
	authorizationBindingError,
	type AthenaAuthorizationBindingErrorCode,
} from "./binding-errors.ts";

export const ATHENA_MODEL_AUTHORIZATION_BINDING_KIND =
	"athena.authorization.model-binding" as const;
export const ATHENA_MODEL_AUTHORIZATION_BINDING_IR_VERSION = 1 as const;

export type AthenaModelAuthorizationOperation =
	| "select"
	| "insert"
	| "update"
	| "delete";

export interface AthenaModelAuthorizationColumn {
	logical: string;
	physical: string;
}

export interface AthenaModelAuthorizationScope {
	column: AthenaModelAuthorizationColumn;
	kind: "organization" | "tenant" | "user";
}

export interface AthenaModelAuthorizationScopeInput {
	column: string | AthenaModelAuthorizationColumn;
	kind: "organization" | "tenant" | "user";
}

export type AthenaModelAuthorizationScopePrincipalPath =
	| "principal.organizationId"
	| "principal.tenantId"
	| "principal.userId";

export interface AthenaModelAuthorizationIdentity {
	column: string;
}

export interface AthenaModelAuthorizationResourceIdentity {
	canonicalResource: string;
	model: string;
	table: string;
}

export interface AthenaModelAuthorizationBinding {
	identity?: AthenaModelAuthorizationIdentity;
	irVersion: typeof ATHENA_MODEL_AUTHORIZATION_BINDING_IR_VERSION;
	kind: typeof ATHENA_MODEL_AUTHORIZATION_BINDING_KIND;
	resource: AthenaModelAuthorizationResourceIdentity;
	rights: Record<AthenaModelAuthorizationOperation, AthenaRightKey>;
	scope?: AthenaModelAuthorizationScope;
}

export interface AthenaModelAuthorizationBindingInput {
	identity?: { column: string };
	resource: { model: string; table: string };
	rights: Record<AthenaModelAuthorizationOperation, AthenaRightKey | string>;
	scope?: AthenaModelAuthorizationScopeInput;
}

function requiredToken(
	value: string,
	bindingCode: AthenaAuthorizationBindingErrorCode,
	field: string,
): string {
	const token = value.trim();
	if (!token) {
		authorizationBindingError(bindingCode, `${field} must be a non-empty string`);
	}
	return token;
}

function freezeScope(
	scope: AthenaModelAuthorizationScopeInput,
): AthenaModelAuthorizationScope {
	if (
		scope.kind !== "organization" &&
		scope.kind !== "tenant" &&
		scope.kind !== "user"
	) {
		authorizationBindingError(
			"ATHENA_AUTHORIZATION_BINDING_INVALID_SCOPE",
			`scope.kind "${String(scope.kind)}" is not supported`,
		);
	}
	const column =
		typeof scope.column === "string"
			? { logical: scope.column, physical: scope.column }
			: {
					logical: requiredToken(
						scope.column.logical,
						"ATHENA_AUTHORIZATION_BINDING_INVALID_SCOPE",
						"scope.column.logical",
					),
					physical: requiredToken(
						scope.column.physical,
						"ATHENA_AUTHORIZATION_BINDING_INVALID_SCOPE",
						"scope.column.physical",
					),
				};
	return Object.freeze({
		column: Object.freeze(column),
		kind: scope.kind,
	});
}

function resolveResourceIdentity(
	input: AthenaModelAuthorizationBindingInput["resource"],
): AthenaModelAuthorizationResourceIdentity {
	const model = requiredToken(
		input.model,
		"ATHENA_AUTHORIZATION_BINDING_INVALID_RESOURCE",
		"resource.model",
	);
	const tableToken = requiredToken(
		input.table,
		"ATHENA_AUTHORIZATION_BINDING_INVALID_RESOURCE",
		"resource.table",
	);
	const parsed = parseAthenaResourceRef(tableToken);
	if (!parsed.table.trim()) {
		authorizationBindingError(
			"ATHENA_AUTHORIZATION_BINDING_INVALID_RESOURCE",
			"resource.table must resolve to a relation table name",
		);
	}
	const canonicalResource = canonicalAthenaResource(parsed);
	const resolved = resolvedAthenaResource({
		...parsed,
		model,
	});
	return Object.freeze({
		canonicalResource,
		model,
		table: resolved.canonicalResource,
	});
}

function resolveIdentity(
	identity: AthenaModelAuthorizationBindingInput["identity"],
): AthenaModelAuthorizationIdentity | undefined {
	if (!identity) {
		return;
	}
	return Object.freeze({
		column: requiredToken(
			identity.column,
			"ATHENA_AUTHORIZATION_BINDING_INVALID_RESOURCE",
			"identity.column",
		),
	});
}

function resolveRights(
	rights: AthenaModelAuthorizationBindingInput["rights"],
): Record<AthenaModelAuthorizationOperation, AthenaRightKey> {
	return Object.freeze({
		delete: parseAthenaRightKey(rights.delete),
		insert: parseAthenaRightKey(rights.insert),
		select: parseAthenaRightKey(rights.select),
		update: parseAthenaRightKey(rights.update),
	});
}

function bindingSemanticPayload(binding: AthenaModelAuthorizationBinding): {
	identity: string | null;
	kind: string;
	resource: {
		canonicalResource: string;
		model: string;
		table: string;
	};
	rights: Record<AthenaModelAuthorizationOperation, string>;
	scope: {
		column: AthenaModelAuthorizationColumn;
		kind: AthenaModelAuthorizationScope["kind"];
	} | null;
	version: number;
} {
	return {
		identity: binding.identity?.column ?? null,
		kind: binding.kind,
		resource: {
			canonicalResource: binding.resource.canonicalResource,
			model: binding.resource.model,
			table: binding.resource.table,
		},
		rights: {
			delete: binding.rights.delete,
			insert: binding.rights.insert,
			select: binding.rights.select,
			update: binding.rights.update,
		},
		scope: binding.scope
			? {
					column: binding.scope.column,
					kind: binding.scope.kind,
				}
			: null,
		version: binding.irVersion,
	};
}

export function serializeAthenaModelAuthorizationBinding(
	binding: AthenaModelAuthorizationBinding,
): string {
	return JSON.stringify(bindingSemanticPayload(binding));
}

export function fingerprintAthenaModelAuthorizationBinding(
	binding: AthenaModelAuthorizationBinding,
): string {
	return bytesToHex(
		sha256(utf8ToBytes(serializeAthenaModelAuthorizationBinding(binding))),
	);
}

export function authorizeModel(
	input: AthenaModelAuthorizationBindingInput,
): AthenaModelAuthorizationBinding {
	const identity = resolveIdentity(input.identity);
	const scope = input.scope ? freezeScope(input.scope) : undefined;
	const binding: AthenaModelAuthorizationBinding = {
		...(identity ? { identity } : {}),
		irVersion: ATHENA_MODEL_AUTHORIZATION_BINDING_IR_VERSION,
		kind: ATHENA_MODEL_AUTHORIZATION_BINDING_KIND,
		resource: resolveResourceIdentity(input.resource),
		rights: resolveRights(input.rights),
		...(scope ? { scope } : {}),
	};
	return Object.freeze(binding);
}

function scope(kind: AthenaModelAuthorizationScope["kind"], column: string): AthenaModelAuthorizationScope {
	return freezeScope({ column, kind });
}

export function organizationScope(column: string): AthenaModelAuthorizationScope {
	return scope("organization", column);
}

export function tenantScope(column: string): AthenaModelAuthorizationScope {
	return scope("tenant", column);
}

export function userScope(column: string): AthenaModelAuthorizationScope {
	return scope("user", column);
}

export function authorizationScopePrincipalPath(
	scope: AthenaModelAuthorizationScope,
): AthenaModelAuthorizationScopePrincipalPath {
	switch (scope.kind) {
		case "organization":
			return "principal.organizationId";
		case "tenant":
			return "principal.tenantId";
		case "user":
			return "principal.userId";
	}
}
