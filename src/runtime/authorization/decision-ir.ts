import type { AthenaPolicyDecisionReason } from "../../policy/decision.ts";
import type { PolicyExpr } from "../../policy/types.ts";
import type { AthenaRightKey } from "../../rights/key.ts";

export type AthenaAuthorizationAction = "select" | "insert" | "update" | "delete";

export interface AthenaAuthorizationResource {
	id?: string;
	kind: string;
	organizationId?: string;
	tenantId?: string;
	userId?: string;
}

export type AthenaAuthorizationScopeSubject =
	| "organizationId"
	| "tenantId"
	| "userId";

export type AthenaAuthorizationRightProvenance = "principal.rights";
export type AthenaAuthorizationMatchKind = "exact" | "pattern";

export interface AthenaResolvedRight {
	held: AthenaRightKey;
	matchKind: AthenaAuthorizationMatchKind;
	provenance: AthenaAuthorizationRightProvenance;
	required: AthenaRightKey;
}

export type AthenaAuthorizationObligation =
	| { kind: "filter"; expression: PolicyExpr }
	| { kind: "bind"; column: string; subject: AthenaAuthorizationScopeSubject }
	| { kind: "immutable"; column: string }
	| { kind: "audit"; detail?: string };

export interface AthenaAuthorizationAllowReason {
	kind: "allowed";
	policyDetail?: string;
	policyIds?: readonly string[];
	source: "effective_right_matched" | "policy_allowed";
}

export type AthenaAuthorizationDenyReason =
	| {
			kind: "missing_right";
			missing: readonly AthenaRightKey[];
	  }
	| {
			detail: string;
			kind: "policy_denied";
			policyIds: readonly string[];
			policyReason: AthenaPolicyDecisionReason;
	  }
	| {
			kind: "scope_mismatch";
			scope: AthenaAuthorizationScopeSubject;
	  }
	| {
			kind: "unauthenticated";
	  }
	| {
			detail: string;
			kind: "principal_invalid";
	  }
	| {
			kind: "trusted_subject_missing";
			subject: AthenaAuthorizationScopeSubject;
	  };

export type AthenaAuthorizationReason =
	| AthenaAuthorizationAllowReason
	| AthenaAuthorizationDenyReason;

interface AthenaAuthorizationDecisionBase {
	action: AthenaAuthorizationAction;
	matchedRights: readonly AthenaResolvedRight[];
	obligations: readonly AthenaAuthorizationObligation[];
	requiredRight: AthenaRightKey;
	resource: AthenaAuthorizationResource;
}

export interface AthenaAuthorizationAllowDecision
	extends AthenaAuthorizationDecisionBase {
	outcome: "allow";
	reason: AthenaAuthorizationAllowReason;
}

export interface AthenaAuthorizationDenyDecision
	extends Omit<AthenaAuthorizationDecisionBase, "obligations"> {
	outcome: "deny";
	obligations: readonly [];
	reason: AthenaAuthorizationDenyReason;
}

export type AthenaAuthorizationDecision =
	| AthenaAuthorizationAllowDecision
	| AthenaAuthorizationDenyDecision;

export function athenaAuthorizationReasonPublicMessage(
	reason: AthenaAuthorizationReason,
): "authorized" | "insufficient rights" | "not found" | "unauthorized" {
	switch (reason.kind) {
		case "allowed":
			return "authorized";
		case "missing_right":
		case "policy_denied":
			return "insufficient rights";
		case "scope_mismatch":
			return "not found";
		case "principal_invalid":
		case "trusted_subject_missing":
		case "unauthenticated":
			return "unauthorized";
	}
}
