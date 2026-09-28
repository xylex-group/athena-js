import type { AthenaDevtoolsBillingInspector } from "../protocol/billing.ts";

const SECRET_VALUE = /^(live_|test_|access_|sk_|whsec_|whk_)/i;
const SECRET_KEYS =
  /^(apiKey|accessToken|signingSecret|webhookIngressToken|password|secret)$/i;
const STRUCTURAL_KEYS = new Set([
  "code",
  "environment",
  "kind",
  "operation",
  "phase",
  "provider",
  "resolution",
  "source",
  "stage",
  "status",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function redact(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    if (key && STRUCTURAL_KEYS.has(key)) {
      return value;
    }
    if (key && SECRET_KEYS.test(key)) {
      return "[REDACTED]";
    }
    if (SECRET_VALUE.test(value) && value.length > 8) {
      return "[REDACTED]";
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry, key));
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [nextKey, entry] of Object.entries(value)) {
      out[nextKey] = redact(entry, nextKey);
    }
    return out;
  }
  return value;
}

export function sanitizeAthenaDevtoolsBillingInspector(
  value: AthenaDevtoolsBillingInspector
): AthenaDevtoolsBillingInspector {
  return redact(value) as AthenaDevtoolsBillingInspector;
}
