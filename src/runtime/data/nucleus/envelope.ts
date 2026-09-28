import type { AthenaRuntimeRequestContext } from "../types.ts";

export type AthenaDataNucleusEnvelope = {
  readonly eventId: string;
  readonly requestId: string;
  readonly traceId: string;
};

function headerValue(
  headers: Record<string, string> | undefined,
  name: string
): string | undefined {
  if (!headers) {
    return;
  }
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && value.trim()) {
      return value.trim();
    }
  }
}

function mintId(): string {
  return crypto.randomUUID();
}

export function resolveDataNucleusTraceId(
  context?: AthenaRuntimeRequestContext
): string {
  const fromContext =
    typeof context?.traceId === "string" && context.traceId.trim()
      ? context.traceId.trim()
      : undefined;
  if (fromContext) {
    return fromContext;
  }
  const fromHeader = headerValue(context?.headers, "x-athena-trace-id");
  if (fromHeader) {
    return fromHeader;
  }
  return mintId();
}

export function resolveDataNucleusRequestId(
  context?: AthenaRuntimeRequestContext
): string {
  if (typeof context?.requestId === "string" && context.requestId.trim()) {
    return context.requestId.trim();
  }
  const fromHeader = headerValue(context?.headers, "x-request-id");
  if (fromHeader) {
    return fromHeader;
  }
  return mintId();
}

export function createDataNucleusEnvelope(
  context?: AthenaRuntimeRequestContext
): AthenaDataNucleusEnvelope {
  const envelope: AthenaDataNucleusEnvelope = {
    eventId: mintId(),
    requestId: resolveDataNucleusRequestId(context),
    traceId: resolveDataNucleusTraceId(context),
  };
  if (context) {
    context.requestId = envelope.requestId;
    context.traceId = envelope.traceId;
    context.eventId = envelope.eventId;
  }
  return Object.freeze(envelope);
}
