import {
  type AthenaRightKey,
  tryParseAthenaRightKey,
} from "../../rights/key.ts";
import { missingRequiredRights, rightMatches } from "../../rights/matching.ts";
import type {
  AthenaDevtoolsAuthorizationDecisionMatch,
  AthenaDevtoolsAuthorizationRoleInspector,
} from "./authorization.ts";

export type AthenaDevtoolsAuthorizationExplainInput = {
  held: readonly string[];
  required: readonly string[];
};

export type AthenaDevtoolsAuthorizationExplainResult = {
  held: readonly AthenaRightKey[];
  matched: readonly AthenaDevtoolsAuthorizationDecisionMatch[];
  missing: readonly AthenaRightKey[];
  outcome: "allow" | "deny";
  required: readonly AthenaRightKey[];
  suggestedExplanation: string;
};

export type AthenaDevtoolsAuthorizationWhatIfInput = {
  addRoleKeys?: readonly string[];
  held: readonly string[];
  removeGrantRightKeys?: readonly string[];
  roles: readonly Pick<
    AthenaDevtoolsAuthorizationRoleInspector,
    "key" | "rights"
  >[];
};

export type AthenaDevtoolsAuthorizationWhatIfResult = {
  added: readonly AthenaRightKey[];
  next: readonly AthenaRightKey[];
  removed: readonly AthenaRightKey[];
};

function parseKeys(values: readonly string[]): AthenaRightKey[] {
  const keys: AthenaRightKey[] = [];
  for (const value of values) {
    const parsed = tryParseAthenaRightKey(value);
    if (parsed) {
      keys.push(parsed);
    }
  }
  return keys;
}

function matchKind(
  held: AthenaRightKey,
  required: AthenaRightKey
): "exact" | "pattern" {
  return held === required ? "exact" : "pattern";
}

export function explainAthenaAuthorization(
  input: AthenaDevtoolsAuthorizationExplainInput
): AthenaDevtoolsAuthorizationExplainResult {
  const held = parseKeys(input.held);
  const required = parseKeys(input.required);
  const missing = missingRequiredRights(held, required);
  const matched: AthenaDevtoolsAuthorizationDecisionMatch[] = [];
  for (const requiredKey of required) {
    const holder = held.find((granted) => rightMatches(granted, requiredKey));
    if (!holder) {
      continue;
    }
    matched.push({
      held: holder,
      matchKind: matchKind(holder, requiredKey),
      required: requiredKey,
    });
  }
  const outcome = missing.length === 0 ? "allow" : "deny";
  const suggestedExplanation =
    outcome === "allow"
      ? "Every required right is satisfied by an effective holding."
      : `The selected principal has no effective grant satisfying ${missing.join(", ")}.`;
  return {
    held,
    matched,
    missing,
    outcome,
    required,
    suggestedExplanation,
  };
}

export function simulateAthenaAuthorizationWhatIf(
  input: AthenaDevtoolsAuthorizationWhatIfInput
): AthenaDevtoolsAuthorizationWhatIfResult {
  const current = new Set(parseKeys(input.held));
  const next = new Set(current);
  for (const roleKey of input.addRoleKeys ?? []) {
    const role = input.roles.find((entry) => entry.key === roleKey);
    if (!role) {
      continue;
    }
    for (const key of role.rights) {
      next.add(key);
    }
  }
  for (const key of parseKeys(input.removeGrantRightKeys ?? [])) {
    next.delete(key);
  }
  const added = [...next].filter((key) => !current.has(key)).sort();
  const removed = [...current].filter((key) => !next.has(key)).sort();
  return {
    added,
    next: [...next].sort(),
    removed,
  };
}
