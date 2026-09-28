import type { AthenaPrincipal } from "../data/principal.ts";
import type {
	AthenaAuthorizationDenyReason,
	AthenaAuthorizationResource,
	AthenaAuthorizationScopeSubject,
} from "./decision-ir.ts";
import type {
	AthenaModelAuthorizationBinding,
	AthenaModelAuthorizationColumn,
} from "./model-binding.ts";

export interface AthenaAuthorizationScopeContext {
	column: AthenaModelAuthorizationColumn;
	principalValue: string;
	subject: AthenaAuthorizationScopeSubject;
}

export type AthenaAuthorizationScopeResolution =
	| { ok: true; scope?: AthenaAuthorizationScopeContext }
	| { ok: false; reason: AthenaAuthorizationDenyReason };

export function scopeSubjectFromBindingKind(
	kind: "organization" | "tenant" | "user",
): AthenaAuthorizationScopeSubject {
	switch (kind) {
		case "organization":
			return "organizationId";
		case "tenant":
			return "tenantId";
		case "user":
			return "userId";
	}
}

export function principalScopeSubjectValue(
	principal: AthenaPrincipal,
	subject: AthenaAuthorizationScopeSubject,
): string | undefined {
	switch (subject) {
		case "organizationId":
			return principal.organizationId;
		case "tenantId":
			return principal.tenantId;
		case "userId":
			return principal.userId;
	}
}

function resourceScopeSubjectValue(
	resource: AthenaAuthorizationResource,
	subject: AthenaAuthorizationScopeSubject,
): string | undefined {
	switch (subject) {
		case "organizationId":
			return resource.organizationId;
		case "tenantId":
			return resource.tenantId;
		case "userId":
			return resource.userId;
	}
}

export function resolveAuthorizationScope(input: {
	binding: AthenaModelAuthorizationBinding;
	principal: AthenaPrincipal;
	resource: AthenaAuthorizationResource;
}): AthenaAuthorizationScopeResolution {
	const scope = input.binding.scope;
	if (!scope) {
		return { ok: true };
	}
	const subject = scopeSubjectFromBindingKind(scope.kind);
	const principalValue = principalScopeSubjectValue(input.principal, subject);
	if (!principalValue) {
		return {
			ok: false,
			reason: {
				kind: "trusted_subject_missing",
				subject,
			},
		};
	}
	const resourceValue = resourceScopeSubjectValue(input.resource, subject);
	if (resourceValue && resourceValue !== principalValue) {
		return {
			ok: false,
			reason: {
				kind: "scope_mismatch",
				scope: subject,
			},
		};
	}
	return {
		ok: true,
		scope: Object.freeze({
			column: Object.freeze({ ...scope.column }),
			principalValue,
			subject,
		}),
	};
}
