import type { AthenaTransportInvocationIR } from "../invocation.ts";
import type { AthenaHttpRequestIR, AthenaHttpTransportIR } from "./ir.ts";
import { resolveAthenaHttpUrl } from "./url.ts";

/** Storage/Billing RPC envelope. Auth and Data keep domain HTTP compilers. */
export function compileAthenaRpcHttpRequest(input: {
  headers?: Record<string, string>;
  invocation: AthenaTransportInvocationIR;
  root?: string;
  transport: AthenaHttpTransportIR;
}): AthenaHttpRequestIR {
  const url = resolveAthenaHttpUrl({
    basePath: input.transport.basePath,
    root: input.root,
  });
  const credentials: RequestCredentials =
    input.transport.credentials === "same-origin" ? "same-origin" : "omit";
  return {
    body: JSON.stringify({
      operation: input.invocation.operation,
      payload: input.invocation.payload,
    }),
    credentials,
    headers: {
      "content-type": "application/json",
      ...input.headers,
    },
    method: "POST",
    url,
  };
}

export function compileAthenaHttpRequest(
  input: Parameters<typeof compileAthenaRpcHttpRequest>[0]
): AthenaHttpRequestIR {
  return compileAthenaRpcHttpRequest(input);
}
