import { resolveBillingEnvironment } from "../../../billing/runtime/environment.ts";
import type { AthenaDevtoolsBillingInspector } from "../../protocol/billing.ts";
import type { ProduceBillingInspectorInput } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nested(
  input: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> | undefined {
  const value = input?.[key];
  return isRecord(value) ? value : undefined;
}

export function produceBillingRuntime(
  input: ProduceBillingInspectorInput
): AthenaDevtoolsBillingInspector["runtime"] {
  const billing = nested(input.config, "billing");
  const mollie =
    nested(nested(billing, "providers"), "mollie") ?? nested(billing, "mollie");
  const configured =
    Boolean(billing) || Boolean(input.internals?.billingRuntime);
  const environment = resolveBillingEnvironment({
    testMode:
      typeof billing?.testMode === "boolean" ? billing.testMode : undefined,
  }).name;
  const diagnostics = input.internals?.billingDiagnostics;
  const events = input.internals?.billingBootstrapEvents ?? [];
  const mode =
    input.internals?.billingRuntime != null || nested(billing, "url") == null
      ? "local"
      : "remote";
  if (!configured && diagnostics?.phase !== "failed") {
    return {
      bootstrapEvents: events,
      environment,
      initialized: false,
      mode,
      phase: "unconfigured",
      provider: mollie ? "mollie" : null,
    };
  }
  const phase =
    diagnostics?.phase ?? (configured ? "provider-registry" : "unconfigured");
  return {
    bootstrapEvents: [...events],
    environment,
    ...(diagnostics?.failure?.code
      ? { failureCode: diagnostics.failure.code }
      : {}),
    initialized: diagnostics?.phase === "ready",
    mode,
    phase,
    provider: mollie ? "mollie" : null,
  };
}
