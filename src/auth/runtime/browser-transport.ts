import { DEFAULT_ATHENA_NEXT_AUTH_ENDPOINT } from "../../runtime/data/discovery-document.ts";
import {
  createAthenaHttpExecutor,
  createAthenaHttpTransportIR,
} from "../../runtime/transport/http.ts";

export function compileAthenaAuthHttpTransport(options?: {
  basePath?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}) {
  const basePath =
    options?.basePath?.trim() || DEFAULT_ATHENA_NEXT_AUTH_ENDPOINT;
  const ir = createAthenaHttpTransportIR({
    basePath,
    domain: "auth",
    origin: /^https?:\/\//i.test(basePath) ? "remote" : "same-origin",
  });
  return {
    http: createAthenaHttpExecutor(ir, options),
    ir,
  };
}
