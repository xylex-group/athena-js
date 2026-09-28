import { applyAthenaPolicyDecision } from "../../../policy/apply.ts";
import type {
  AthenaAuthorizationAction,
  AthenaAuthorizationDenyReason,
  AthenaAuthorizationObligation,
  AthenaAuthorizationScopeSubject,
} from "../../authorization/decision-ir.ts";
import { principalScopeSubjectValue } from "../../authorization/resource-context.ts";
import type { AthenaPrincipal } from "../principal.ts";
import {
  applyInsertScopeBinding,
  enforceUpdateScopeImmutable,
  hasConflictingScopeCondition,
} from "./scope-write.ts";

export type AthenaDataObligationResult =
  | { ok: true; payload: unknown }
  | { message: string; ok: false; reason: AthenaAuthorizationDenyReason };

export interface AthenaApplyDataObligationsInput {
  action: AthenaAuthorizationAction;
  obligations: readonly AthenaAuthorizationObligation[];
  payload: unknown;
  principal: AthenaPrincipal;
}

function filterScopeMeta(expression: {
  left?: unknown;
  op?: unknown;
  right?: unknown;
}): { column: string; subject: AthenaAuthorizationScopeSubject } | undefined {
  if (expression.op !== "eq") {
    return;
  }
  const left = expression.left as
    | { kind?: unknown; column?: { logical?: unknown; physical?: unknown } }
    | undefined;
  const right = expression.right as
    | { kind?: unknown; subject?: { slot?: unknown } }
    | undefined;
  if (!(left?.kind === "column" && right?.kind === "subject")) {
    return;
  }
  const subject = right.subject?.slot;
  if (
    subject !== "organizationId" &&
    subject !== "tenantId" &&
    subject !== "userId"
  ) {
    return;
  }
  const column =
    typeof left.column?.physical === "string"
      ? left.column.physical
      : typeof left.column?.logical === "string"
        ? left.column.logical
        : undefined;
  if (!column) {
    return;
  }
  return { column, subject };
}

function denied(
  reason: AthenaAuthorizationDenyReason,
  message: string
): AthenaDataObligationResult {
  return { message, ok: false, reason };
}

function applyFilterObligation(input: {
  action: AthenaAuthorizationAction;
  expression: AthenaAuthorizationObligation & { kind: "filter" };
  payload: unknown;
  principal: AthenaPrincipal;
}): AthenaDataObligationResult {
  const scope = filterScopeMeta(input.expression.expression);
  if (scope) {
    const principalValue = principalScopeSubjectValue(input.principal, scope.subject);
    if (!principalValue) {
      return denied(
        { kind: "trusted_subject_missing", subject: scope.subject },
        `Trusted subject ${scope.subject} is required for scoped filtering.`
      );
    }
    if (
      hasConflictingScopeCondition(input.payload, scope.column, principalValue)
    ) {
      return denied(
        { kind: "scope_mismatch", scope: scope.subject },
        `Caller scope for ${scope.column} conflicts with trusted ${scope.subject}.`
      );
    }
  }

  const applied = applyAthenaPolicyDecision({
    action: input.action,
    decision: {
      allowed: true,
      matchedPolicyIds: Object.freeze([]),
      mode: "enforce",
      reason: "allowed",
      visibility: input.expression.expression,
    },
    mode: "enforce",
    payload: input.payload,
    principal: input.principal,
  });
  if (applied.ok) {
    return { ok: true, payload: applied.payload };
  }
  if (applied.code === "ATHENA_POLICY_SUBJECT_MISSING" && scope) {
    return denied(
      { kind: "trusted_subject_missing", subject: scope.subject },
      applied.message
    );
  }
  return denied(
    {
      detail: applied.message,
      kind: "principal_invalid",
    },
    applied.message
  );
}

export function applyDataAuthorizationObligations(
  input: AthenaApplyDataObligationsInput
): AthenaDataObligationResult {
  let payload = input.payload;
  const scopeSubjectsByColumn = new Map<string, AthenaAuthorizationScopeSubject>();
  for (const obligation of input.obligations) {
    if (obligation.kind === "audit") {
      continue;
    }
    if (obligation.kind === "filter") {
      const applied = applyFilterObligation({
        action: input.action,
        expression: obligation,
        payload,
        principal: input.principal,
      });
      if (!applied.ok) {
        return applied;
      }
      const scope = filterScopeMeta(obligation.expression);
      if (scope) {
        scopeSubjectsByColumn.set(scope.column, scope.subject);
      }
      payload = applied.payload;
      continue;
    }
    if (obligation.kind === "bind") {
      const principalValue = principalScopeSubjectValue(
        input.principal,
        obligation.subject
      );
      if (!principalValue) {
        return denied(
          { kind: "trusted_subject_missing", subject: obligation.subject },
          `Trusted subject ${obligation.subject} is required for scoped writes.`
        );
      }
      const applied = applyInsertScopeBinding(
        payload,
        obligation.column,
        principalValue
      );
      if (!applied.ok) {
        return denied(
          { kind: "scope_mismatch", scope: obligation.subject },
          `Caller scope for ${obligation.column} conflicts with trusted ${obligation.subject}.`
        );
      }
      scopeSubjectsByColumn.set(obligation.column, obligation.subject);
      payload = applied.payload;
      continue;
    }
    const subject = scopeSubjectsByColumn.get(obligation.column);
    if (!subject) {
      return denied(
        {
          detail: `No trusted scope subject for immutable column "${obligation.column}".`,
          kind: "principal_invalid",
        },
        `No trusted scope subject for immutable column "${obligation.column}".`
      );
    }
    const principalValue = principalScopeSubjectValue(input.principal, subject);
    if (!principalValue) {
      return denied(
        { kind: "trusted_subject_missing", subject },
        `Trusted subject ${subject} is required for scoped writes.`
      );
    }
    const applied = enforceUpdateScopeImmutable(
      payload,
      obligation.column,
      principalValue
    );
    if (!applied.ok) {
      return denied(
        { kind: "scope_mismatch", scope: subject },
        `Caller attempted to reassign immutable scope column "${obligation.column}".`
      );
    }
    payload = applied.payload;
  }
  return { ok: true, payload };
}
