import type { AthenaHttpMethod } from "./ir.ts";

export const DEFAULT_ATHENA_HTTP_MAX_BODY_BYTES = 1_048_576;

export type AthenaIncomingHttpRequestIR = {
  readonly body: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
  readonly kind: "http";
  readonly method: AthenaHttpMethod;
  readonly url: string;
};

export class AthenaHttpBodyLimitError extends Error {
  readonly code = "ATHENA_HTTP_REQUEST_TOO_LARGE";
  readonly status = 413;

  constructor(maxBodyBytes: number) {
    super("Request body exceeds the allowed size.");
    this.name = "AthenaHttpBodyLimitError";
    this.maxBodyBytes = maxBodyBytes;
  }

  readonly maxBodyBytes: number;
}

export function isAthenaHttpBodyLimitError(
  error: unknown
): error is AthenaHttpBodyLimitError {
  return error instanceof AthenaHttpBodyLimitError;
}

function isHttpMethod(value: string): value is AthenaHttpMethod {
  return (
    value === "DELETE" ||
    value === "GET" ||
    value === "HEAD" ||
    value === "OPTIONS" ||
    value === "PATCH" ||
    value === "POST" ||
    value === "PUT"
  );
}

async function readRequestBodyWithLimit(
  request: Request,
  maxBodyBytes: number
): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared != null && declared.trim() !== "") {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBodyBytes) {
      throw new AthenaHttpBodyLimitError(maxBodyBytes);
    }
  }
  const reader = request.body?.getReader();
  if (reader == null) {
    const buffered = new Uint8Array(await request.arrayBuffer());
    if (buffered.byteLength > maxBodyBytes) {
      throw new AthenaHttpBodyLimitError(maxBodyBytes);
    }
    return buffered;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value == null || value.byteLength === 0) {
      continue;
    }
    total += value.byteLength;
    if (total > maxBodyBytes) {
      await reader.cancel().catch(() => undefined);
      throw new AthenaHttpBodyLimitError(maxBodyBytes);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function parseAthenaIncomingHttpRequest(
  request: Request,
  options?: { maxBodyBytes?: number }
): Promise<AthenaIncomingHttpRequestIR> {
  const method = request.method.toUpperCase();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (name === "x-mollie-signature" && headers[name] != null) {
      headers[name] = `${headers[name]}\n${value}`;
      return;
    }
    headers[name] = value;
  });
  const maxBodyBytes =
    options?.maxBodyBytes ?? DEFAULT_ATHENA_HTTP_MAX_BODY_BYTES;
  return {
    body: await readRequestBodyWithLimit(request, maxBodyBytes),
    headers,
    kind: "http",
    method: isHttpMethod(method) ? method : "POST",
    url: request.url,
  };
}
