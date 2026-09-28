export type BillingWebhookManagementMode = "automatic" | "manual";

export type BillingManagedWebhookEnablement = false | "auto" | "required";

export type BillingWebhookKind = "classic" | "next_gen";

export type BillingWebhookRegistrationStatus =
  | "pending"
  | "active"
  | "drifted"
  | "degraded"
  | "disabled"
  | "error";

export type BillingWebhookReconciliationAction =
  | "noop"
  | "create"
  | "update"
  | "replace"
  | "disable"
  | "conflict";

export type BillingIngestionChannelHealth =
  | "active"
  | "disabled"
  | "unsupported"
  | "error";

export type BillingNextGenIngestionHealth =
  | BillingIngestionChannelHealth
  | "degraded";

export interface BillingConnectionIngestionHealth {
  classic: BillingIngestionChannelHealth;
  drifted: boolean;
  lastDeliveryAt?: Date;
  lastVerifiedAt?: Date;
  nextGen: BillingNextGenIngestionHealth;
}

export interface MollieWebhookEndpoints {
  classic: string;
  nextGen: string;
}

export interface ResolvedBillingIngressEndpoints
  extends MollieWebhookEndpoints {
  classicUrl: string;
  eventsUrl: string;
}

export interface AthenaBillingWebhookClassicConfig {
  enabled?: boolean;
}

export interface AthenaBillingWebhookNextGenConfig {
  enabled?: BillingManagedWebhookEnablement;
  eventTypes?: readonly string[];
  previousSigningSecrets?: readonly string[];
  signingSecret?: string;
}

/**
 * Bounded webhook admit before parse. Defaults: 1 MiB body, 20/s, burst 40,
 * 16 concurrent, `trustProxy` false.
 */
export interface BillingIngressAdmissionPolicy {
  burst?: number;
  maxBodyBytes?: number;
  maxConcurrent?: number;
  ratePerSecond?: number;
  /**
   * Allow the HTTP adapter to use forwarding headers for admission identity.
   * Enable only when the adapter is behind a trusted proxy.
   */
  trustProxy?: boolean;
}

export interface AthenaBillingMollieWebhookProviderConfig {
  classic?: AthenaBillingWebhookClassicConfig;
  nextGen?: AthenaBillingWebhookNextGenConfig;
  strategy?: "hybrid" | "classic" | "next_gen";
}

export interface AthenaBillingWebhooksObjectConfig {
  /** Bounded admit before parse. See {@link BillingIngressAdmissionPolicy}. */
  admission?: BillingIngressAdmissionPolicy;
  enabled?: boolean;
  execution?: "embedded" | "external";
  management?: BillingWebhookManagementMode;
  providers?: {
    mollie?: AthenaBillingMollieWebhookProviderConfig;
  };
  publicBaseUrl?: string;
  /** Envelope key for provider signing secrets. Prefer env ATHENA_BILLING_WEBHOOK_MASTER_KEY. */
  secretMasterKey?: string;
}

export type AthenaBillingWebhooksConfig =
  | boolean
  | AthenaBillingWebhooksObjectConfig;

export interface AthenaBillingIngestionConfig {
  webhooks?: AthenaBillingWebhooksConfig;
}

export const DEFAULT_MOLLIE_NEXT_GEN_EVENT_TYPES = [
  "payment.paid",
  "payment.failed",
  "payment.canceled",
  "payment.expired",
] as const;

export interface NormalizedMollieWebhookProviderConfig {
  classic: { enabled: boolean };
  nextGen: {
    enabled: BillingManagedWebhookEnablement;
    eventTypes: readonly string[];
    previousSigningSecrets: readonly string[];
    signingSecret?: string;
  };
  strategy: "hybrid" | "classic" | "next_gen";
}

export interface NormalizedAthenaBillingWebhooksConfig {
  enabled: boolean;
  execution: "embedded" | "external";
  management: BillingWebhookManagementMode;
  providers: {
    mollie: NormalizedMollieWebhookProviderConfig;
  };
  publicBaseUrl?: string;
  secretMasterKey?: string;
}

export interface NormalizedAthenaBillingIngestionConfig {
  webhooks: NormalizedAthenaBillingWebhooksConfig;
}

export interface BillingSigningSecretSet {
  current?: string;
  previous: readonly string[];
}

export interface BillingWebhookOwnershipMarker {
  applicationId: string;
  connectionId: string;
  value: string;
}
