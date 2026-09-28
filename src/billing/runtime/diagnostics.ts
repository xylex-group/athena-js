import type { AthenaClientInternals } from "../../runtime/client-internals.ts";
import type { BillingProviderName } from "../types.ts";

export type AthenaBillingDiagnosticsPhase =
  | "unconfigured"
  | "provider-registry"
  | "materializing-connections"
  | "attaching-ingress"
  | "registering-schedulers"
  | "ready"
  | "failed";

export interface AthenaBillingDiagnostics {
  attentionRequiredOperations?: number;
  billingSchemaReady?: boolean;
  connectionCount: number;
  connectionAffinitySource?: string;
  eligibleConnectionCount?: number;
  failure?: {
    code?: string;
    message: string;
    stage: string;
  };
  ingressAdmissionControl?: "disabled" | "enabled" | "unknown";
  lastRecoveryBatch?: {
    attentionRequired: number;
    completed: number;
    failed: number;
    retried: number;
    scanned: number;
  };
  planChangeConfigured?: boolean;
  planChangeSafety?: "disabled" | "preview" | "stable";
  phase: AthenaBillingDiagnosticsPhase;
  recoveryCoordinatorEnabled?: boolean;
  recoverableOperationBacklog?: number;
  readyAt?: number;
  selectedConnectionId?: string | null;
  startedAt?: number;
  unfinishedRecoverableOperations?: number;
  verifiedBillingContact?: "available" | "unavailable" | "unknown";
  webhookIngressUrlTemplates?: readonly {
    classic: string;
    connectionId: string;
    events: string;
  }[];
  webhookSecretLifecycle?: "degraded" | "healthy" | "unknown";
}

export interface AthenaBillingInspectedConnection {
  accountReference: string;
  classicWebhookUrl?: string;
  credentialReference: string;
  eventsWebhookUrl?: string;
  id: string;
  provider: BillingProviderName;
}

export function emptyBillingDiagnostics(): AthenaBillingDiagnostics {
  return {
    connectionCount: 0,
    phase: "unconfigured",
  };
}

export function patchBillingDiagnostics(
  internals: AthenaClientInternals | undefined,
  patch: Partial<AthenaBillingDiagnostics>
): void {
  if (!internals) {
    return;
  }
  const current = internals.billingDiagnostics ?? emptyBillingDiagnostics();
  internals.billingDiagnostics = {
    ...current,
    ...patch,
    failure: patch.failure ?? current.failure,
  };
}
