/**
 * Normalize PostgREST-style fluent `.or(string)` / `.not(...)` expressions
 * into a structured boolean tree before backend SQL compile.
 *
 * Supported:
 *   deleted.eq.false,deleted.is.null
 *   and(status.eq.active,deleted.is.null)
 *   or(and(a.eq.1,b.eq.2),c.eq.3)
 *   not.status.eq.offline
 *   not.and(status.eq.offline,role.eq.guest)
 *   (status.eq.active,role.eq.admin)
 */
import type {
  AthenaConditionOperator,
  AthenaConditionValue,
  AthenaGatewayCondition,
} from "../gateway/types.ts";

const SIMPLE_OPERATORS = new Set<AthenaConditionOperator>([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "is",
  "in",
]);

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class LegacyBooleanParseError extends Error {
  readonly code = "legacy_boolean_parse";

  constructor(message: string) {
    super(message);
    this.name = "LegacyBooleanParseError";
  }
}

export type LegacyBooleanNode =
  | { kind: "pred"; condition: AthenaGatewayCondition }
  | { children: LegacyBooleanNode[]; kind: "and" | "or" }
  | { child: LegacyBooleanNode; kind: "not" };

function coerceScalar(raw: string): AthenaConditionValue {
  const trimmed = raw.trim();
  if (trimmed === "null") {
    return null;
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed === "") {
    return "";
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

export function splitTopLevel(expression: string, separator: ","): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of expression) {
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
    }
    if (ch === separator && depth === 0) {
      if (current.trim()) {
        parts.push(current.trim());
      }
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

function unwrapBalancedParens(token: string): string | null {
  const trimmed = token.trim();
  if (!(trimmed.startsWith("(") && trimmed.endsWith(")"))) {
    return null;
  }
  let depth = 0;
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] === "(") {
      depth += 1;
    } else if (trimmed[i] === ")") {
      depth -= 1;
      if (depth === 0 && i !== trimmed.length - 1) {
        return null;
      }
    }
  }
  return depth === 0 ? trimmed.slice(1, -1) : null;
}

function parseGroupCall(
  token: string,
  name: "and" | "or"
): string | null {
  const match = new RegExp(`^${name}\\s*\\((.*)\\)$`, "is").exec(token.trim());
  if (!match) {
    return null;
  }
  return match[1] ?? "";
}

function parsePredicate(token: string): AthenaGatewayCondition {
  const parts = token.split(".");
  if (parts.length < 3) {
    throw new LegacyBooleanParseError(
      `Legacy boolean predicate must be column.op.value: ${token}`
    );
  }
  const column = parts[0]?.trim() ?? "";
  const operator = (parts[1]?.trim().toLowerCase() ??
    "") as AthenaConditionOperator;
  const rawValue = parts.slice(2).join(".");
  if (!IDENTIFIER.test(column)) {
    throw new LegacyBooleanParseError(
      `Legacy boolean column is not a safe identifier: ${column}`
    );
  }
  if (!SIMPLE_OPERATORS.has(operator)) {
    throw new LegacyBooleanParseError(
      `Legacy boolean operator "${operator}" is not supported`
    );
  }
  if (operator === "in") {
    const inner = rawValue.replace(/^\(|\)$/g, "");
    const values = splitTopLevel(inner, ",").map(coerceScalar);
    return { column, operator, value: values as never };
  }
  return {
    column,
    operator,
    value: coerceScalar(rawValue),
  };
}

function parseBooleanList(
  expression: string,
  join: "and" | "or"
): LegacyBooleanNode {
  const parts = splitTopLevel(expression, ",");
  if (parts.length === 0) {
    throw new LegacyBooleanParseError("Legacy boolean expression is empty");
  }
  const children = parts.map(parseTerm);
  if (children.length === 1) {
    return children[0] as LegacyBooleanNode;
  }
  return { children, kind: join };
}

function parseTerm(token: string): LegacyBooleanNode {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new LegacyBooleanParseError("Empty legacy boolean term");
  }

  const andInner = parseGroupCall(trimmed, "and");
  if (andInner !== null) {
    return parseBooleanList(andInner, "and");
  }
  const orInner = parseGroupCall(trimmed, "or");
  if (orInner !== null) {
    return parseBooleanList(orInner, "or");
  }

  const notCall = /^not\s*\((.*)\)$/is.exec(trimmed);
  if (notCall) {
    return { child: parseBooleanList(notCall[1] ?? "", "and"), kind: "not" };
  }
  if (/^not\./i.test(trimmed)) {
    return { child: parseTerm(trimmed.slice(4)), kind: "not" };
  }

  const grouped = unwrapBalancedParens(trimmed);
  if (grouped !== null) {
    return parseBooleanList(grouped, "and");
  }

  return { condition: parsePredicate(trimmed), kind: "pred" };
}

export function parseLegacyBooleanExpression(
  expression: string,
  root: "and" | "or" = "or"
): LegacyBooleanNode {
  const trimmed = expression.trim();
  if (!trimmed) {
    throw new LegacyBooleanParseError("Legacy boolean expression is empty");
  }
  return parseBooleanList(trimmed, root);
}

/**
 * Parse `.or("deleted.eq.false,deleted.is.null")` into structured conditions
 * when the expression is a flat OR of predicates. Nested trees stay as a
 * single `or`/`and`/`not` node for the SQL compiler.
 */
export function parseLegacyOrExpression(
  expression: string
): AthenaGatewayCondition[] {
  const tree = parseLegacyBooleanExpression(expression, "or");
  if (tree.kind === "pred") {
    return [tree.condition];
  }
  if (tree.kind === "or" && tree.children.every((child) => child.kind === "pred")) {
    return tree.children.map((child) =>
      child.kind === "pred" ? child.condition : child
    ) as AthenaGatewayCondition[];
  }
  throw new LegacyBooleanParseError(
    "Nested .or() groups require parseLegacyBooleanExpression"
  );
}

export function compileLegacyBooleanNode(
  node: LegacyBooleanNode,
  compilePredicate: (condition: AthenaGatewayCondition) => string
): string {
  switch (node.kind) {
    case "pred":
      return compilePredicate(node.condition);
    case "and":
      return `(${node.children.map((child) => compileLegacyBooleanNode(child, compilePredicate)).join(" AND ")})`;
    case "or":
      return `(${node.children.map((child) => compileLegacyBooleanNode(child, compilePredicate)).join(" OR ")})`;
    case "not":
      return `(NOT (${compileLegacyBooleanNode(node.child, compilePredicate)}))`;
    default:
      throw new LegacyBooleanParseError("Unknown legacy boolean node");
  }
}
