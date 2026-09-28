import type {
  AthenaDevtoolsBillingHealthFinding,
  AthenaDevtoolsBillingHealthInspector,
  AthenaDevtoolsBillingInspector,
} from "../../protocol/billing.ts";

export function produceBillingHealth(
  inspector: AthenaDevtoolsBillingInspector
): AthenaDevtoolsBillingHealthInspector {
  const findings: AthenaDevtoolsBillingHealthFinding[] = [];
  if (inspector.runtime.phase === "failed") {
    findings.push({
      code: "BILLING_RUNTIME_FAILED",
      detail: inspector.runtime.failureCode ?? "billing runtime failed",
      tone: "failed",
    });
  }
  const missingCredential = inspector.connections.some(
    (row) => row.credential.secret.kind === "unset"
  );
  if (missingCredential && inspector.status !== "unconfigured") {
    findings.push({
      code: "BILLING_PROVIDER_CREDENTIAL_MISSING",
      detail: "A configured provider slot has no credential",
      tone: "failed",
    });
  }
  const active = inspector.connections.filter((row) => row.id != null);
  if (active.length > 1) {
    findings.push({
      code: "BILLING_CONNECTION_AMBIGUOUS",
      detail: "More than one active billing connection",
      tone: "degraded",
    });
  }
  if (
    inspector.subjects.conflicts.some(
      (row) => row.code === "BILLING_SUBJECT_CONFLICT"
    )
  ) {
    findings.push({
      code: "BILLING_SUBJECT_CONFLICT",
      detail: "Subject identity conflict",
      tone: "degraded",
    });
  }
  const failed = findings.some((row) => row.tone === "failed");
  const degraded = findings.some((row) => row.tone === "degraded");
  const tone = failed
    ? "failed"
    : degraded
      ? "degraded"
      : inspector.status === "unconfigured"
        ? "unknown"
        : "healthy";
  return {
    canonicalIdentities:
      inspector.subjects.conflicts.length > 0 ? "degraded" : tone,
    connectionMaterialized:
      inspector.runtime.phase === "ready"
        ? "healthy"
        : inspector.status === "unconfigured"
          ? "unknown"
          : "degraded",
    credentials: missingCredential
      ? "failed"
      : inspector.status === "unconfigured"
        ? "unknown"
        : "healthy",
    findings,
    ingress: "unknown",
    migrations: "unknown",
    provider: inspector.runtime.provider ? tone : "unknown",
    reconciliation: "unknown",
    runtime:
      inspector.runtime.phase === "failed"
        ? "failed"
        : inspector.runtime.phase === "ready"
          ? "healthy"
          : "unknown",
    scheduler:
      inspector.runtime.bootstrapEvents.includes(
        "webhook-scheduler-registered"
      ) ||
      inspector.runtime.bootstrapEvents.includes("import-scheduler-registered")
        ? "healthy"
        : "unknown",
    webhookRegistration: inspector.webhooks.desired.classicEnabled
      ? "unknown"
      : "unknown",
  };
}
