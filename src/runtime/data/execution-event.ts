import type { AthenaRuntimeExecutionEvent } from "./types.ts";

export function createAthenaRuntimeExecutionEvent(
  input: AthenaRuntimeExecutionEvent
): AthenaRuntimeExecutionEvent {
  return {
    ...input,
    runtime: "embedded",
  };
}

export function redactAthenaRuntimeExecutionEvent(
  event: AthenaRuntimeExecutionEvent,
  forbidden = [
    "password",
    "secret",
    "authorization",
    "cookie",
    "bearer",
    "database",
  ]
): AthenaRuntimeExecutionEvent {
  const redacted: AthenaRuntimeExecutionEvent = {
    affectedRows: event.affectedRows,
    afterHooksMs: event.afterHooksMs,
    audit: event.audit,
    authorizeMs: event.authorizeMs,
    backend: event.backend,
    beforeHooksMs: event.beforeHooksMs,
    compileMs: event.compileMs,
    decision: event.decision,
    errorKind: event.errorKind,
    errorPhase: event.errorPhase,
    eventId: event.eventId,
    executeMs: event.executeMs,
    operation: event.operation,
    policyIds: event.policyIds,
    prepareMs: event.prepareMs,
    principalAuthority: event.principalAuthority,
    requestId: event.requestId,
    resource: event.resource,
    runtime: "embedded",
    semanticOperation: event.semanticOperation,
    totalMs: event.totalMs,
    traceId: event.traceId,
    transactionSemantics: event.transactionSemantics,
  };
  const blob = JSON.stringify(redacted).toLowerCase();
  for (const token of forbidden) {
    if (blob.includes(token.toLowerCase())) {
      throw new Error(
        `AthenaRuntimeExecutionEvent leaked forbidden token: ${token}`
      );
    }
  }
  return redacted;
}
