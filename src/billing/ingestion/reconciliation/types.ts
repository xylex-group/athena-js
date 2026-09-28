import type {
  BillingProviderWebhook,
  BillingWebhookManagementCapability,
} from "../../runtime/local/providers/types.ts";
import type {
  BillingWebhookKind,
  BillingWebhookReconciliationAction,
  BillingWebhookRegistrationStatus,
  MollieWebhookEndpoints,
  NormalizedAthenaBillingWebhooksConfig,
} from "../types.ts";
import type { BillingWebhookRegistrationLifecycleState } from "./lifecycle.ts";

export type BillingWebhookReconciliationState =
  | BillingWebhookRegistrationLifecycleState
  | "create_pending"
  | "remote_created_secret_pending"
  | "rotation_required"
  | "update_pending";

export interface BillingWebhookRegistrationRecord {
  configHash: string;
  connectionId: string;
  environment: "test" | "live";
  eventTypes: readonly string[];
  id: string;
  kind: BillingWebhookKind;
  lastAcceptedAt?: Date;
  lastDeliveryAt?: Date;
  lastError?: unknown;
  lastIngressStage?: string;
  lastReconciledAt?: Date;
  lastReconciliationOutcome?: "completed" | "failed" | "skipped";
  lastRejectedAt?: Date;
  lastRejectionCode?: string;
  lastVerifiedAt?: Date;
  name: string;
  provider: string;
  providerWebhookId?: string;
  reconciliationState?: BillingWebhookReconciliationState;
  activationAttempts?: number;
  lastProviderEvidence?: unknown;
  lifecycleError?: unknown;
  lifecycleUpdatedAt?: Date;
  providerRegistrationAttempts?: number;
  providerRegistrationIdempotencyKey?: string;
  secretPersistenceAttempts?: number;
  secretFingerprint?: string;
  secretVersion?: number;
  status: BillingWebhookRegistrationStatus;
  url: string;
}

export interface BillingWebhookDesiredState {
  classic?: {
    enabled: boolean;
    url: string;
  };
  marker: string;
  nextGen?: {
    enabled: boolean;
    eventTypes: readonly string[];
    name: string;
    required: boolean;
    url: string;
  };
}

export interface BillingWebhookReconciliationPlan {
  action: BillingWebhookReconciliationAction;
  kind: BillingWebhookKind;
  owned: boolean;
  providerWebhook?: BillingProviderWebhook;
  reason: string;
}

export interface BillingWebhookReconcileInput {
  applicationId: string;
  capability: BillingWebhookManagementCapability;
  connectionId: string;
  dryRun?: boolean;
  endpoints: MollieWebhookEndpoints;
  environment: "test" | "live";
  hasDecryptableLocalSecret?: boolean;
  management: "automatic" | "manual";
  provider: string;
  webhooks: NormalizedAthenaBillingWebhooksConfig;
}
