import { AthenaConfigurationError } from "../../config/errors.ts";
import type {
  AthenaAuthObservabilityConfig,
  NormalizedAthenaAuthObservability,
} from "./types.ts";

export function normalizeAthenaAuthObservability(
  input?: AthenaAuthObservabilityConfig
): NormalizedAthenaAuthObservability {
  const tracesInput = input?.traces;
  const tracesEnabled =
    tracesInput === undefined
      ? true
      : typeof tracesInput === "boolean"
        ? tracesInput
        : tracesInput.sampleRate !== 0;
  const sampleRate =
    typeof tracesInput === "object" &&
    typeof tracesInput.sampleRate === "number" &&
    Number.isFinite(tracesInput.sampleRate)
      ? Math.min(1, Math.max(0, tracesInput.sampleRate))
      : 1;
  const retentionDays =
    typeof tracesInput === "object" &&
    typeof tracesInput.retentionDays === "number" &&
    Number.isFinite(tracesInput.retentionDays)
      ? Math.max(1, Math.trunc(tracesInput.retentionDays))
      : undefined;
  return {
    auditLog: input?.auditLog !== false,
    traces: {
      enabled: tracesEnabled,
      retentionDays,
      sampleRate: tracesEnabled ? sampleRate : 0,
    },
  };
}

export function assertLocalAuthObservability(auth: unknown): void {
  if (!auth || typeof auth !== "object") {
    return;
  }
  const raw = auth as Record<string, unknown>;
  if (!("observability" in raw) || raw.observability === undefined) {
    return;
  }
  const mode = (auth as { mode?: unknown }).mode;
  if (mode !== "local") {
    throw new AthenaConfigurationError(
      "ATHENA_AUTH_OBSERVABILITY_REQUIRES_LOCAL_RUNTIME",
      'auth.observability is an embedded-auth capability. Set auth.mode to "local" or omit observability for remote Auth.',
      "auth"
    );
  }
}
