import type { AthenaTransportResult } from "../error-envelope.ts";
import type { AthenaTransportInvocationIR } from "../invocation.ts";
import type { AthenaHttpTransportIR } from "./ir.ts";
import { compileAthenaRpcHttpRequest } from "./request-compiler.ts";
import { parseAthenaHttpTransportResponse } from "./response-parser.ts";

export async function executeAthenaHttpTransport<T>(input: {
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  invocation: AthenaTransportInvocationIR;
  root?: string;
  transport: AthenaHttpTransportIR;
}): Promise<AthenaTransportResult<T>> {
  const fetchImpl = input.fetch ?? fetch;
  const request = compileAthenaRpcHttpRequest({
    headers: input.headers,
    invocation: input.invocation,
    root: input.root,
    transport: input.transport,
  });
  const response = await fetchImpl(request.url, {
    body: request.body,
    credentials: request.credentials,
    headers: request.headers,
    method: request.method,
  });
  const json = await response.json().catch(() => undefined);
  return parseAthenaHttpTransportResponse<T>({
    headers: response.headers,
    json,
    status: response.status,
    statusText: response.statusText,
  });
}

export function createAthenaHttpTransportExecutor(options?: {
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  root?: string;
}): {
  execute<T>(input: {
    invocation: AthenaTransportInvocationIR;
    transport: AthenaHttpTransportIR;
  }): Promise<AthenaTransportResult<T>>;
} {
  return {
    execute<T>(input: {
      invocation: AthenaTransportInvocationIR;
      transport: AthenaHttpTransportIR;
    }) {
      return executeAthenaHttpTransport<T>({
        fetch: options?.fetch,
        headers: options?.headers,
        invocation: input.invocation,
        root: options?.root,
        transport: input.transport,
      });
    },
  };
}
