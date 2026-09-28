import type { AthenaIncomingHttpRequestIR } from "../../transport/http/incoming.ts";
import { parseAthenaIncomingHttpRequest } from "../../transport/http/incoming.ts";
import {
  ATHENA_INGRESS_OPERATION_HEADER,
  type AthenaIngressIR,
} from "../ir.ts";

export function compileIngressFromIncomingHttp(input: {
  connectionId?: string;
  domain: string;
  id?: string;
  incoming: AthenaIncomingHttpRequestIR;
  operation: string;
}): AthenaIngressIR {
  const headers: Record<string, string> = {
    ...input.incoming.headers,
    [ATHENA_INGRESS_OPERATION_HEADER]: input.operation,
  };
  return {
    body: input.incoming.body,
    domain: input.domain,
    headers,
    id: input.id ?? crypto.randomUUID(),
    operation: input.operation,
    receivedAt: new Date(),
    transport: { kind: "http" },
    ...(headers["x-athena-trace-id"]
      ? { traceId: headers["x-athena-trace-id"] }
      : {}),
    ...(headers["x-athena-correlation-id"]
      ? { correlationId: headers["x-athena-correlation-id"] }
      : {}),
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
  };
}

export async function compileHttpWebhookIngress(input: {
  request: Request;
  domain: string;
  operation: string;
  connectionId?: string;
  id?: string;
  maxBodyBytes?: number;
}): Promise<AthenaIngressIR> {
  const incoming = await parseAthenaIncomingHttpRequest(input.request, {
    maxBodyBytes: input.maxBodyBytes,
  });
  return compileIngressFromIncomingHttp({
    domain: input.domain,
    incoming,
    operation: input.operation,
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    ...(input.id ? { id: input.id } : {}),
  });
}
