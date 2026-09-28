import { decideAthenaPolicy } from "../../policy/decide.ts";
import type { AthenaPolicyDecision } from "../../policy/decision.ts";
import type { AthenaPolicyRegistry } from "../../policy/registry.ts";
import type { PolicyActionName } from "../../policy/types.ts";
import type { AthenaPrincipal } from "../data/principal.ts";
import type { AthenaAuthorizationAction } from "./decision-ir.ts";
import type { AthenaModelAuthorizationBinding } from "./model-binding.ts";

export type AthenaAuthorizationPolicyEvaluation =
	| { kind: "not_applicable" }
	| { kind: "allow"; decision: AthenaPolicyDecision }
	| { kind: "deny"; decision: AthenaPolicyDecision };

function policyActionFromAuthorizationAction(
	action: AthenaAuthorizationAction,
): PolicyActionName {
	switch (action) {
		case "select":
		case "insert":
		case "update":
		case "delete":
			return action;
	}
}

export function evaluateAthenaAuthorizationPolicy(input: {
	action: AthenaAuthorizationAction;
	binding: AthenaModelAuthorizationBinding;
	policies?: AthenaPolicyRegistry;
	principal: AthenaPrincipal;
}): AthenaAuthorizationPolicyEvaluation {
	if (!input.policies) {
		return { kind: "not_applicable" };
	}
	const decision = decideAthenaPolicy(input.policies, {
		action: policyActionFromAuthorizationAction(input.action),
		principal: input.principal,
		resource: input.binding.resource.table,
	});
	if (decision.mode === "disabled") {
		return { kind: "not_applicable" };
	}
	if (!decision.allowed) {
		return { decision, kind: "deny" };
	}
	return { decision, kind: "allow" };
}
