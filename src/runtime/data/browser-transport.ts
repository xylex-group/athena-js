import {
  createAthenaHttpExecutor,
  createAthenaHttpTransportIR,
} from "../transport/http.ts";
import { DEFAULT_ATHENA_NEXT_DATA_ENDPOINT } from "./discovery-document.ts";

export function compileAthenaDataHttpTransport(options?: {
  basePath?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}) {
  const basePath =
    options?.basePath?.trim() || DEFAULT_ATHENA_NEXT_DATA_ENDPOINT;
  const ir = createAthenaHttpTransportIR({
    basePath,
    domain: "data",
    origin: /^https?:\/\//i.test(basePath) ? "remote" : "same-origin",
  });
  return {
    http: createAthenaHttpExecutor(ir, options),
    ir,
  };
}
