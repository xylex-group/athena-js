import type { AthenaPrincipal } from "../runtime/data/principal.ts";
import type {
	AthenaAuthorizationResource,
} from "../runtime/authorization/decision-ir.ts";
import type { AthenaModelAuthorizationBinding } from "../runtime/authorization/model-binding.ts";
import type { PolicyExpr, SubjectRef } from "./types.ts";

export type AthenaAuthorizationScopePolicySubject =
	| "organizationId"
	| "tenantId"
	| "userId";

export interface AthenaAuthorizationScopePolicyFilter {
	column: string;
	expression: PolicyExpr;
	subject: AthenaAuthorizationScopePolicySubject;
	trustedValue: string;
}

export type AthenaAuthorizationScopePolicyProjection =
	| { kind: "none" }
	| { kind: "trusted_subject_missing"; subject: AthenaAuthorizationScopePolicySubject }
	| { kind: "known_resource_mismatch"; subject: AthenaAuthorizationScopePolicySubject }
	| { kind: "filter"; expression: PolicyExpr; filter: AthenaAuthorizationScopePolicyFilter };

function scopeSubjectFromBinding(
	kind: "organization" | "tenant" | "user",
): AthenaAuthorizationScopePolicySubject {
	switch (kind) {
		case "organization":
			return "organizationId";
		case "tenant":
			return "tenantId";
		case "user":
			return "userId";
	}
}

function trustedSubjectValue(
	principal: AthenaPrincipal,
	subject: AthenaAuthorizationScopePolicySubject,
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

function knownResourceSubjectValue(
	resource: AthenaAuthorizationResource | undefined,
	subject: AthenaAuthorizationScopePolicySubject,
): string | undefined {
	if (!resource) {
		return;
	}
	switch (subject) {
		case "organizationId":
			return resource.organizationId;
		case "tenantId":
			return resource.tenantId;
		case "userId":
			return resource.userId;
	}
}

function scopeExpression(
	column: { logical: string; physical: string },
	subject: AthenaAuthorizationScopePolicySubject,
): PolicyExpr {
	const subjectRef: SubjectRef = (() => {
		switch (subject) {
			case "organizationId":
				return { slot: "organizationId" };
			case "tenantId":
				return { slot: "tenantId" };
			case "userId":
				return { slot: "userId" };
		}
	})();
	return Object.freeze({
		left: {
			column: {
				logical: column.logical,
				physical: column.physical,
			},
			kind: "column",
		},
		op: "eq",
		right: {
			kind: "subject",
			subject: subjectRef,
		},
	} satisfies PolicyExpr);
}

export function projectAuthorizationScopePolicyExpr(input: {
	binding: AthenaModelAuthorizationBinding;
	principal: AthenaPrincipal;
	resource?: AthenaAuthorizationResource;
}): AthenaAuthorizationScopePolicyProjection {
	const scope = input.binding.scope;
	if (!scope) {
		return { kind: "none" };
	}

	const subject = scopeSubjectFromBinding(scope.kind);
	const trustedValue = trustedSubjectValue(input.principal, subject);
	if (!trustedValue) {
		return { kind: "trusted_subject_missing", subject };
	}

	const knownResourceValue = knownResourceSubjectValue(input.resource, subject);
	if (
		knownResourceValue !== undefined &&
		knownResourceValue !== trustedValue
	) {
		return { kind: "known_resource_mismatch", subject };
	}

	const expression = scopeExpression(scope.column, subject);
	return {
		expression,
		filter: Object.freeze({
			column: scope.column.physical,
			expression,
			subject,
			trustedValue,
		}),
		kind: "filter",
	};
}
