import type { AthenaDevtoolsAuthorizationDecisionInspector } from "../../devtools/protocol/authorization.ts";
import type { AthenaDevtoolsAuthorizationEvent } from "../../devtools/protocol/authorization-events.ts";
import {
  type AthenaRightKey,
  tryParseAthenaRightKey,
} from "../../rights/key.ts";
import { missingRequiredRights, rightMatches } from "../../rights/matching.ts";
import type { AthenaPrincipal } from "../data/principal.ts";

const DECISION_CAPACITY = 256;
const EVENT_CAPACITY = 256;

const decisions: AthenaDevtoolsAuthorizationDecisionInspector[] = [];
const timeline: AthenaDevtoolsAuthorizationEvent[] = [];

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

function pushBounded<T>(items: T[], item: T, capacity: number): void {
  items.push(item);
  while (items.length > capacity) {
    items.shift();
  }
}

export function recordAthenaAuthorizationTimelineEvent(
  event: Omit<AthenaDevtoolsAuthorizationEvent, "occurredAt"> & {
    occurredAt?: string;
  }
): void {
  pushBounded(
    timeline,
    {
      event: event.event,
      occurredAt: event.occurredAt ?? new Date().toISOString(),
      organizationId: event.organizationId,
      roleId: event.roleId,
      roleKey: event.roleKey,
      targetId: event.targetId,
      userId: event.userId,
    },
    EVENT_CAPACITY
  );
}

export function recordAthenaAuthorizationDecision(input: {
  domain: AthenaDevtoolsAuthorizationDecisionInspector["domain"];
  held: readonly string[];
  operation: string;
  organizationId?: string | null;
  policyOutcome?: string | null;
  policyIds?: readonly string[];
  requestId?: string | null;
  required: readonly string[];
  resource?: string | null;
  sessionId?: string | null;
  timingMs?: number | null;
  traceId?: string | null;
  userId?: string | null;
}): AthenaDevtoolsAuthorizationDecisionInspector {
  const held = parseKeys(input.held);
  const required = parseKeys(input.required);
  const missing = missingRequiredRights(held, required);
  const matched = required.flatMap((requiredKey) => {
    const holder = held.find((granted) => rightMatches(granted, requiredKey));
    if (!holder) {
      return [];
    }
    const matchKind: "exact" | "pattern" =
      holder === requiredKey ? "exact" : "pattern";
    return [
      {
        held: holder,
        matchKind,
        required: requiredKey,
      },
    ];
  });
  const outcome = missing.length === 0 ? "allow" : "deny";
  const decision: AthenaDevtoolsAuthorizationDecisionInspector = {
    authoritySources: [],
    decisionId: `authz-decision-${Date.now()}-${decisions.length}`,
    domain: input.domain,
    effectiveRights: held,
    matched,
    missing,
    operation: input.operation,
    outcome,
    policy: {
      outcome: input.policyOutcome ?? null,
      policyIds: [...(input.policyIds ?? [])],
    },
    requestId: input.requestId ?? null,
    required: { allOf: required },
    resource: input.resource ?? null,
    subject: {
      kind: "principal",
      organizationId: input.organizationId ?? null,
      sessionId: input.sessionId ?? null,
      userId: input.userId ?? null,
    },
    timingMs: input.timingMs ?? null,
    traceId: input.traceId ?? null,
  };
  pushBounded(decisions, decision, DECISION_CAPACITY);
  recordAthenaAuthorizationTimelineEvent({
    event:
      outcome === "allow"
        ? "authorization.decision.allowed"
        : "authorization.decision.denied",
    organizationId: input.organizationId ?? null,
    roleId: null,
    roleKey: null,
    targetId: decision.decisionId,
    userId: input.userId ?? null,
  });
  return decision;
}

export function recordAthenaAuthorizationDecisionFromPrincipal(input: {
  domain: AthenaDevtoolsAuthorizationDecisionInspector["domain"];
  operation: string;
  principal: Pick<
    AthenaPrincipal,
    "organizationId" | "rights" | "sessionId" | "userId"
  >;
  required: readonly string[];
  resource?: string | null;
}): AthenaDevtoolsAuthorizationDecisionInspector {
  return recordAthenaAuthorizationDecision({
    domain: input.domain,
    held: input.principal.rights,
    operation: input.operation,
    organizationId: input.principal.organizationId,
    required: input.required,
    resource: input.resource,
    sessionId: input.principal.sessionId,
    userId: input.principal.userId,
  });
}

export function listAthenaAuthorizationDecisions(
  limit = 50
): readonly AthenaDevtoolsAuthorizationDecisionInspector[] {
  return decisions.slice(-Math.max(0, limit)).reverse();
}

export function listAthenaAuthorizationTimeline(
  limit = 50
): readonly AthenaDevtoolsAuthorizationEvent[] {
  return timeline.slice(-Math.max(0, limit)).reverse();
}
