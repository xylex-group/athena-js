/**
 * Shared operation envelope for domain hooks, audit_log_auth, and traces_auth.
 * One correlation model: eventId + traceId + actor + request.
 */

export interface AthenaAuthActor {
  kind: "admin" | "system" | "user";
  organizationId?: string;
  sessionId?: string;
  userId?: string;
}

export interface AthenaAuthRequestContext {
  ipAddress?: string;
  method: string;
  path: string;
  userAgent?: string;
}

export interface AthenaAuthOperationContext {
  actor: AthenaAuthActor;
  eventId: string;
  request: AthenaAuthRequestContext;
  traceId: string;
}

export function createAuthOperationContext(
  context: Omit<AthenaAuthOperationContext, "eventId">,
  eventId = crypto.randomUUID()
): AthenaAuthOperationContext {
  return {
    actor: context.actor,
    eventId,
    request: context.request,
    traceId: context.traceId,
  };
}
