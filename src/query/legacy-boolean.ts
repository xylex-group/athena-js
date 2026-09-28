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
  AthenaConditionArrayValue,
  AthenaConditionValue,
  AthenaGatewayCondition,
} from "../gateway/types.ts";
import type {
  AthenaComparePredicateNode,
  AthenaPredicateNode,
} from "./descriptor.ts";

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

function parseGroupCall(token: string, name: "and" | "or"): string | null {
  const match = new RegExp(`^${name}\\s*\\((.*)\\)$`, "is").exec(token.trim());
  if (!match) {
    return null;
  }
  return match[1] ?? "";
}

function parsePredicate(token: string): AthenaComparePredicateNode {
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
    return {
      column,
      kind: "compare",
      operator,
      value: values,
    };
  }
  return {
    column,
    kind: "compare",
    operator,
    value: coerceScalar(rawValue),
  };
}

function parseBooleanList(
  expression: string,
  join: "and" | "or"
): AthenaPredicateNode {
  const parts = splitTopLevel(expression, ",");
  if (parts.length === 0) {
    throw new LegacyBooleanParseError("Legacy boolean expression is empty");
  }
  const children = parts.map(parseTerm);
  if (children.length === 1) {
    const [first] = children;
    if (first) {
      return first;
    }
  }
  return { kind: join, nodes: children };
}

function parseTerm(token: string): AthenaPredicateNode {
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
    return { kind: "not", node: parseBooleanList(notCall[1] ?? "", "and") };
  }
  if (/^not\./i.test(trimmed)) {
    return { kind: "not", node: parseTerm(trimmed.slice(4)) };
  }

  const grouped = unwrapBalancedParens(trimmed);
  if (grouped !== null) {
    return parseBooleanList(grouped, "and");
  }

  return parsePredicate(trimmed);
}

export function parseLegacyBooleanExpression(
  expression: string,
  root: "and" | "or" = "or"
): AthenaPredicateNode {
  const trimmed = expression.trim();
  if (!trimmed) {
    throw new LegacyBooleanParseError("Legacy boolean expression is empty");
  }
  return parseBooleanList(trimmed, root);
}

function isConditionValue(
  value: unknown
): value is AthenaConditionValue | AthenaConditionArrayValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item === null ||
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean"
    )
  );
}

export function athenaPredicateToGatewayCondition(
  predicate: AthenaComparePredicateNode
): AthenaGatewayCondition {
  if (
    typeof predicate.column !== "string" ||
    !SIMPLE_OPERATORS.has(predicate.operator as AthenaConditionOperator) ||
    !isConditionValue(predicate.value)
  ) {
    throw new LegacyBooleanParseError(
      "Legacy boolean predicate could not be projected to a gateway condition"
    );
  }
  return {
    column: predicate.column,
    operator: predicate.operator as AthenaConditionOperator,
    value: predicate.value,
  };
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
  if (tree.kind === "compare") {
    return [athenaPredicateToGatewayCondition(tree)];
  }
  if (
    tree.kind === "or" &&
    tree.nodes.every((child) => child.kind === "compare")
  ) {
    return tree.nodes.map((child) =>
      athenaPredicateToGatewayCondition(child)
    );
  }
  throw new LegacyBooleanParseError(
    "Nested .or() groups require parseLegacyBooleanExpression"
  );
}

export function compileAthenaPredicateNode(
  node: AthenaPredicateNode,
  compilePredicate: (predicate: AthenaComparePredicateNode) => string
): string {
  switch (node.kind) {
    case "compare":
      return compilePredicate(node);
    case "and":
      return `(${node.nodes.map((child) => compileAthenaPredicateNode(child, compilePredicate)).join(" AND ")})`;
    case "or":
      return `(${node.nodes.map((child) => compileAthenaPredicateNode(child, compilePredicate)).join(" OR ")})`;
    case "not":
      return `(NOT (${compileAthenaPredicateNode(node.node, compilePredicate)}))`;
    default:
      throw new LegacyBooleanParseError("Unknown Athena predicate node");
  }
}
