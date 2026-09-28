import type { AthenaPolicyRegistry } from "../../policy/registry.ts";
import type { PolicyExpr, SubjectRef } from "../../policy/types.ts";
import type { AthenaRightKey } from "../../rights/key.ts";
import { rightMatches } from "../../rights/matching.ts";
import type { AthenaPrincipal } from "../data/principal.ts";
import type {
	AthenaAuthorizationAction,
	AthenaAuthorizationAllowDecision,
	AthenaAuthorizationDecision,
	AthenaAuthorizationDenyDecision,
	AthenaAuthorizationDenyReason,
	AthenaAuthorizationObligation,
	AthenaAuthorizationResource,
	AthenaResolvedRight,
} from "./decision-ir.ts";
import type {
	AthenaModelAuthorizationBinding,
	AthenaModelAuthorizationColumn,
} from "./model-binding.ts";
import { evaluateAthenaAuthorizationPolicy } from "./policy-evaluator.ts";
import { resolveAuthorizationScope } from "./resource-context.ts";

export interface AthenaAuthorizationEngineInput {
	action: AthenaAuthorizationAction;
	binding: AthenaModelAuthorizationBinding;
	organizationId?: string;
	policies?: AthenaPolicyRegistry;
	principal: AthenaPrincipal;
	requiredRight: AthenaRightKey;
	resource: AthenaAuthorizationResource;
}

function freezeDecision(
	decision: AthenaAuthorizationAllowDecision,
): AthenaAuthorizationAllowDecision;
function freezeDecision(
	decision: AthenaAuthorizationDenyDecision,
): AthenaAuthorizationDenyDecision;
function freezeDecision(
	decision: AthenaAuthorizationDecision,
): AthenaAuthorizationDecision {
	return Object.freeze({
		...decision,
		matchedRights: Object.freeze([...decision.matchedRights]),
		obligations: Object.freeze([...decision.obligations]),
		resource: Object.freeze({ ...decision.resource }),
		reason: Object.freeze({
			...decision.reason,
		}) as AthenaAuthorizationDecision["reason"],
	}) as AthenaAuthorizationDecision;
}

function validatePrincipal(
	principal: AthenaPrincipal,
): AthenaAuthorizationDenyReason | undefined {
	if (principal.authenticated !== true) {
		return { kind: "unauthenticated" };
	}
	if (!Array.isArray(principal.rights)) {
		return {
			detail: "principal.rights must be an array",
			kind: "principal_invalid",
		};
	}
	for (const right of principal.rights) {
		if (typeof right !== "string") {
			return {
				detail: "principal.rights contains a non-string entry",
				kind: "principal_invalid",
			};
		}
	}
}

function resolveMatchingRights(
	grantedRights: readonly AthenaRightKey[],
	requiredRight: AthenaRightKey,
): readonly AthenaResolvedRight[] {
	const matches: AthenaResolvedRight[] = [];
	for (const granted of grantedRights) {
		if (!rightMatches(granted, requiredRight)) {
			continue;
		}
		matches.push(
			Object.freeze({
				held: granted,
				matchKind: granted === requiredRight ? "exact" : "pattern",
				provenance: "principal.rights",
				required: requiredRight,
			}),
		);
	}
	return Object.freeze(matches);
}

function scopeFilterExpression(
	column: AthenaModelAuthorizationColumn,
	subject: "organizationId" | "tenantId" | "userId",
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

function buildObligations(input: {
	action: AthenaAuthorizationAction;
	scope?: {
		column: AthenaModelAuthorizationColumn;
		subject: "organizationId" | "tenantId" | "userId";
	};
}): readonly AthenaAuthorizationObligation[] {
	if (!input.scope) {
		return Object.freeze([]);
	}
	const filter = Object.freeze({
		expression: scopeFilterExpression(input.scope.column, input.scope.subject),
		kind: "filter" as const,
	});
	switch (input.action) {
		case "select":
		case "delete":
			return Object.freeze([filter]);
		case "insert":
			return Object.freeze([
				Object.freeze({
					column: input.scope.column.physical,
					kind: "bind",
					subject: input.scope.subject,
				}),
			]);
		case "update":
			return Object.freeze([
				filter,
				Object.freeze({
					column: input.scope.column.physical,
					kind: "immutable",
				}),
			]);
	}
}

function denyDecision(input: {
	action: AthenaAuthorizationAction;
	matchedRights?: readonly AthenaResolvedRight[];
	reason: AthenaAuthorizationDenyReason;
	requiredRight: AthenaRightKey;
	resource: AthenaAuthorizationResource;
}): AthenaAuthorizationDenyDecision {
	return freezeDecision({
		action: input.action,
		matchedRights: input.matchedRights ?? Object.freeze([]),
		obligations: [],
		outcome: "deny",
		reason: input.reason,
		requiredRight: input.requiredRight,
		resource: input.resource,
	});
}

function allowDecision(input: {
	action: AthenaAuthorizationAction;
	matchedRights: readonly AthenaResolvedRight[];
	obligations: readonly AthenaAuthorizationObligation[];
	policyDetail?: string;
	policyIds?: readonly string[];
	policyUsed: boolean;
	requiredRight: AthenaRightKey;
	resource: AthenaAuthorizationResource;
}): AthenaAuthorizationAllowDecision {
	return freezeDecision({
		action: input.action,
		matchedRights: input.matchedRights,
		obligations: input.obligations,
		outcome: "allow",
		reason: {
			kind: "allowed",
			...(input.policyDetail ? { policyDetail: input.policyDetail } : {}),
			...(input.policyIds ? { policyIds: input.policyIds } : {}),
			source: input.policyUsed ? "policy_allowed" : "effective_right_matched",
		},
		requiredRight: input.requiredRight,
		resource: input.resource,
	});
}

export function authorizeAthenaAuthorization(
	input: AthenaAuthorizationEngineInput,
): AthenaAuthorizationDecision {
	const principalFailure = validatePrincipal(input.principal);
	if (principalFailure) {
		return denyDecision({
			action: input.action,
			reason: principalFailure,
			requiredRight: input.requiredRight,
			resource: input.resource,
		});
	}

	const scoped = resolveAuthorizationScope({
		binding: input.binding,
		principal: input.principal,
		resource: input.resource,
	});
	if (!scoped.ok) {
		return denyDecision({
			action: input.action,
			reason: scoped.reason,
			requiredRight: input.requiredRight,
			resource: input.resource,
		});
	}

	const matchedRights = resolveMatchingRights(
		input.principal.rights,
		input.requiredRight,
	);
	if (matchedRights.length === 0) {
		return denyDecision({
			action: input.action,
			reason: {
				kind: "missing_right",
				missing: Object.freeze([input.requiredRight]),
			},
			requiredRight: input.requiredRight,
			resource: input.resource,
		});
	}

	const policy = evaluateAthenaAuthorizationPolicy({
		action: input.action,
		binding: input.binding,
		policies: input.policies,
		principal: input.principal,
	});
	if (policy.kind === "deny") {
		return denyDecision({
			action: input.action,
			matchedRights,
			reason: {
				detail: policy.decision.reason,
				kind: "policy_denied",
				policyIds: policy.decision.matchedPolicyIds,
				policyReason: policy.decision.reason,
			},
			requiredRight: input.requiredRight,
			resource: input.resource,
		});
	}

	const obligations = buildObligations({
		action: input.action,
		...(scoped.scope
			? {
					scope: {
						column: scoped.scope.column,
						subject: scoped.scope.subject,
					},
				}
			: {}),
	});
	return allowDecision({
		action: input.action,
		matchedRights,
		obligations,
		...(policy.kind === "allow"
			? {
					policyDetail: policy.decision.reason,
					policyIds: policy.decision.matchedPolicyIds,
				}
			: {}),
		policyUsed: policy.kind === "allow",
		requiredRight: input.requiredRight,
		resource: input.resource,
	});
}
