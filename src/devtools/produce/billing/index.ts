import type { AthenaDevtoolsBillingInspector } from "../../protocol/billing.ts";
import { produceBillingConnections } from "./connections.ts";
import { produceBillingHealth } from "./diagnostics.ts";
import { produceBillingIdentities } from "./identities.ts";
import { produceBillingIngress } from "./ingress.ts";
import { produceBillingReconciliation } from "./reconciliation.ts";
import { produceBillingRuntime } from "./runtime.ts";
import type { ProduceBillingInspectorInput } from "./types.ts";
import { produceBillingWebhooks } from "./webhooks.ts";

export type { ProduceBillingInspectorInput } from "./types.ts";

export function emptyBillingInspector(
  overrides?: Partial<AthenaDevtoolsBillingInspector>
): AthenaDevtoolsBillingInspector {
  return {
    capabilities: [],
    checkouts: [],
    connections: [],
    health: {
      canonicalIdentities: "unknown",
      connectionMaterialized: "unknown",
      credentials: "unknown",
      findings: [],
      ingress: "unknown",
      migrations: "unknown",
      provider: "unknown",
      reconciliation: "unknown",
      runtime: "unknown",
      scheduler: "unknown",
      webhookRegistration: "unknown",
    },
    ingress: {
      duplicate: null,
      normalized: null,
      received: null,
      reconciled: null,
      rejected: null,
      stages: [],
      verified: null,
    },
    invoices: [],
    payments: [],
    reconciliation: {
      checkpoints: [],
      conflicts: null,
      failedDocuments: null,
      lastRunAt: null,
      providerLatencyMs: null,
      retries: null,
      runs: null,
    },
    runtime: {
      bootstrapEvents: [],
      environment: "test",
      initialized: false,
      mode: "local",
      phase: "unconfigured",
      provider: null,
    },
    status: "unconfigured",
    subjects: {
      bindings: [],
      conflicts: [],
      routes: [],
    },
    subscriptions: [],
    webhooks: {
      desired: {
        classicEnabled: false,
        connectionId: null,
        nextGenEnabled: false,
        publicUrl: null,
      },
      ingress: {
        bindingToken: { kind: "unset" },
        duplicateCount: null,
        lastReceivedAt: null,
        lastRejectedAt: null,
        lastVerifiedAt: null,
        signingSecret: { kind: "unset" },
      },
      provider: {
        providerWebhookId: null,
        registration: "unknown",
        status: null,
        target: null,
      },
    },
    ...overrides,
  };
}

export function produceAthenaDevtoolsBillingInspector(
  input: ProduceBillingInspectorInput
): AthenaDevtoolsBillingInspector {
  const runtime = produceBillingRuntime(input);
  const connections = produceBillingConnections(input);
  const identities = produceBillingIdentities({
    ...input,
    connections,
  });
  const webhooks = produceBillingWebhooks(input, connections);
  const inspector = emptyBillingInspector({
    capabilities: connections.flatMap((row) => row.capabilities),
    connections,
    ingress: produceBillingIngress(),
    reconciliation: produceBillingReconciliation(),
    runtime,
    status: runtimeStatus(runtime.phase, runtime.initialized),
    subjects: identities,
    webhooks,
  });
  return {
    ...inspector,
    health: produceBillingHealth(inspector),
  };
}

function runtimeStatus(
  phase: AthenaDevtoolsBillingInspector["runtime"]["phase"],
  initialized: boolean
): AthenaDevtoolsBillingInspector["status"] {
  if (phase === "unconfigured") {
    return "unconfigured";
  }
  if (phase === "failed") {
    return "failed";
  }
  if (phase === "ready" && initialized) {
    return "ready";
  }
  return "initializing";
}
