import type {
  BillingCatalogRelation,
  BillingCheckout,
  BillingCustomer,
  BillingInvoice,
  BillingMoney,
  BillingPayment,
  BillingPaymentLink,
  BillingPrice,
  BillingProduct,
  BillingProviderName,
  BillingRefund,
  BillingSubscription,
} from "../../../types.ts";
import type { BillingOperation } from "../../capabilities.ts";
import type {
  BillingProviderBindingCredentials,
  BillingResolvedCredential,
} from "../../credentials.ts";
import type { BillingEnvironment } from "../../environment.ts";
import type { BillingPage } from "../../types.ts";

export interface BillingProviderPortCapabilities {
  checkout: boolean;
  customers: boolean;
  invoices: boolean;
  paymentLinks: boolean;
  payments: boolean;
  prices: boolean;
  products: boolean;
  refunds: boolean;
  relations: boolean;
  subscriptions: boolean;
  webhooks: boolean;
}

export type BillingProviderOperationCapabilities = Partial<
  Record<BillingOperation, boolean>
>;

export interface BillingProviderCapabilities {
  operations: BillingProviderOperationCapabilities;
  ports: BillingProviderPortCapabilities;
}

export interface ConfiguredBillingProviderBinding {
  readonly credentials: BillingProviderBindingCredentials;
  readonly kind: "configured";
  readonly provider: BillingProviderName;
  readonly providerConfig: Readonly<Record<string, unknown>>;
}

export interface PersistedBillingProviderBinding {
  readonly connectionId: string;
  readonly credentialReference: string;
  readonly credentials: BillingProviderBindingCredentials;
  readonly kind: "connection";
  readonly provider: BillingProviderName;
  readonly providerConfig: Readonly<Record<string, unknown>>;
}

export type BillingProviderBinding =
  | ConfiguredBillingProviderBinding
  | PersistedBillingProviderBinding;

export interface BillingProviderCreateCustomerInput {
  email?: string | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  name?: string | null;
}

export interface BillingProviderGetResourceInput {
  id: string;
}

export interface BillingProviderUpdateCustomerInput {
  email?: string | null;
  id: string;
  name?: string | null;
}

export interface BillingProviderListInput {
  cursor?: string;
  limit?: number;
}

export interface BillingProviderCreateRefundInput {
  amount: BillingMoney;
  description?: string | null;
  idempotencyKey: string;
  paymentId: string;
}

export interface BillingProviderGetRefundInput {
  paymentId: string;
  refundId: string;
}

export interface BillingProviderCreatePaymentLinkInput {
  amount: BillingMoney;
  description: string;
  idempotencyKey: string;
  redirectUrl?: string | null;
  webhookUrl?: string | null;
}

export interface BillingProviderUpdatePaymentLinkInput {
  description?: string | null;
  id: string;
}

export interface BillingCustomersPort {
  create(
    context: BillingProviderExecutionContext,
    input: BillingProviderCreateCustomerInput
  ): Promise<BillingCustomer>;
  delete(
    context: BillingProviderExecutionContext,
    input: BillingProviderGetResourceInput
  ): Promise<void>;
  get(
    context: BillingProviderExecutionContext,
    input: BillingProviderGetResourceInput
  ): Promise<BillingCustomer>;
  readonly kind: "customers";
  list(
    context: BillingProviderExecutionContext,
    input: BillingProviderListInput
  ): Promise<BillingPage<BillingCustomer>>;
  update(
    context: BillingProviderExecutionContext,
    input: BillingProviderUpdateCustomerInput
  ): Promise<BillingCustomer>;
}

export interface BillingRefundsPort {
  cancel(
    context: BillingProviderExecutionContext,
    input: BillingProviderGetRefundInput
  ): Promise<BillingRefund>;
  create(
    context: BillingProviderExecutionContext,
    input: BillingProviderCreateRefundInput
  ): Promise<BillingRefund>;
  get(
    context: BillingProviderExecutionContext,
    input: BillingProviderGetRefundInput
  ): Promise<BillingRefund>;
  readonly kind: "refunds";
  list(
    context: BillingProviderExecutionContext,
    input: BillingProviderListInput
  ): Promise<BillingPage<BillingRefund>>;
}

export interface BillingPaymentLinksPort {
  create(
    context: BillingProviderExecutionContext,
    input: BillingProviderCreatePaymentLinkInput
  ): Promise<BillingPaymentLink>;
  delete(
    context: BillingProviderExecutionContext,
    input: BillingProviderGetResourceInput
  ): Promise<void>;
  get(
    context: BillingProviderExecutionContext,
    input: BillingProviderGetResourceInput
  ): Promise<BillingPaymentLink>;
  readonly kind: "payment-links";
  list(
    context: BillingProviderExecutionContext,
    input: BillingProviderListInput
  ): Promise<BillingPage<BillingPaymentLink>>;
  update(
    context: BillingProviderExecutionContext,
    input: BillingProviderUpdatePaymentLinkInput
  ): Promise<BillingPaymentLink>;
}

export interface BillingProviderCreateSubscriptionInput {
  amount: BillingMoney;
  customerId: string;
  description: string;
  idempotencyKey: string;
  interval: string;
  metadata?: Record<string, unknown>;
  webhookUrl?: string | null;
}

export interface BillingProviderGetSubscriptionInput {
  customerId: string;
  subscriptionId: string;
}

export interface BillingProviderUpdateSubscriptionInput {
  amount?: BillingMoney;
  customerId: string;
  description?: string | null;
  interval?: string;
  metadata?: Record<string, unknown>;
  subscriptionId: string;
}

export interface BillingProviderListSubscriptionsInput {
  cursor?: string;
  customerId?: string;
  limit?: number;
}

export interface BillingProviderGetInvoiceInput {
  invoiceId: string;
}

export interface BillingSubscriptionsPort {
  cancel(
    context: BillingProviderExecutionContext,
    input: BillingProviderGetSubscriptionInput
  ): Promise<BillingSubscription>;
  create(
    context: BillingProviderExecutionContext,
    input: BillingProviderCreateSubscriptionInput
  ): Promise<BillingSubscription>;
  get(
    context: BillingProviderExecutionContext,
    input: BillingProviderGetSubscriptionInput
  ): Promise<BillingSubscription>;
  readonly kind: "subscriptions";
  list(
    context: BillingProviderExecutionContext,
    input: BillingProviderListSubscriptionsInput
  ): Promise<BillingPage<BillingSubscription>>;
  update(
    context: BillingProviderExecutionContext,
    input: BillingProviderUpdateSubscriptionInput
  ): Promise<BillingSubscription>;
}

export interface BillingInvoicesPort {
  get(
    context: BillingProviderExecutionContext,
    input: BillingProviderGetInvoiceInput
  ): Promise<BillingInvoice>;
  readonly kind: "invoices";
  list(
    context: BillingProviderExecutionContext,
    input: BillingProviderListInput
  ): Promise<BillingPage<BillingInvoice>>;
}

export interface BillingProviderWebhook {
  environment: "test" | "live";
  eventTypes: readonly string[];
  id: string;
  name?: string;
  provider: string;
  /** Present when Mollie returns `webhookSecret` (create; not on list/get). */
  signingSecret?: string;
  status: "active" | "disabled";
  url: string;
}

export interface BillingProviderCreateWebhookInput {
  eventTypes: readonly string[];
  idempotencyKey: string;
  name: string;
  url: string;
}

export interface BillingProviderUpdateWebhookInput {
  eventTypes?: readonly string[];
  id: string;
  name?: string;
  url?: string;
}

export interface BillingWebhookManagementCapability {
  classic: boolean;
  nextGen: {
    available: boolean;
    list?: boolean;
    reason?:
      | "credential_missing_webhooks_write"
      | "api_key_classic_only"
      | "unsupported_provider"
      | "verified_organization_webhooks_write";
    write?: boolean;
  };
}

export interface BillingWebhooksPort {
  create(
    context: BillingProviderExecutionContext,
    input: BillingProviderCreateWebhookInput
  ): Promise<BillingProviderWebhook>;
  delete?(
    context: BillingProviderExecutionContext,
    input: { id: string }
  ): Promise<void>;
  getCapability?(
    binding: BillingProviderBinding
  ): Promise<BillingWebhookManagementCapability>;
  readonly kind: "webhooks";
  list(
    context: BillingProviderExecutionContext,
    input: BillingProviderListInput
  ): Promise<BillingPage<BillingProviderWebhook>>;
  update?(
    context: BillingProviderExecutionContext,
    input: BillingProviderUpdateWebhookInput
  ): Promise<BillingProviderWebhook>;
}

export interface BillingProductsPort {
  readonly kind: "products";
  list(
    context: BillingProviderExecutionContext,
    input: BillingProviderListInput
  ): Promise<BillingPage<BillingProduct>>;
}

export interface BillingPricesPort {
  readonly kind: "prices";
  list(
    context: BillingProviderExecutionContext,
    input: BillingProviderListInput & { productId?: string }
  ): Promise<BillingPage<BillingPrice>>;
}

export interface BillingRelationsPort {
  readonly kind: "relations";
  list(
    context: BillingProviderExecutionContext,
    input: BillingProviderListInput & { sourceProductId?: string }
  ): Promise<BillingPage<BillingCatalogRelation>>;
}

export interface BillingProviderCheckoutPort {
  create(
    context: BillingProviderExecutionContext,
    input: Record<string, unknown> & { idempotencyKey: string }
  ): Promise<BillingCheckout>;
  readonly kind: "checkout";
}

export interface BillingProviderRuntime {
  readonly checkout?: BillingProviderCheckoutPort;
  readonly customers?: BillingCustomersPort;
  getCapabilities(
    binding: BillingProviderBinding
  ): Promise<BillingProviderCapabilities>;
  readonly invoices?: BillingInvoicesPort;
  readonly paymentLinks?: BillingPaymentLinksPort;
  readonly payments?: BillingProviderPaymentPort;
  readonly prices?: BillingPricesPort;
  readonly products?: BillingProductsPort;
  readonly provider: BillingProviderName;
  readonly refunds?: BillingRefundsPort;
  readonly relations?: BillingRelationsPort;
  readonly subscriptions?: BillingSubscriptionsPort;
  readonly webhooks?: BillingWebhooksPort;
}

export type BillingProviderPortName = Exclude<
  keyof BillingProviderRuntime,
  "provider" | "getCapabilities"
>;

export type BillingProviderPortMap = {
  [K in BillingProviderPortName]?: BillingProviderRuntime[K];
};

export interface MollieBillingProviderRuntime extends BillingProviderRuntime {
  readonly provider: "mollie";
}

export interface StripeBillingProviderRuntime extends BillingProviderRuntime {
  readonly provider: "stripe";
}

export type ResolvedBillingExecutionTarget =
  | {
      kind: "configured";
      provider: BillingProviderName;
      runtime: BillingProviderRuntime;
    }
  | {
      kind: "connection";
      connectionId: string;
      provider?: BillingProviderName;
    };

export interface BillingProviderExecutionTarget {
  readonly profileId?: string;
}

export interface BillingProviderExecutionContext {
  readonly binding: BillingProviderBinding;
  readonly credential: BillingResolvedCredential;
  readonly environment: BillingEnvironment;
  readonly idempotencyKey?: string;
  readonly ingress?: {
    classicWebhookUrl?: string;
  };
  readonly operationScope?: "organization" | "profile" | "automatic";
  readonly provider: BillingProviderName;
  readonly signal?: AbortSignal;
  readonly target: BillingProviderExecutionTarget;
}

export interface BillingProviderCreatePaymentInput {
  amount: BillingMoney;
  cancelUrl?: string | null;
  customerId?: string | null;
  description?: string | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  redirectUrl?: string | null;
  sequenceType?: "first" | "recurring" | "oneoff";
  /** Ignored. Athena injects the trusted Classic webhook URL from execution context. */
  webhookUrl?: string | null;
}

export interface BillingProviderPaymentPort {
  cancel(
    context: BillingProviderExecutionContext,
    input: BillingProviderGetResourceInput
  ): Promise<BillingPayment>;
  create(
    context: BillingProviderExecutionContext,
    input: BillingProviderCreatePaymentInput
  ): Promise<BillingPayment>;
  get(
    context: BillingProviderExecutionContext,
    input: BillingProviderGetResourceInput
  ): Promise<BillingPayment>;
  list(
    context: BillingProviderExecutionContext,
    input: BillingProviderListInput
  ): Promise<BillingPage<BillingPayment>>;
}
