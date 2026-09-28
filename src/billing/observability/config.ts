import { AthenaConfigurationError } from "../../config/errors.ts";
import type {
  AthenaBillingObservabilityConfig,
  NormalizedAthenaBillingObservability,
} from "./types.ts";

export function normalizeAthenaBillingObservability(
  input?: AthenaBillingObservabilityConfig
): NormalizedAthenaBillingObservability {
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
      : 30;
  const auditRetentionDays =
    typeof input?.auditRetentionDays === "number" &&
    Number.isFinite(input.auditRetentionDays)
      ? Math.max(1, Math.trunc(input.auditRetentionDays))
      : undefined;
  const webhookIngressRetentionDays =
    typeof input?.webhookIngressRetentionDays === "number" &&
    Number.isFinite(input.webhookIngressRetentionDays)
      ? Math.max(1, Math.trunc(input.webhookIngressRetentionDays))
      : 30;
  return {
    auditLog: input?.auditLog !== false,
    auditRetentionDays,
    traces: {
      enabled: tracesEnabled,
      retentionDays,
      sampleRate: tracesEnabled ? sampleRate : 0,
    },
    webhookIngressRetentionDays,
  };
}

export function assertLocalBillingObservability(billing: unknown): void {
  if (!billing || typeof billing !== "object") {
    return;
  }
  const raw = billing as Record<string, unknown>;
  if (!("observability" in raw) || raw.observability === undefined) {
    return;
  }
  const mode = (billing as { mode?: unknown }).mode;
  if (mode === "remote") {
    throw new AthenaConfigurationError(
      "ATHENA_BILLING_OBSERVABILITY_REQUIRES_LOCAL_RUNTIME",
      'billing.observability is an embedded billing capability. Set billing.mode to "local" or omit observability for remote Billing.',
      "billing"
    );
  }
}
