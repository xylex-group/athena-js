import type {
  AthenaDevtoolsDataEvent,
  AthenaDevtoolsDataTimings,
} from "../protocol/index.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function transactionSemantics(
  value: unknown
): AthenaDevtoolsDataEvent["transactionSemantics"] {
  if (
    value === "atomic" ||
    value === "backend-managed" ||
    value === "unknown"
  ) {
    return value;
  }
  return null;
}

function timingsFrom(value: unknown): AthenaDevtoolsDataTimings {
  const timings = isRecord(value) ? value : {};
  const billingRaw = isRecord(timings.billing) ? timings.billing : undefined;
  const phaseRaw = isRecord(billingRaw?.phaseTimings)
    ? billingRaw.phaseTimings
    : undefined;
  return {
    afterHooksMs: nullableNumber(timings.afterHooksMs),
    authorizeMs: nullableNumber(timings.authorizeMs),
    beforeHooksMs: nullableNumber(timings.beforeHooksMs),
    ...(billingRaw
      ? {
          billing: {
            phaseTimings: {
              checkpointMs: nullableNumber(phaseRaw?.checkpointMs) ?? undefined,
              projectionMs: nullableNumber(phaseRaw?.projectionMs) ?? undefined,
              providerMs: nullableNumber(phaseRaw?.providerMs) ?? undefined,
              resolveMs: nullableNumber(phaseRaw?.resolveMs) ?? undefined,
              transactionMs:
                nullableNumber(phaseRaw?.transactionMs) ?? undefined,
            },
            providerResourceId:
              nullableString(billingRaw.providerResourceId) ?? undefined,
            resourceId: nullableString(billingRaw.resourceId) ?? undefined,
            resourceKind: nullableString(billingRaw.resourceKind) ?? undefined,
          },
        }
      : {}),
    executeMs: nullableNumber(timings.executeMs),
    prepareMs: nullableNumber(timings.prepareMs),
    totalMs: nullableNumber(timings.totalMs),
  };
}

/** Allowlisted Data Nucleus summary. Drops payloads, records, and unknown keys. */
export function sanitizeAthenaDevtoolsDataEvent(
  value: unknown
): AthenaDevtoolsDataEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const principal = isRecord(value.principal) ? value.principal : null;
  const operation = nullableString(value.operation);
  const organizationId = nullableString(value.organizationId);
  const roomId = nullableString(value.roomId);
  const roomSeq = nullableNumber(value.roomSeq);
  if (!operation) {
    return null;
  }
  return {
    affectedRows: nullableNumber(value.affectedRows),
    connectionId: nullableString(value.connectionId) ? "configured" : null,
    correlationId: nullableString(value.correlationId),
    domain:
      value.domain === "auth" ||
      value.domain === "billing" ||
      value.domain === "chat" ||
      value.domain === "data" ||
      value.domain === "storage"
        ? value.domain
        : null,
    errorPhase: nullableString(value.errorPhase),
    event: nullableString(value.event) ?? operation,
    eventId: nullableString(value.eventId),
    operation,
    ...(organizationId ? { organizationId } : {}),
    outcome: nullableString(value.outcome),
    policyIds: Array.isArray(value.policyIds)
      ? value.policyIds.filter(
          (id): id is string => typeof id === "string" && Boolean(id.trim())
        )
      : null,
    policyOutcome: nullableString(value.policyOutcome),
    principal: {
      authority: nullableString(principal?.authority),
    },
    provider: nullableString(value.provider),
    requestId: nullableString(value.requestId),
    resource: nullableString(value.resource),
    ...(roomId ? { roomId } : {}),
    ...(value.roomSeq !== undefined ? { roomSeq } : {}),
    timings: timingsFrom(value.timings),
    traceId: nullableString(value.traceId),
    transactionSemantics: transactionSemantics(value.transactionSemantics),
  };
}

export function sanitizeAthenaDevtoolsDataEvents(
  value: unknown
): AthenaDevtoolsDataEvent[] {
  if (!Array.isArray(value)) {
    if (isRecord(value) && Array.isArray(value.events)) {
      return sanitizeAthenaDevtoolsDataEvents(value.events);
    }
    return [];
  }
  return value
    .map((entry) => sanitizeAthenaDevtoolsDataEvent(entry))
    .filter((entry): entry is AthenaDevtoolsDataEvent => entry !== null);
}
