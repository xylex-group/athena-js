import type { AthenaPrincipal } from "../runtime/data/principal.ts";
import type { PolicyExpr, PolicyOperand, PolicyValue, SubjectRef } from "./types.ts";

export class AthenaPolicyBindError extends Error {
  readonly code = "ATHENA_POLICY_SUBJECT_MISSING";
  readonly slot: string;

  constructor(slot: string) {
    super(`ATHENA_POLICY_SUBJECT_MISSING: required subject slot "${slot}" is not bound`);
    this.name = "AthenaPolicyBindError";
    this.slot = slot;
  }
}

function slotName(subject: SubjectRef): string {
  return subject.slot === "claim" ? `claim:${subject.path}` : subject.slot;
}

function subjectValue(
  subject: SubjectRef,
  principal: AthenaPrincipal
): PolicyValue {
  switch (subject.slot) {
    case "userId":
      if (!principal.userId) {
        throw new AthenaPolicyBindError("userId");
      }
      return { type: "string", value: principal.userId };
    case "organizationId":
      if (!principal.organizationId) {
        throw new AthenaPolicyBindError("organizationId");
      }
      return { type: "string", value: principal.organizationId };
    case "sessionId":
      if (!principal.sessionId) {
        throw new AthenaPolicyBindError("sessionId");
      }
      return { type: "string", value: principal.sessionId };
    case "roles":
      return {
        type: "list",
        value: principal.role
          ? [{ type: "string", value: principal.role }]
          : [],
      };
    case "permissions":
      return {
        type: "list",
        value: principal.rights.map((right) => ({
          type: "string" as const,
          value: right,
        })),
      };
    case "claim": {
      const raw = principal.claims?.[subject.path];
      if (raw === undefined) {
        throw new AthenaPolicyBindError(`claim:${subject.path}`);
      }
      if (raw === null) {
        return { type: "null" };
      }
      if (typeof raw === "boolean") {
        return { type: "bool", value: raw };
      }
      if (typeof raw === "number" && Number.isInteger(raw)) {
        return { type: "integer", value: raw };
      }
      return { type: "string", value: String(raw) };
    }
    default:
      throw new AthenaPolicyBindError(slotName(subject));
  }
}

export function bindPolicyOperand(
  operand: PolicyOperand,
  principal: AthenaPrincipal
): PolicyOperand {
  if (operand.kind !== "subject") {
    return operand;
  }
  return {
    kind: "literal",
    value: subjectValue(operand.subject, principal),
  };
}

export function bindPolicyExpr(
  expr: PolicyExpr,
  principal: AthenaPrincipal
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
        left: bindPolicyOperand(expr.left, principal),
        right: bindPolicyOperand(expr.right, principal),
      };
    case "is_null":
    case "is_not_null":
      return {
        ...expr,
        operand: bindPolicyOperand(expr.operand, principal),
      };
    case "in":
      return {
        ...expr,
        haystack: expr.haystack.map((item) =>
          bindPolicyOperand(item, principal)
        ),
        needle: bindPolicyOperand(expr.needle, principal),
      };
    case "and":
    case "or":
      return {
        ...expr,
        exprs: expr.exprs.map((child) => bindPolicyExpr(child, principal)),
      };
    case "not":
      return {
        ...expr,
        expr: bindPolicyExpr(expr.expr, principal),
      };
    default:
      return expr;
  }
}
