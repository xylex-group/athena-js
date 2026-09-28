import { CLI_JSON_SCHEMA_VERSION } from "./constants.ts";
import type { CliDiagnostic } from "./result.ts";

export interface CliJsonErrorBody {
  code: string;
  details?: Record<string, unknown>;
  hint?: string;
  message: string;
}

export interface CliJsonSuccess<T = unknown> {
  command: string;
  data: T;
  meta?: {
    durationMs: number;
  };
  ok: true;
  schemaVersion: typeof CLI_JSON_SCHEMA_VERSION;
  warnings?: CliDiagnostic[];
}

export interface CliJsonFailure {
  command: string;
  error: CliJsonErrorBody;
  ok: false;
  schemaVersion: typeof CLI_JSON_SCHEMA_VERSION;
}

export type CliJsonEnvelope<T = unknown> = CliJsonSuccess<T> | CliJsonFailure;

export function encodeCliJsonSuccess<T>(
  command: string,
  data: T,
  options: { durationMs?: number; warnings?: CliDiagnostic[] } = {}
): CliJsonSuccess<T> {
  const envelope: CliJsonSuccess<T> = {
    command,
    data,
    ok: true,
    schemaVersion: CLI_JSON_SCHEMA_VERSION,
  };
  if (options.warnings && options.warnings.length > 0) {
    envelope.warnings = options.warnings;
  }
  if (options.durationMs !== undefined) {
    envelope.meta = { durationMs: options.durationMs };
  }
  return envelope;
}

export function encodeCliJsonFailure(
  command: string,
  error: CliJsonErrorBody
): CliJsonFailure {
  return {
    command,
    error,
    ok: false,
    schemaVersion: CLI_JSON_SCHEMA_VERSION,
  };
}

export function stringifyCliJson(envelope: CliJsonEnvelope): string {
  return JSON.stringify(envelope, null, 2);
}
