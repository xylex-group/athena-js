/**
 * Canonical Athena Billing domain types for the JS runtime.
 * Distinct from provider-native payloads (`raw`) and from HTTP envelopes.
 */

import type {
  BillingCanonicalPaymentStatus,
  BillingCanonicalSubscriptionStatus,
} from "./canonical/status.ts";

export type BillingRuntimeMode = "local" | "remote";

export type BillingProviderName = "mollie" | "stripe" | (string & {});

export interface BillingMoney {
  currency: string;
  value: string;
}

export type BillingPaymentStatus =
  | "pending"
  | "authorized"
  | "paid"
  | "failed"
  | "canceled"
  | "refunded";

export type BillingSubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "paused";

export type BillingInvoiceStatus =
  | "draft"
  | "open"
  | "paid"
  | "void"
  | "uncollectible";

export type BillingRefundStatus =
  | "queued"
  | "pending"
  | "processing"
  | "refunded"
  | "failed"
  | "canceled";

export type BillingPaymentLinkStatus = "open" | "paid" | "expired" | "canceled";

export interface BillingConnectionRef {
  clientName?: string;
  connectionId: string;
}

/**
 * Application/runtime targeting for a billing operation.
 * Distinct from {@link BillingConnectionRef}, which is an explicit persisted
 * Athena connection required by remote HTTP today.
 */
export interface BillingExecutionTarget {
  clientName?: string;
  connectionId?: string;
  profileId?: string;
  provider?: BillingProviderName;
}

export interface BillingPayment {
  amount: BillingMoney;
  amountRefunded?: BillingMoney | null;
  canonicalStatus?: BillingCanonicalPaymentStatus;
  createdAt?: string | null;
  description?: string | null;
  id?: string;
  metadata: unknown;
  paidAt?: string | null;
  provider: BillingProviderName;
  providerCustomerId?: string | null;
  providerPaymentId: string;
  providerPaymentLinkId?: string | null;
  providerProfileId?: string | null;
  providerStatus?: string;
  providerSubscriptionId?: string | null;
  raw: unknown;
  status: BillingPaymentStatus;
}

export interface BillingCustomer {
  email?: string | null;
  metadata: unknown;
  name?: string | null;
  provider: BillingProviderName;
  providerCustomerId: string;
  raw: unknown;
}

export interface BillingRefund {
  amount?: BillingMoney | null;
  description?: string | null;
  metadata: unknown;
  provider: BillingProviderName;
  providerPaymentId?: string | null;
  providerRefundId: string;
  raw: unknown;
  status?: BillingRefundStatus;
}

export interface BillingPaymentLink {
  amount?: BillingMoney | null;
  checkoutUrl?: string | null;
  description?: string | null;
  metadata: unknown;
  provider: BillingProviderName;
  providerPaymentLinkId: string;
  raw: unknown;
  status?: BillingPaymentLinkStatus;
}

export interface BillingSubscription {
  amount?: BillingMoney | null;
  canceledAt?: string | null;
  canonicalStatus?: BillingCanonicalSubscriptionStatus;
  createdAt?: string | null;
  currency?: string | null;
  description?: string | null;
  id?: string | null;
  interval?: string | null;
  metadata: unknown;
  nextPaymentDate?: string | null;
  provider: BillingProviderName;
  providerCustomerId: string;
  providerProfileId?: string | null;
  providerStatus?: string;
  providerSubscriptionId: string;
  raw: unknown;
  status: BillingSubscriptionStatus;
}

export interface BillingInvoice {
  amount?: BillingMoney | null;
  amountPaid?: BillingMoney | null;
  createdAt?: string | null;
  description?: string | null;
  issuedAt?: string | null;
  metadata: unknown;
  paidAt?: string | null;
  provider: BillingProviderName;
  providerCustomerId?: string | null;
  providerInvoiceId: string;
  providerProfileId?: string | null;
  raw: unknown;
  status: BillingInvoiceStatus;
}

export interface BillingWebhook {
  createdAt?: string | null;
  eventTypes?: string[];
  metadata: unknown;
  mode?: string | null;
  name?: string | null;
  profileId?: string | null;
  provider: BillingProviderName;
  providerWebhookId: string;
  raw: unknown;
  status?: string;
  url?: string | null;
}

export interface BillingListPaymentsInput extends BillingExecutionTarget {
  cursor?: string;
  limit?: number;
  offset?: number;
  source?: "provider" | "persistence" | string;
}

export type BillingPaymentSequenceType = "first" | "recurring" | "oneoff";

export interface BillingCreatePaymentInput extends BillingExecutionTarget {
  amount: BillingMoney;
  customerId?: string | null;
  description?: string | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  redirectUrl?: string | null;
  sequenceType?: BillingPaymentSequenceType;
}

export interface BillingGetPaymentInput extends BillingExecutionTarget {
  id: string;
}

export interface BillingCancelPaymentInput extends BillingExecutionTarget {
  id: string;
}

export interface BillingListCustomersInput extends BillingExecutionTarget {
  cursor?: string;
  limit?: number;
  offset?: number;
}

export interface BillingCreateCustomerInput extends BillingExecutionTarget {
  email?: string | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  name?: string | null;
}

export interface BillingGetCustomerInput extends BillingExecutionTarget {
  id: string;
}

export interface BillingUpdateCustomerInput extends BillingExecutionTarget {
  email?: string | null;
  id: string;
  name?: string | null;
}

export interface BillingDeleteCustomerInput extends BillingExecutionTarget {
  id: string;
}

export interface BillingListRefundsInput extends BillingExecutionTarget {
  cursor?: string;
  limit?: number;
  offset?: number;
}

export interface BillingCreateRefundInput extends BillingExecutionTarget {
  amount: BillingMoney;
  description?: string | null;
  idempotencyKey: string;
  paymentId: string;
}

/**
 * Compound refund identity. A standalone `id` cannot address Mollie or Rust
 * `GET/DELETE /payments/{paymentId}/refunds/{refundId}`; do not restore it.
 */
export interface BillingGetRefundInput extends BillingExecutionTarget {
  paymentId: string;
  refundId: string;
}

export interface BillingCancelRefundInput extends BillingExecutionTarget {
  idempotencyKey?: string;
  paymentId: string;
  refundId: string;
}

export interface BillingListPaymentLinksInput extends BillingExecutionTarget {
  cursor?: string;
  limit?: number;
  offset?: number;
}

export interface BillingCreatePaymentLinkInput extends BillingExecutionTarget {
  amount: BillingMoney;
  description: string;
  idempotencyKey: string;
  redirectUrl?: string | null;
}

export interface BillingGetPaymentLinkInput extends BillingExecutionTarget {
  id: string;
}

export interface BillingUpdatePaymentLinkInput extends BillingExecutionTarget {
  description?: string | null;
  id: string;
}

export interface BillingDeletePaymentLinkInput extends BillingExecutionTarget {
  id: string;
}

export interface BillingListSubscriptionsInput extends BillingExecutionTarget {
  cursor?: string;
  customerId?: string;
  limit?: number;
  offset?: number;
}

export interface BillingCreateSubscriptionInput extends BillingExecutionTarget {
  amount: BillingMoney;
  customerId: string;
  description: string;
  idempotencyKey: string;
  interval: string;
  metadata?: Record<string, unknown>;
}

/**
 * Compound subscription identity. A standalone `id` cannot reconstruct
 * `customerId` for Mollie or Rust customer-scoped routes.
 */
export interface BillingGetSubscriptionInput extends BillingExecutionTarget {
  customerId: string;
  subscriptionId: string;
}

export interface BillingUpdateSubscriptionInput extends BillingExecutionTarget {
  amount?: BillingMoney;
  customerId: string;
  description?: string | null;
  interval?: string;
  metadata?: Record<string, unknown>;
  subscriptionId: string;
}

export interface BillingCancelSubscriptionInput extends BillingExecutionTarget {
  customerId: string;
  subscriptionId: string;
}

export interface BillingListInvoicesInput extends BillingExecutionTarget {
  cursor?: string;
  limit?: number;
  offset?: number;
}

export interface BillingGetInvoiceInput extends BillingExecutionTarget {
  invoiceId: string;
}

export interface BillingListWebhooksInput extends BillingExecutionTarget {
  cursor?: string;
  limit?: number;
  offset?: number;
}

export interface BillingCreateWebhookInput extends BillingExecutionTarget {
  eventTypes?: string[];
  idempotencyKey?: string;
  name?: string;
  url: string;
}

export interface BillingGetWebhookInput extends BillingExecutionTarget {
  id: string;
}

export interface BillingUpdateWebhookInput extends BillingExecutionTarget {
  eventTypes?: string[];
  id: string;
  name?: string;
  url?: string;
}

export interface BillingDeleteWebhookInput extends BillingExecutionTarget {
  id: string;
}

export interface BillingTestWebhookInput extends BillingExecutionTarget {
  id: string;
}

export interface BillingProduct {
  description?: string | null;
  id: string;
  metadata: unknown;
  name: string;
  raw: unknown;
}

export interface BillingPrice {
  amount: BillingMoney;
  id: string;
  interval?: string | null;
  metadata: unknown;
  productId: string;
  raw: unknown;
}

/**
 * Canonical billing owner. Provider customer IDs and emails are locators /
 * contact data, never this identity.
 */
export type BillingSubjectRef =
  | { kind: "user"; id: string }
  | { kind: "organization"; id: string };

export type BillingProviderSubjectKind = "customer" | "recipient";

export type BillingSubjectBindingStatus =
  | "pending"
  | "active"
  | "conflict"
  | "revoked";

export type BillingSubjectBindingSource = "created" | "imported" | "reconciled";

export type BillingOwnershipStatus = "resolved" | "unresolved" | "conflict";

export interface BillingSubjectBinding {
  connectionId: string;
  emailSnapshot?: string | null;
  id: string;
  isPrimary: boolean;
  providerSubjectId: string;
  providerSubjectKind: BillingProviderSubjectKind;
  source: BillingSubjectBindingSource;
  status: BillingSubjectBindingStatus;
  subject: BillingSubjectRef;
}

/** Athena-owned catalog seed for local billing. Not Mollie/Stripe native products. */
export interface AthenaBillingCatalogProductInput {
  description?: string | null;
  id: string;
  metadata?: unknown;
  name: string;
}

export interface AthenaBillingCatalogPriceInput {
  amount: BillingMoney;
  id: string;
  interval?: string | null;
  metadata?: unknown;
  productId: string;
}

export const BILLING_CATALOG_RELATION_TYPES = [
  "addon",
  "upsell",
  "upgrade",
  "requires",
  "incompatible",
] as const;

export type BillingCatalogRelationType =
  (typeof BILLING_CATALOG_RELATION_TYPES)[number];

export interface AthenaBillingCatalogRelationConstraints {
  jurisdictions?: readonly string[];
  maxQuantityContext?: number;
  minQuantityContext?: number;
}

export interface AthenaBillingCatalogRelationInput {
  constraints?: AthenaBillingCatalogRelationConstraints;
  id: string;
  metadata?: unknown;
  sourceProductId: string;
  targetProductId: string;
  type: BillingCatalogRelationType;
}

export interface AthenaBillingCatalogConfig {
  prices?: readonly AthenaBillingCatalogPriceInput[];
  products?: readonly AthenaBillingCatalogProductInput[];
  relations?: readonly AthenaBillingCatalogRelationInput[];
}

export interface BillingCatalogRelation {
  constraints?: AthenaBillingCatalogRelationConstraints;
  id: string;
  metadata: unknown;
  raw: unknown;
  sourceProductId: string;
  targetProductId: string;
  type: BillingCatalogRelationType;
}

export interface BillingCheckout {
  checkoutUrl?: string | null;
  expiresAt?: string | null;
  metadata: unknown;
  provider: BillingProviderName;
  providerCheckoutId: string;
  raw: unknown;
}

export interface BillingListProductsInput extends BillingExecutionTarget {
  cursor?: string;
  limit?: number;
  offset?: number;
}

export interface BillingListPricesInput extends BillingExecutionTarget {
  cursor?: string;
  limit?: number;
  offset?: number;
  productId?: string;
}

export interface BillingListRelationsInput extends BillingExecutionTarget {
  cursor?: string;
  limit?: number;
  offset?: number;
  sourceProductId?: string;
}

export interface BillingCreateCheckoutInput extends BillingExecutionTarget {
  cancelUrl?: string | null;
  currency?: string;
  customer?: unknown;
  idempotencyKey: string;
  lineItems?: unknown[];
  metadata?: Record<string, unknown>;
  mode?: string;
  recurrence?: unknown;
  successUrl: string;
}
