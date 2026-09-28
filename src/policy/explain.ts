import {
  type AthenaPrincipal,
  type AthenaPrincipalInput,
  normalizeAthenaPrincipal,
} from "../runtime/data/principal.ts";
import { bindPolicyExpr } from "./bind.ts";
import { decideAthenaPolicy } from "./decide.ts";
import { evaluatePolicyExpr } from "./eval-expr.ts";
import {
  createPolicyRegistry,
  normalizePolicyDefinitions,
} from "./registry.ts";
import type {
  PolicyActionName,
  PolicyExpr,
  PolicyIrDocument,
} from "./types.ts";

export type AthenaPolicyExplainInput = {
  action: PolicyActionName;
  document: PolicyIrDocument | unknown;
  principal?: unknown;
  resource: string;
  row?: Record<string, unknown>;
};

export type AthenaPolicyExplainResult = {
  action: PolicyActionName;
  allowed?: boolean;
  bound: false;
  composition: {
    permissive: number;
    restrictive: number;
  };
  matchedPolicyIds: readonly string[];
  principals: unknown[];
  reason?: string;
  resource: string;
  unboundCheck?: PolicyExpr;
  unboundVisibility?: PolicyExpr;
};

export type AthenaPolicySimulateInput = AthenaPolicyExplainInput & {
  row: Record<string, unknown>;
};

export type AthenaPolicySimulateResult = {
  action: PolicyActionName;
  allowed: boolean;
  bound: true;
  matchedPolicyIds: readonly string[];
  reason?: string;
  resource: string;
};

function asDocument(input: unknown): PolicyIrDocument {
  if (
    input &&
    typeof input === "object" &&
    Array.isArray((input as PolicyIrDocument).policies)
  ) {
    return input as PolicyIrDocument;
  }
  return {
    irVersion: 1,
    policies: normalizePolicyDefinitions(input),
  };
}

function principalFromInput(input: unknown): AthenaPrincipal {
  if (!input || typeof input !== "object") {
    return normalizeAthenaPrincipal({ authenticated: false });
  }
  const record = input as Record<string, unknown>;
  const kind = typeof record.kind === "string" ? record.kind : undefined;
  const authenticated =
    record.authenticated === true ||
    kind === "authenticated" ||
    kind === "admin" ||
    kind === "role" ||
    kind === "service";
  const claims =
    record.claims && typeof record.claims === "object"
      ? (record.claims as Record<string, unknown>)
      : undefined;
  const principal: AthenaPrincipalInput = {
    authenticated,
    grants: Array.isArray(record.grants)
      ? record.grants.map((item) => String(item))
      : [],
    rights: Array.isArray(record.rights)
      ? record.rights.map((item) => String(item))
      : [],
    ...(typeof record.userId === "string" ? { userId: record.userId } : {}),
    ...(typeof record.organizationId === "string"
      ? { organizationId: record.organizationId }
      : {}),
    ...(typeof record.sessionId === "string"
      ? { sessionId: record.sessionId }
      : {}),
    ...(typeof record.role === "string"
      ? { role: record.role }
      : kind === "role" && typeof record.name === "string"
        ? { role: record.name }
        : {}),
    ...(typeof record.service === "string" ? { service: record.service } : {}),
    ...(claims ? { claims } : {}),
  };
  return normalizeAthenaPrincipal(principal);
}

/**
 * Structural interrogation of compiled IR. Does not bind row operands.
 * Passing `row` is ignored so this never claims bound evaluation.
 */
export function explainAthenaPolicy(
  input: AthenaPolicyExplainInput
): AthenaPolicyExplainResult {
  const document = asDocument(input.document);
  const principal = principalFromInput(input.principal);
  const registry = createPolicyRegistry({
    definitions: document,
    mode: "observe",
  });
  const decision = decideAthenaPolicy(registry, {
    action: input.action,
    principal,
    resource: input.resource,
  });
  const matching = document.policies.filter((item) =>
    decision.matchedPolicyIds.includes(item.id)
  );
  return {
    action: input.action,
    allowed: decision.allowed,
    bound: false,
    composition: {
      permissive: matching.filter((item) => item.composition === "permissive")
        .length,
      restrictive: matching.filter((item) => item.composition === "restrictive")
        .length,
    },
    matchedPolicyIds: decision.matchedPolicyIds,
    principals: matching.flatMap((item) => item.principals),
    reason: decision.reason,
    resource: input.resource,
    ...(decision.check ? { unboundCheck: decision.check } : {}),
    ...(decision.visibility ? { unboundVisibility: decision.visibility } : {}),
  };
}

/**
 * Concrete evaluator: binds subject slots and evaluates against `--row`.
 */
export function simulateAthenaPolicy(
  input: AthenaPolicySimulateInput
): AthenaPolicySimulateResult {
  const document = asDocument(input.document);
  const principal = principalFromInput(input.principal);
  const registry = createPolicyRegistry({
    definitions: document,
    mode: "observe",
  });
  const decision = decideAthenaPolicy(registry, {
    action: input.action,
    principal,
    resource: input.resource,
  });
  if (!decision.allowed) {
    return {
      action: input.action,
      allowed: false,
      bound: true,
      matchedPolicyIds: decision.matchedPolicyIds,
      reason: decision.reason,
      resource: input.resource,
    };
  }
  let allowed = true;
  if (decision.visibility) {
    const bound = bindPolicyExpr(decision.visibility, principal);
    allowed = evaluatePolicyExpr(bound, input.row);
  }
  if (allowed && decision.check) {
    const bound = bindPolicyExpr(decision.check, principal);
    allowed = evaluatePolicyExpr(bound, input.row);
  }
  return {
    action: input.action,
    allowed,
    bound: true,
    matchedPolicyIds: decision.matchedPolicyIds,
    reason: allowed ? "allowed" : "row_predicate",
    resource: input.resource,
  };
}
