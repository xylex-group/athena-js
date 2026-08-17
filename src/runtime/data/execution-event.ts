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
    backend: event.backend,
    compileMs: event.compileMs,
    decision: event.decision,
    errorKind: event.errorKind,
    executeMs: event.executeMs,
    operation: event.operation,
    policyIds: event.policyIds,
    principalAuthority: event.principalAuthority,
    requestId: event.requestId,
    resource: event.resource,
    runtime: "embedded",
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
