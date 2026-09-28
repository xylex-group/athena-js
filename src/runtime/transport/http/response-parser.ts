import type {
  AthenaTransportErrorEnvelope,
  AthenaTransportResult,
} from "../error-envelope.ts";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
}

function unwrapSuccessData<T>(
  record: Record<string, unknown> | undefined,
  json: unknown
): T {
  if (record && typeof record.ok === "boolean") {
    return record.data as T;
  }
  return json as T;
}

function readHeader(
  headers: Headers | undefined,
  name: string
): string | undefined {
  const value = headers?.get(name)?.trim();
  return value ? value : undefined;
}

export function parseAthenaHttpTransportResponse<T>(input: {
  headers?: Headers;
  json: unknown;
  status: number;
  statusText: string;
}): AthenaTransportResult<T> {
  const record = asRecord(input.json);
  const errorRecord = asRecord(record?.error);
  const ok = record?.ok !== false && input.status >= 200 && input.status < 300;
  if (ok) {
    const enveloped = typeof record?.ok === "boolean";
    return {
      data: unwrapSuccessData<T>(record, input.json),
      enveloped,
      ok: true,
    };
  }
  const status =
    typeof record?.status === "number"
      ? record.status
      : typeof errorRecord?.status === "number"
        ? errorRecord.status
        : input.status;
  const code =
    typeof errorRecord?.code === "string" && errorRecord.code.trim()
      ? errorRecord.code
      : `ATHENA_TRANSPORT_HTTP_${status}`;
  const message =
    typeof errorRecord?.message === "string" && errorRecord.message.trim()
      ? errorRecord.message
      : input.statusText || `transport request failed (${status})`;
  const errorNumber =
    typeof errorRecord?.errorNumber === "number"
      ? errorRecord.errorNumber
      : undefined;
  const requestId =
    (typeof errorRecord?.requestId === "string" && errorRecord.requestId.trim()
      ? errorRecord.requestId.trim()
      : undefined) ?? readHeader(input.headers, "x-athena-request-id");
  const retryable =
    typeof errorRecord?.retryable === "boolean"
      ? errorRecord.retryable
      : undefined;
  const envelope: AthenaTransportErrorEnvelope = {
    code,
    details: errorRecord ?? record ?? input.json,
    ...(errorNumber === undefined ? {} : { errorNumber }),
    message,
    ...(requestId === undefined ? {} : { requestId }),
    ...(retryable === undefined ? {} : { retryable }),
    status,
  };
  return { error: envelope, ok: false };
}
