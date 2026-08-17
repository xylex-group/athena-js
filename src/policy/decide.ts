import type { AthenaPrincipal } from "../runtime/data/principal.ts";
import type {
  AthenaPolicyDecision,
  AthenaPolicyDecisionReason,
} from "./decision.ts";
import { policyAppliesToPrincipal } from "./match-principal.ts";
import type { AthenaPolicyRegistry } from "./registry.ts";
import type { PolicyActionName, PolicyDefinition, PolicyExpr } from "./types.ts";

export interface DecideAthenaPolicyInput {
  action: PolicyActionName;
  principal: AthenaPrincipal;
  resource: string;
}

function combineOr(exprs: PolicyExpr[]): PolicyExpr | undefined {
  if (exprs.length === 0) {
    return undefined;
  }
  if (exprs.length === 1) {
    return exprs[0];
  }
  return { exprs, op: "or" };
}

function combineAnd(exprs: PolicyExpr[]): PolicyExpr | undefined {
  if (exprs.length === 0) {
    return undefined;
  }
  if (exprs.length === 1) {
    return exprs[0];
  }
  return { exprs, op: "and" };
}

function composeGroup(
  matching: readonly PolicyDefinition[],
  field: "visibility" | "check"
): PolicyExpr | undefined {
  const permissive = matching.filter((item) => item.composition === "permissive");
  const restrictive = matching.filter((item) => item.composition === "restrictive");

  const unrestrictedPermissive = permissive.some((item) => !item[field]);
  const permissiveExprs = unrestrictedPermissive
    ? []
    : permissive
        .map((item) => item[field])
        .filter((expr): expr is PolicyExpr => expr !== undefined);
  const restrictiveExprs = restrictive
    .map((item) => item[field])
    .filter((expr): expr is PolicyExpr => expr !== undefined);

  const permissiveExpr = unrestrictedPermissive
    ? undefined
    : combineOr(permissiveExprs);
  const parts: PolicyExpr[] = [];
  if (permissiveExpr) {
    parts.push(permissiveExpr);
  }
  parts.push(...restrictiveExprs);
  return combineAnd(parts);
}

function decision(
  input: Omit<AthenaPolicyDecision, "matchedPolicyIds"> & {
    matchedPolicyIds?: readonly string[];
  }
): AthenaPolicyDecision {
  return {
    allowed: input.allowed,
    matchedPolicyIds: Object.freeze([...(input.matchedPolicyIds ?? [])]),
    mode: input.mode,
    reason: input.reason,
    ...(input.visibility ? { visibility: input.visibility } : {}),
    ...(input.check ? { check: input.check } : {}),
  };
}

/**
 * Produce a structured Policy decision.
 *
 * Visibility/check remain PolicyExpr IR. Subject slots are not substituted (R4).
 * Composition follows Rust: `(OR permissives) AND (AND restrictives)`.
 * Empty applicable permissive set is deny (Postgres RLS).
 */
export function decideAthenaPolicy(
  registry: AthenaPolicyRegistry,
  input: DecideAthenaPolicyInput
): AthenaPolicyDecision {
  if (registry.mode === "disabled") {
    return decision({
      allowed: true,
      mode: "disabled",
      reason: "disabled",
    });
  }

  const candidates = registry.get(input.resource, input.action);
  if (candidates.length === 0) {
    return decision({
      allowed: false,
      mode: registry.mode,
      reason: "no_matching_policy",
    });
  }

  const matching = candidates.filter((item) =>
    policyAppliesToPrincipal(item.principals, input.principal)
  );
  const matchingIds = matching.map((item) => item.id);
  const permissiveMatches = matching.filter(
    (item) => item.composition === "permissive"
  );

  let reason: AthenaPolicyDecisionReason = "allowed";
  let allowed = true;
  if (permissiveMatches.length === 0) {
    allowed = false;
    reason =
      matching.length === 0 ? "no_matching_policy" : "principal_not_allowed";
  }

  return decision({
    allowed,
    check: allowed ? composeGroup(matching, "check") : undefined,
    matchedPolicyIds: matchingIds,
    mode: registry.mode,
    reason,
    visibility: allowed ? composeGroup(matching, "visibility") : undefined,
  });
}
