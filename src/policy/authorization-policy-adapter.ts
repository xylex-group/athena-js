import type { AthenaPrincipal } from "../runtime/data/principal.ts";
import { applyAthenaPolicyDecision } from "./apply.ts";
import { AthenaPolicyBindError, bindPolicyExpr } from "./bind.ts";
import type { AthenaPolicyMode } from "./decision.ts";
import type { PolicyExpr, PolicyOperand } from "./types.ts";

const EMPTY_POLICY_IDS = Object.freeze([]) as readonly string[];
const SCOPE_LOWERING_PRINCIPAL = Object.freeze({
	authenticated: true,
	grants: Object.freeze([]),
	rights: Object.freeze([]),
}) satisfies AthenaPrincipal;

export type AthenaAuthorizationScopeLoweringResult =
	| { ok: true; payload: unknown }
	| {
			code: "trusted_subject_missing" | "unsupported_scope_expression";
			message: string;
			ok: false;
	  };

function bindTenantScopeOperand(
	operand: PolicyOperand,
	principal: AthenaPrincipal,
): PolicyOperand {
	if (
		operand.kind !== "subject" ||
		operand.subject.slot !== ("tenantId" as string)
	) {
		return operand;
	}
	if (!principal.tenantId) {
		throw new AthenaPolicyBindError("tenantId");
	}
	return {
		kind: "literal",
		value: {
			type: "string",
			value: principal.tenantId,
		},
	};
}

function bindTenantScopeExpr(
	expr: PolicyExpr,
	principal: AthenaPrincipal,
): PolicyExpr {
	switch (expr.op) {
		case "eq":
		case "ne":
		case "lt":
		case "lte":
		case "gt":
		case "gte":
			return {
				...expr,
				left: bindTenantScopeOperand(expr.left, principal),
				right: bindTenantScopeOperand(expr.right, principal),
			};
		case "is_null":
		case "is_not_null":
			return {
				...expr,
				operand: bindTenantScopeOperand(expr.operand, principal),
			};
		case "in":
			return {
				...expr,
				haystack: expr.haystack.map((item) =>
					bindTenantScopeOperand(item, principal),
				),
				needle: bindTenantScopeOperand(expr.needle, principal),
			};
		case "and":
		case "or":
			return {
				...expr,
				exprs: expr.exprs.map((child) => bindTenantScopeExpr(child, principal)),
			};
		case "not":
			return {
				...expr,
				expr: bindTenantScopeExpr(expr.expr, principal),
			};
		default:
			return expr;
	}
}

export function bindAuthorizationScopeExpression(input: {
	expression: PolicyExpr;
	principal: AthenaPrincipal;
}):
	| { ok: true; expression: PolicyExpr }
	| {
			code: "trusted_subject_missing";
			message: string;
			ok: false;
	  } {
	try {
		const tenantBound = bindTenantScopeExpr(input.expression, input.principal);
		return {
			expression: bindPolicyExpr(tenantBound, input.principal),
			ok: true,
		};
	} catch (error) {
		if (error instanceof AthenaPolicyBindError) {
			return {
				code: "trusted_subject_missing",
				message: error.message,
				ok: false,
			};
		}
		throw error;
	}
}

export function applyAuthorizationScopeFilterToPayload(input: {
	action: "select" | "delete";
	expression: PolicyExpr;
	payload: unknown;
	policyMode: AthenaPolicyMode;
	principal: AthenaPrincipal;
}): AthenaAuthorizationScopeLoweringResult {
	void input.policyMode;
	const bound = bindAuthorizationScopeExpression({
		expression: input.expression,
		principal: input.principal,
	});
	if (!bound.ok) {
		return bound;
	}
	const lowered = applyAthenaPolicyDecision({
		action: input.action,
		decision: {
			allowed: true,
			matchedPolicyIds: EMPTY_POLICY_IDS,
			mode: "enforce",
			reason: "allowed",
			visibility: bound.expression,
		},
		mode: "enforce",
		payload: input.payload,
		principal: SCOPE_LOWERING_PRINCIPAL,
	});
	if (lowered.ok) {
		return lowered;
	}
	if (lowered.code === "ATHENA_POLICY_SUBJECT_MISSING") {
		return {
			code: "trusted_subject_missing",
			message: lowered.message,
			ok: false,
		};
	}
	return {
		code: "unsupported_scope_expression",
		message: lowered.message,
		ok: false,
	};
}
