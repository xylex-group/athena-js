import { recordAthenaDevtoolsEvent } from "../devtools/buffer/index.ts";
import { sanitizeAthenaDevtoolsDataEvent } from "../devtools/sanitize/index.ts";

export type ChatExecutionOutcome = "denied" | "failure" | "success";

export interface ChatExecutionEvent {
  correlationId?: string;
  errorPhase?:
    | "authorize"
    | "principal"
    | "publish"
    | "transaction"
    | "validation";
  eventId?: string;
  operation: string;
  organizationId?: string;
  outcome: ChatExecutionOutcome;
  principalAuthority: string;
  requestId?: string;
  roomId?: string;
  roomSeq?: number | null;
  totalMs: number;
  traceId?: string;
  transactionSemantics: "atomic";
}

export function emitChatExecutionEvent(event: ChatExecutionEvent): void {
  const sanitized = sanitizeAthenaDevtoolsDataEvent({
    correlationId: event.correlationId,
    domain: "chat",
    errorPhase: event.errorPhase,
    event: `chat.${event.operation}`,
    eventId: event.eventId,
    organizationId: event.organizationId,
    operation: event.operation,
    outcome: event.outcome,
    principal: { authority: event.principalAuthority },
    requestId: event.requestId,
    resource: event.roomId,
    roomId: event.roomId,
    roomSeq: event.roomSeq,
    traceId: event.traceId,
    transactionSemantics: event.transactionSemantics,
    timings: { totalMs: event.totalMs },
  });
  if (sanitized && process.env.NODE_ENV !== "production") {
    recordAthenaDevtoolsEvent(sanitized);
  }
}
