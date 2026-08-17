import type { PolicyExpr, PolicyOperand, PolicyValue } from "./types.ts";

export class AthenaPolicyEvalError extends Error {
  readonly code = "ATHENA_POLICY_UNSUPPORTED_EXPRESSION";

  constructor(message: string) {
    super(`ATHENA_POLICY_UNSUPPORTED_EXPRESSION: ${message}`);
    this.name = "AthenaPolicyEvalError";
  }
}

function unwrapValue(value: PolicyValue): unknown {
  switch (value.type) {
    case "null":
      return null;
    case "bool":
      return value.value;
    case "string":
    case "uuid":
    case "date_time":
      return value.value;
    case "integer":
      return value.value;
    case "list":
      return value.value.map(unwrapValue);
    default:
      return undefined;
  }
}

function readOperand(
  operand: PolicyOperand,
  row: Record<string, unknown>
): unknown {
  if (operand.kind === "literal") {
    return unwrapValue(operand.value);
  }
  if (operand.kind === "subject") {
    throw new AthenaPolicyEvalError(
      `unbound subject slot "${operand.subject.slot}"`
    );
  }
  const logical = operand.column.logical;
  const physical = operand.column.physical;
  if (physical && physical in row) {
    return row[physical];
  }
  if (logical in row) {
    return row[logical];
  }
  throw new AthenaPolicyEvalError(
    `column "${physical ?? logical}" is missing from the row image`
  );
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left === null || left === undefined) {
    return right === null || right === undefined;
  }
  if (right === null || right === undefined) {
    return false;
  }
  if (typeof left === "boolean" || typeof right === "boolean") {
    return Boolean(left) === Boolean(right);
  }
  const ln = asNumber(left);
  const rn = asNumber(right);
  if (ln !== undefined && rn !== undefined) {
    return ln === rn;
  }
  return String(left) === String(right);
}

function compareOrd(left: unknown, right: unknown): number | undefined {
  const ln = asNumber(left);
  const rn = asNumber(right);
  if (ln !== undefined && rn !== undefined) {
    return ln === rn ? 0 : ln < rn ? -1 : 1;
  }
  if (typeof left === "string" && typeof right === "string") {
    return left.localeCompare(right);
  }
  return undefined;
}

export function evaluatePolicyExpr(
  expr: PolicyExpr,
  row: Record<string, unknown>
): boolean {
  switch (expr.op) {
    case "and":
      return expr.exprs.every((child) => evaluatePolicyExpr(child, row));
    case "or":
      return expr.exprs.some((child) => evaluatePolicyExpr(child, row));
    case "not":
      return !evaluatePolicyExpr(expr.expr, row);
    case "is_null": {
      const value = readOperand(expr.operand, row);
      return value === null || value === undefined;
    }
    case "is_not_null": {
      const value = readOperand(expr.operand, row);
      return value !== null && value !== undefined;
    }
    case "in": {
      const needle = readOperand(expr.needle, row);
      if (expr.haystack.length === 0) {
        return false;
      }
      return expr.haystack.some((item) =>
        valuesEqual(needle, readOperand(item, row))
      );
    }
    case "eq":
      return valuesEqual(readOperand(expr.left, row), readOperand(expr.right, row));
    case "ne":
      return !valuesEqual(readOperand(expr.left, row), readOperand(expr.right, row));
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      const ord = compareOrd(
        readOperand(expr.left, row),
        readOperand(expr.right, row)
      );
      if (ord === undefined) {
        throw new AthenaPolicyEvalError(
          `cannot compare operands for ${expr.op}`
        );
      }
      if (expr.op === "lt") {
        return ord < 0;
      }
      if (expr.op === "lte") {
        return ord <= 0;
      }
      if (expr.op === "gt") {
        return ord > 0;
      }
      return ord >= 0;
    }
    default:
      throw new AthenaPolicyEvalError("unknown operator");
  }
}
