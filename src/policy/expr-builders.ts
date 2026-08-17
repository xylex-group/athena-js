import type {
  PolicyColumnRef,
  PolicyExpr,
  PolicyOperand,
  PolicyValue,
  SubjectRef,
} from "./types.ts";

/** Marker for policy expression nodes produced by the DSL. */
export const POLICY_EXPR = Symbol.for("athena.policy.expr");
export const POLICY_OPERAND = Symbol.for("athena.policy.operand");

export type PolicyExprNode = PolicyExpr & {
  readonly [POLICY_EXPR]: true;
};

export type PolicyOperandNode = PolicyOperand & {
  readonly [POLICY_OPERAND]: true;
  eq(other: PolicyOperandInput): PolicyExprNode;
  ne(other: PolicyOperandInput): PolicyExprNode;
  lt(other: PolicyOperandInput): PolicyExprNode;
  lte(other: PolicyOperandInput): PolicyExprNode;
  gt(other: PolicyOperandInput): PolicyExprNode;
  gte(other: PolicyOperandInput): PolicyExprNode;
  isNull(): PolicyExprNode;
  isNotNull(): PolicyExprNode;
  in(values: readonly PolicyOperandInput[]): PolicyExprNode;
};

export type PolicyOperandInput =
  | PolicyOperandNode
  | PolicyOperand
  | PolicyExprNode
  | string
  | number
  | boolean
  | null;

function asExpr(expr: PolicyExpr): PolicyExprNode {
  return Object.assign(expr, { [POLICY_EXPR]: true as const });
}

function literalValue(value: string | number | boolean | null): PolicyValue {
  if (value === null) {
    return { type: "null" };
  }
  if (typeof value === "boolean") {
    return { type: "bool", value };
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error("Policy v1 literals only support integers (no floats)");
    }
    return { type: "integer", value };
  }
  return { type: "string", value };
}

export function toOperand(input: PolicyOperandInput): PolicyOperand {
  if (input !== null && typeof input === "object" && POLICY_OPERAND in input) {
    const node = input as PolicyOperandNode;
    // Rebuild plain data (rest-destructure keeps symbol keys).
    if (node.kind === "column") {
      return { kind: "column", column: node.column };
    }
    if (node.kind === "subject") {
      return { kind: "subject", subject: node.subject };
    }
    if (node.kind === "literal") {
      return { kind: "literal", value: node.value };
    }
  }
  if (input !== null && typeof input === "object" && "kind" in input) {
    const plain = input as PolicyOperand;
    if (plain.kind === "column") {
      return { kind: "column", column: plain.column };
    }
    if (plain.kind === "subject") {
      return { kind: "subject", subject: plain.subject };
    }
    if (plain.kind === "literal") {
      return { kind: "literal", value: plain.value };
    }
  }
  if (
    typeof input === "string" ||
    typeof input === "number" ||
    typeof input === "boolean" ||
    input === null
  ) {
    return { kind: "literal", value: literalValue(input) };
  }
  throw new Error("Invalid policy operand");
}

export function createOperandNode(base: PolicyOperand): PolicyOperandNode {
  const node: PolicyOperandNode = {
    ...base,
    [POLICY_OPERAND]: true as const,
    eq(other: PolicyOperandInput): PolicyExprNode {
      return asExpr({ op: "eq", left: toOperand(node), right: toOperand(other) });
    },
    ne(other: PolicyOperandInput): PolicyExprNode {
      return asExpr({ op: "ne", left: toOperand(node), right: toOperand(other) });
    },
    lt(other: PolicyOperandInput): PolicyExprNode {
      return asExpr({ op: "lt", left: toOperand(node), right: toOperand(other) });
    },
    lte(other: PolicyOperandInput): PolicyExprNode {
      return asExpr({ op: "lte", left: toOperand(node), right: toOperand(other) });
    },
    gt(other: PolicyOperandInput): PolicyExprNode {
      return asExpr({ op: "gt", left: toOperand(node), right: toOperand(other) });
    },
    gte(other: PolicyOperandInput): PolicyExprNode {
      return asExpr({ op: "gte", left: toOperand(node), right: toOperand(other) });
    },
    isNull(): PolicyExprNode {
      return asExpr({ op: "is_null", operand: toOperand(node) });
    },
    isNotNull(): PolicyExprNode {
      return asExpr({ op: "is_not_null", operand: toOperand(node) });
    },
    in(values: readonly PolicyOperandInput[]): PolicyExprNode {
      return asExpr({
        op: "in",
        needle: toOperand(node),
        haystack: values.map(toOperand),
      });
    },
  };
  return node;
}

export function columnOperand(column: PolicyColumnRef): PolicyOperandNode {
  return createOperandNode({ kind: "column", column });
}

export function subjectOperand(subject: SubjectRef): PolicyOperandNode {
  return createOperandNode({ kind: "subject", subject });
}

export function and(...exprs: PolicyExprNode[]): PolicyExprNode {
  return asExpr({ op: "and", exprs: exprs.map(stripExpr) });
}

export function or(...exprs: PolicyExprNode[]): PolicyExprNode {
  return asExpr({ op: "or", exprs: exprs.map(stripExpr) });
}

export function not(expr: PolicyExprNode): PolicyExprNode {
  return asExpr({ op: "not", expr: stripExpr(expr) });
}

export function stripExpr(expr: PolicyExprNode | PolicyExpr): PolicyExpr {
  if (expr && typeof expr === "object" && POLICY_EXPR in expr) {
    const { [POLICY_EXPR]: _mark, ...rest } = expr as PolicyExprNode;
    void _mark;
    return rest as PolicyExpr;
  }
  return expr as PolicyExpr;
}

/** Symbolic auth subject bag used inside policy callbacks. */
export const auth = {
  userId: subjectOperand({ slot: "userId" }),
  organizationId: subjectOperand({ slot: "organizationId" }),
  sessionId: subjectOperand({ slot: "sessionId" }),
  roles: subjectOperand({ slot: "roles" }),
  permissions: subjectOperand({ slot: "permissions" }),
  /**
   * Bind a server-trusted claim path. The runtime fails closed if the path is
   * missing or was supplied by the request rather than Auth/session/API-key.
   */
  claim(path: string) {
    return subjectOperand({ slot: "claim", path });
  },
} as const;
