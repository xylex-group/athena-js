export async function decodeAthenaGatewayJsonBody(
  request: Request,
  options?: { maxBodyBytes?: number }
): Promise<
  | { ok: true; payload: unknown }
  | { ok: false; code: "ATHENA_LIMIT_EXCEEDED" | "ATHENA_RUNTIME_UNAVAILABLE"; message: string; status: number }
> {
  const maxBodyBytes = options?.maxBodyBytes;
  const declared = request.headers.get("content-length");
  if (maxBodyBytes != null && declared) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBodyBytes) {
      return {
        code: "ATHENA_LIMIT_EXCEEDED",
        message: `Request body exceeds maxBodyBytes (${maxBodyBytes}).`,
        ok: false,
        status: 413,
      };
    }
  }
  const text = await request.text();
  if (maxBodyBytes != null && text.length > maxBodyBytes) {
    return {
      code: "ATHENA_LIMIT_EXCEEDED",
      message: `Request body exceeds maxBodyBytes (${maxBodyBytes}).`,
      ok: false,
      status: 413,
    };
  }
  if (!text.trim()) {
    return { ok: true, payload: {} };
  }
  try {
    return { ok: true, payload: JSON.parse(text) as unknown };
  } catch {
    return {
      code: "ATHENA_RUNTIME_UNAVAILABLE",
      message: "Athena Local Runtime received malformed JSON.",
      ok: false,
      status: 400,
    };
  }
}

export function resolveIncomingRequestId(request: Request): string {
  return (
    request.headers.get("x-request-id") ??
    request.headers.get("x-athena-request-id") ??
    request.headers.get("x-correlation-id") ??
    crypto.randomUUID()
  );
}
