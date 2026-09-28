import type { PolicyExpr } from "./types.ts";

export type AthenaPolicyMode = "disabled" | "observe" | "enforce";

export type AthenaPolicyDecisionReason =
  | "allowed"
  | "disabled"
  | "no_matching_policy"
  | "principal_not_allowed"
  | "unsupported_expression"
  | "invalid_policy";

export interface AthenaPolicyDecision {
  allowed: boolean;
  check?: PolicyExpr;
  matchedPolicyIds: readonly string[];
  mode: AthenaPolicyMode;
  reason: AthenaPolicyDecisionReason;
  visibility?: PolicyExpr;
}

export function actionFromRuntimeOperation(
  operation: "fetch" | "insert" | "update" | "delete" | "query" | "rpc"
): "select" | "insert" | "update" | "delete" | undefined {
  switch (operation) {
    case "fetch":
      return "select";
    case "insert":
      return "insert";
    case "update":
      return "update";
    case "delete":
      return "delete";
    default:
      return;
  }
}
