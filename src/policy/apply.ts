import type {
  AthenaConditionOperator,
  AthenaGatewayCondition,
  AthenaInsertPayload,
  AthenaUpdatePayload,
} from "../gateway/types.ts";
import type { AthenaPrincipal } from "../runtime/data/principal.ts";
import { AthenaPolicyBindError, bindPolicyExpr } from "./bind.ts";
import type { AthenaPolicyDecision, AthenaPolicyMode } from "./decision.ts";
import { AthenaPolicyEvalError, evaluatePolicyExpr } from "./eval-expr.ts";
import type { PolicyExpr, PolicyOperand } from "./types.ts";

export type AthenaPolicyApplyCode =
  | "ATHENA_POLICY_WRITE_CONFLICT"
  | "ATHENA_POLICY_SUBJECT_MISSING"
  | "ATHENA_POLICY_UNSUPPORTED_EXPRESSION";

export interface AthenaPolicyApplyOk {
  ok: true;
  payload: unknown;
}

export interface AthenaPolicyApplyDenied {
  code: AthenaPolicyApplyCode;
  message: string;
  ok: false;
}

export type AthenaPolicyApplyResult =
  | AthenaPolicyApplyOk
  | AthenaPolicyApplyDenied;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function columnName(operand: PolicyOperand): string | undefined {
  if (operand.kind !== "column") {
    return undefined;
  }
  return operand.column.physical ?? operand.column.logical;
}

function literalValue(operand: PolicyOperand): unknown {
  if (operand.kind !== "literal") {
    return undefined;
  }
  const value = operand.value;
  if (value.type === "null") {
    return null;
  }
  if (value.type === "list") {
    return value.value.map((item) =>
      item.type === "null" ? null : "value" in item ? item.value : null
    );
  }
  return value.value;
}

function exprToConditions(expr: PolicyExpr): AthenaGatewayCondition[] {
  switch (expr.op) {
    case "and":
      return expr.exprs.flatMap(exprToConditions);
    case "eq":
    case "ne":
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      const column = columnName(expr.left);
      if (!column) {
        throw new AthenaPolicyEvalError(
          `${expr.op} visibility requires a column on the left`
        );
      }
      const operator = expr.op === "ne" ? "neq" : expr.op;
      return [
        {
          column,
          operator,
          value: literalValue(expr.right) as AthenaGatewayCondition["value"],
        },
      ];
    }
    case "is_null":
    case "is_not_null": {
      const column = columnName(expr.operand);
      if (!column) {
        throw new AthenaPolicyEvalError("null visibility requires a column");
      }
      return [
        {
          column,
          operator: "is",
          value: expr.op === "is_null" ? null : "not_null",
        },
      ];
    }
    case "in": {
      const column = columnName(expr.needle);
      if (!column) {
        throw new AthenaPolicyEvalError("in visibility requires a column needle");
      }
      return [
        {
          column,
          operator: "in",
          value: expr.haystack.map(literalValue) as AthenaGatewayCondition["value"],
        },
      ];
    }
    case "or":
    case "not":
      throw new AthenaPolicyEvalError(
        `${expr.op} visibility cannot be lowered onto gateway conditions yet`
      );
    default:
      throw new AthenaPolicyEvalError("unknown visibility operator");
  }
}

function liftWhereToConditions(where: unknown): AthenaGatewayCondition[] {
  if (!isRecord(where)) {
    return [];
  }
  const out: AthenaGatewayCondition[] = [];
  for (const [column, raw] of Object.entries(where)) {
    if (column === "or" || column === "not" || raw === undefined) {
      continue;
    }
    if (!isRecord(raw)) {
      out.push({ column, operator: "eq", value: raw as AthenaGatewayCondition["value"] });
      continue;
    }
    for (const [operator, value] of Object.entries(raw)) {
      if (value === undefined) {
        continue;
      }
      out.push({
        column,
        operator: operator as AthenaConditionOperator,
        value: value as AthenaGatewayCondition["value"],
      });
    }
  }
  return out;
}

function injectVisibility(payload: unknown, visibility: PolicyExpr): unknown {
  if (!isRecord(payload)) {
    return payload;
  }
  const extra = exprToConditions(visibility);
  if (extra.length === 0) {
    return payload;
  }
  const existing = Array.isArray(payload.conditions)
    ? (payload.conditions as AthenaGatewayCondition[])
    : [];
  const lifted = liftWhereToConditions(payload.where);
  return {
    ...payload,
    conditions: [...existing, ...lifted, ...extra],
  };
}

function insertRows(payload: AthenaInsertPayload): Record<string, unknown>[] {
  const body = payload.insert_body;
  if (Array.isArray(body)) {
    return body.filter(isRecord);
  }
  return isRecord(body) ? [body] : [];
}

export function applyAthenaPolicyDecision(input: {
  action: "select" | "insert" | "update" | "delete";
  decision: AthenaPolicyDecision;
  mode: AthenaPolicyMode;
  payload: unknown;
  principal: AthenaPrincipal;
}): AthenaPolicyApplyResult {
  if (input.mode !== "enforce" || !input.decision.allowed) {
    return { ok: true, payload: input.payload };
  }

  try {
    let payload = input.payload;
    if (
      (input.action === "select" ||
        input.action === "update" ||
        input.action === "delete") &&
      input.decision.visibility
    ) {
      const bound = bindPolicyExpr(input.decision.visibility, input.principal);
      payload = injectVisibility(payload, bound);
    }

    if (input.action === "insert" && input.decision.check) {
      const bound = bindPolicyExpr(input.decision.check, input.principal);
      for (const row of insertRows(payload as AthenaInsertPayload)) {
        if (!evaluatePolicyExpr(bound, row)) {
          return {
            code: "ATHENA_POLICY_WRITE_CONFLICT",
            message: "Athena Policy rejected the INSERT row image.",
            ok: false,
          };
        }
      }
    }

    if (input.action === "update" && input.decision.check) {
      const bound = bindPolicyExpr(input.decision.check, input.principal);
      const update = payload as AthenaUpdatePayload;
      if (!isRecord(update.update_body)) {
        return {
          code: "ATHENA_POLICY_WRITE_CONFLICT",
          message: "Athena Policy requires a resulting-row image for UPDATE.",
          ok: false,
        };
      }
      if (!evaluatePolicyExpr(bound, update.update_body)) {
        return {
          code: "ATHENA_POLICY_WRITE_CONFLICT",
          message: "Athena Policy rejected the UPDATE resulting row.",
          ok: false,
        };
      }
    }

    return { ok: true, payload };
  } catch (error) {
    if (error instanceof AthenaPolicyBindError) {
      return {
        code: "ATHENA_POLICY_SUBJECT_MISSING",
        message: error.message,
        ok: false,
      };
    }
    if (error instanceof AthenaPolicyEvalError) {
      return {
        code: "ATHENA_POLICY_UNSUPPORTED_EXPRESSION",
        message: error.message,
        ok: false,
      };
    }
    throw error;
  }
}
