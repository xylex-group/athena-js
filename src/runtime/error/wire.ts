import type { AthenaFailureIR } from "./failure.ts";
import { failureFromUnknown } from "./failure.ts";

export interface AthenaErrorWireEnvelope {
  readonly error?: {
    readonly code?: unknown;
    readonly message?: unknown;
  };
  readonly errorNumber?: unknown;
  readonly message?: unknown;
  readonly status?: unknown;
}

export function failureFromAthenaWire(
  envelope: AthenaErrorWireEnvelope | unknown,
  status?: number
): AthenaFailureIR {
  const record = asRecord(envelope);
  const error = asRecord(record?.error);
  const code = stringValue(error?.code) ?? stringValue(record?.code);
  const message =
    stringValue(error?.message) ??
    stringValue(record?.message) ??
    "Athena request failed";
  const responseStatus = numberValue(record?.status) ?? status;

  return failureFromUnknown("http", envelope, {
    code,
    message,
    status: responseStatus,
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
